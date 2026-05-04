import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { Item } from '@/domain/entities/Item';
import type { ItemId, LocalId } from '@/domain/types/ids';
import {
  EstoqueInsuficienteError,
  SaldoInsuficienteError,
} from '@/domain/errors/DomainErrors';
import type { MovimentacaoRepository } from '../ports/MovimentacaoRepository';
import type { ItemRepository } from '../ports/ItemRepository';

export interface SaldoEntrada {
  readonly itemId: ItemId;
  readonly localId: LocalId;
  readonly quantidade: number;
}

export interface DiscrepanciaCiclo {
  readonly itemId: ItemId;
  readonly totalEnviado: number;
  readonly totalRetornado: number;
  readonly diferenca: number;
}

// Quebra de um item em "buckets" operacionais — consumido pelo painel da
// funcionária e pelo admin para visualizar onde cada peça está.
//
//   emImoveis     = saídas para imóvel − retornos do imóvel
//   emLavanderia  = envios para lavanderia − retornos da lavanderia −
//                   ajustes vinculados a lote (baixa por encerramento)
//   disponivel    = estoqueTotal − emImoveis − emLavanderia
//                   (null se o item não tem estoqueTotal definido)
//
// `disponivelEfetivo`: versão "nunca-negativa" pro UI. Se a contagem der
// negativo (ex.: admin reduziu o total pra menos do que já está em uso),
// sinaliza via `alerta=true` mas mostra 0.
export interface DisponibilidadeItem {
  readonly itemId: ItemId;
  readonly nomeItem: string;
  readonly unidade: string;
  readonly estoqueTotal: number | null;
  readonly emImoveis: number;
  readonly emLavanderia: number;
  readonly disponivel: number | null;
  readonly disponivelEfetivo: number;
  readonly alertaNegativo: boolean;
  readonly abaixoMinimo: boolean;
  readonly estoqueMinimo: number | null;
  readonly ativo: boolean;
}

// Saldo é SEMPRE projeção sobre o log de movimentações. Nada é armazenado.
// Regra única:
//   saldo(item, local) = Σ qtd (destino=local) − Σ qtd (origem=local)
// Essa regra vale para todos os tipos de movimentação, porque a semântica
// de cada tipo foi codificada em "quem é origem" e "quem é destino".
export class SaldoService {
  constructor(
    private readonly movimentacoes: MovimentacaoRepository,
    // Opcional: só é necessário para computar DisponibilidadeItem. Services
    // legados que injetam só `movimentacoes` (testes antigos etc.) continuam
    // funcionando para os métodos de saldo puro.
    private readonly itens?: ItemRepository,
  ) {}

  // Computa a quebra de disponibilidade de um item: em imóveis, em
  // lavanderia, disponível no depósito. Requer que o repositório de
  // itens tenha sido injetado — lança caso não tenha.
  async disponibilidadeDoItem(itemId: ItemId): Promise<DisponibilidadeItem | null> {
    const item = await this.resolverItens().then((repo) => repo.porId(itemId));
    if (!item) return null;
    const movs = await this.movimentacoes.listar({ itemId });
    return this.projetarDisponibilidade(item, movs);
  }

  async disponibilidadeDeTodos(opts?: {
    apenasAtivos?: boolean;
  }): Promise<DisponibilidadeItem[]> {
    const itens = await this.resolverItens().then((repo) =>
      repo.listar({ apenasAtivos: opts?.apenasAtivos }),
    );
    const movs = await this.movimentacoes.listar();
    const porItem = new Map<ItemId, Movimentacao[]>();
    for (const m of movs) {
      const arr = porItem.get(m.itemId);
      if (arr) arr.push(m);
      else porItem.set(m.itemId, [m]);
    }
    return itens
      .map((item) => this.projetarDisponibilidade(item, porItem.get(item.id) ?? []))
      .sort((a, b) => a.nomeItem.localeCompare(b.nomeItem, 'pt-BR'));
  }

  private resolverItens(): Promise<ItemRepository> {
    if (!this.itens) {
      return Promise.reject(
        new Error(
          'SaldoService: disponibilidadeDoItem requer ItemRepository injetado no construtor',
        ),
      );
    }
    return Promise.resolve(this.itens);
  }

  private projetarDisponibilidade(item: Item, movs: readonly Movimentacao[]): DisponibilidadeItem {
    let emImoveis = 0;
    let emLavanderia = 0;
    for (const m of movs) {
      if (m.tipo === 'saida_imovel') emImoveis += m.quantidade;
      else if (m.tipo === 'retorno_imovel') emImoveis -= m.quantidade;
      else if (m.tipo === 'envio_lavanderia') emLavanderia += m.quantidade;
      else if (m.tipo === 'retorno_lavanderia') emLavanderia -= m.quantidade;
      else if (m.tipo === 'ajuste' && m.loteId && m.origemId) {
        // Ajuste vinculado a lote com origem = lavanderia = baixa de
        // pendência. Sai de "em lavanderia" sem gerar retorno.
        emLavanderia -= m.quantidade;
      }
    }
    // Garante não-negativo por clamp — entradas direto no depósito ou
    // ajustes manuais podem deixar os buckets flutuando ligeiramente.
    emImoveis = Math.max(0, emImoveis);
    emLavanderia = Math.max(0, emLavanderia);

    const estoqueTotal = item.estoqueTotal;
    const disponivel =
      estoqueTotal != null ? estoqueTotal - emImoveis - emLavanderia : null;
    const disponivelEfetivo = disponivel == null ? 0 : Math.max(0, disponivel);
    const alertaNegativo = disponivel != null && disponivel < 0;
    const abaixoMinimo =
      item.estoqueMinimo != null && disponivelEfetivo < item.estoqueMinimo;

    return {
      itemId: item.id,
      nomeItem: item.nome,
      unidade: item.unidade,
      estoqueTotal,
      emImoveis,
      emLavanderia,
      disponivel,
      disponivelEfetivo,
      alertaNegativo,
      abaixoMinimo,
      estoqueMinimo: item.estoqueMinimo,
      ativo: item.ativo,
    };
  }

  async saldoDe(itemId: ItemId, localId: LocalId, ateDataHora?: string): Promise<number> {
    const movs = await this.movimentacoes.listar({ itemId, ateDataHora });
    return this.computarSaldoPonto(movs, itemId, localId);
  }

  async saldoPorItemNoLocal(localId: LocalId, ateDataHora?: string): Promise<SaldoEntrada[]> {
    const movs = await this.movimentacoes.listar({ ateDataHora });
    const acc = new Map<ItemId, number>();
    for (const m of movs) {
      if (m.destinoId === localId) acc.set(m.itemId, (acc.get(m.itemId) ?? 0) + m.quantidade);
      if (m.origemId === localId) acc.set(m.itemId, (acc.get(m.itemId) ?? 0) - m.quantidade);
    }
    return Array.from(acc.entries())
      .filter(([, q]) => q !== 0)
      .map(([itemId, quantidade]) => ({ itemId, localId, quantidade }));
  }

  async saldoPorLocalDoItem(itemId: ItemId, ateDataHora?: string): Promise<SaldoEntrada[]> {
    const movs = await this.movimentacoes.listar({ itemId, ateDataHora });
    const acc = new Map<LocalId, number>();
    for (const m of movs) {
      if (m.destinoId) acc.set(m.destinoId, (acc.get(m.destinoId) ?? 0) + m.quantidade);
      if (m.origemId) acc.set(m.origemId, (acc.get(m.origemId) ?? 0) - m.quantidade);
    }
    return Array.from(acc.entries())
      .filter(([, q]) => q !== 0)
      .map(([localId, quantidade]) => ({ itemId, localId, quantidade }));
  }

  async saldoGlobal(ateDataHora?: string): Promise<SaldoEntrada[]> {
    const movs = await this.movimentacoes.listar({ ateDataHora });
    const acc = new Map<string, SaldoEntrada>();
    const chave = (i: ItemId, l: LocalId) => `${i}::${l}`;
    const bump = (itemId: ItemId, localId: LocalId, delta: number) => {
      const k = chave(itemId, localId);
      const atual = acc.get(k)?.quantidade ?? 0;
      acc.set(k, { itemId, localId, quantidade: atual + delta });
    };
    for (const m of movs) {
      if (m.destinoId) bump(m.itemId, m.destinoId, m.quantidade);
      if (m.origemId) bump(m.itemId, m.origemId, -m.quantidade);
    }
    return Array.from(acc.values()).filter((e) => e.quantidade !== 0);
  }

  // Relatório de reconciliação: compara envio→retorno para diagnóstico de perdas.
  // Não cria "perda" automaticamente — só expõe a diferença para que o operador
  // registre um 'ajuste' explícito.
  async discrepanciaLavanderia(desdeDataHora?: string, ateDataHora?: string): Promise<DiscrepanciaCiclo[]> {
    const [enviadas, retornadas] = await Promise.all([
      this.movimentacoes.listar({ tipo: 'envio_lavanderia', desdeDataHora, ateDataHora }),
      this.movimentacoes.listar({ tipo: 'retorno_lavanderia', desdeDataHora, ateDataHora }),
    ]);
    return this.diferencaPorItem(enviadas, retornadas);
  }

  async discrepanciaImoveis(desdeDataHora?: string, ateDataHora?: string): Promise<DiscrepanciaCiclo[]> {
    const [saidas, retornos] = await Promise.all([
      this.movimentacoes.listar({ tipo: 'saida_imovel', desdeDataHora, ateDataHora }),
      this.movimentacoes.listar({ tipo: 'retorno_imovel', desdeDataHora, ateDataHora }),
    ]);
    return this.diferencaPorItem(saidas, retornos);
  }

  private computarSaldoPonto(movs: readonly Movimentacao[], itemId: ItemId, localId: LocalId): number {
    let saldo = 0;
    for (const m of movs) {
      if (m.itemId !== itemId) continue;
      if (m.destinoId === localId) saldo += m.quantidade;
      if (m.origemId === localId) saldo -= m.quantidade;
    }
    return saldo;
  }

  private diferencaPorItem(
    idas: readonly Movimentacao[],
    voltas: readonly Movimentacao[],
  ): DiscrepanciaCiclo[] {
    const soma = (lista: readonly Movimentacao[]) => {
      const m = new Map<ItemId, number>();
      for (const mv of lista) m.set(mv.itemId, (m.get(mv.itemId) ?? 0) + mv.quantidade);
      return m;
    };
    const somaIdas = soma(idas);
    const somaVoltas = soma(voltas);
    const chaves = new Set<ItemId>([...somaIdas.keys(), ...somaVoltas.keys()]);
    const resultado: DiscrepanciaCiclo[] = [];
    for (const itemId of chaves) {
      const totalEnviado = somaIdas.get(itemId) ?? 0;
      const totalRetornado = somaVoltas.get(itemId) ?? 0;
      resultado.push({
        itemId,
        totalEnviado,
        totalRetornado,
        diferenca: totalEnviado - totalRetornado,
      });
    }
    return resultado;
  }

  // Valida se há estoque suficiente para retirar `quantidade` do item na
  // origem indicada. Ponto único de verificação usado por todas as ops
  // que exigem saldo na origem (envio pra lavanderia, saída pra imóvel,
  // ajuste com origem).
  //
  // Regra:
  //   - item.estoqueTotal definido → usa DISPONIBILIDADE calculada
  //     (total − em_imoveis − em_lavanderia). É o novo modelo em que o
  //     admin declara o inventário comprado, o sistema calcula buckets.
  //   - item.estoqueTotal === null → fallback legacy via `saldoDe(item,
  //     origem)`. Mantém compatibilidade com catálogos antigos que não
  //     setaram o total ainda.
  //
  // Erros jogados são DomainError (ValidationError/NotFoundError/
  // EstoqueInsuficienteError/SaldoInsuficienteError) → as actions
  // mostram a mensagem amigável pra funcionária sem "Erro inesperado".
  async garantirEstoqueParaSaida(
    itemId: ItemId,
    origemId: LocalId,
    quantidade: number,
  ): Promise<void> {
    if (!this.itens) {
      // Sem ItemRepository: cai no modo legacy por segurança. Testes
      // antigos que injetam só o movimentações seguem funcionando.
      const saldo = await this.saldoDe(itemId, origemId);
      if (saldo < quantidade) {
        throw new SaldoInsuficienteError(itemId, origemId, saldo, quantidade);
      }
      return;
    }
    const item = await this.itens.porId(itemId);
    if (!item) {
      // Não é papel deste método lançar NotFoundError — deixa para o
      // caller decidir. Mas como sem item não dá pra validar, usa modo
      // conservador (legacy) até o caller falhar na resolução.
      const saldo = await this.saldoDe(itemId, origemId);
      if (saldo < quantidade) {
        throw new SaldoInsuficienteError(itemId, origemId, saldo, quantidade);
      }
      return;
    }
    if (item.estoqueTotal != null) {
      const d = await this.disponibilidadeDoItem(itemId);
      // disponibilidadeDoItem retorna null só quando item não existe —
      // já cobrimos acima.
      const disponivel = d?.disponivelEfetivo ?? 0;
      if (disponivel < quantidade) {
        throw new EstoqueInsuficienteError(item.nome, disponivel, quantidade);
      }
      return;
    }
    // Legacy: item sem estoqueTotal ainda responde pela soma
    // entrada/saída por local. Mensagem usa nome do item pra não vazar
    // id técnico pra UI.
    const saldo = await this.saldoDe(itemId, origemId);
    if (saldo < quantidade) {
      throw new EstoqueInsuficienteError(item.nome, saldo, quantidade);
    }
  }
}
