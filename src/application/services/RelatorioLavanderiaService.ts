import type { Item } from '@/domain/entities/Item';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { ItemId } from '@/domain/types/ids';
import type { ItemRepository } from '../ports/ItemRepository';
import type { MovimentacaoRepository } from '../ports/MovimentacaoRepository';

export interface PeriodoFiltro {
  readonly desde?: string;
  readonly ate?: string;
}

export interface DetalheItemLavanderia {
  readonly itemId: ItemId;
  readonly nomeItem: string;
  readonly categoria: string;
  readonly unidade: string;
  readonly totalEnviado: number;
  readonly totalRetornado: number;
  readonly diferencaPecas: number;
  // Preço atual do item no cadastro (para referência visual na UI).
  // NÃO é usado no cálculo do custo — o custo abaixo já reflete snapshots
  // congelados em cada movimentação.
  readonly valorUnitario: number | null;
  // Custo = Σ (quantidade_i × preço_i) onde preço_i vem do snapshot da
  // movimentação ou, como fallback, do valorUnitario atual do item.
  // null quando nenhuma contribuição teve preço resolvível.
  readonly custoEnviado: number | null;
  readonly custoRetornado: number | null;
  readonly diferencaCusto: number | null;
  // Sinalizadores internos (usados pelo resumo para custo parcial). A UI
  // é livre para consumir, mas o controle de exibição principal continua
  // sendo `valorUnitario == null` (catálogo sem preço hoje).
  readonly algumaMovSemPreco: boolean;
}

export interface ResumoLavanderia {
  readonly totalEnviado: number;
  readonly totalRetornado: number;
  readonly diferencaPecas: number;
  readonly custoEnviado: number;
  readonly custoRetornado: number;
  readonly diferencaCusto: number;
  // Itens movimentados sem preço cadastrado no catálogo atual — gestor
  // pode corrigir. Independente de snapshots (o snapshot antigo pode
  // existir mesmo sem preço atual).
  readonly itensSemValorUnitario: number;
  // Ao menos uma movimentação do período não teve preço resolvível
  // (nem snapshot, nem valorUnitario atual).
  readonly custoParcial: boolean;
}

export interface ResumoMensal {
  readonly mes: string;
  readonly totalEnviado: number;
  readonly totalRetornado: number;
  readonly diferencaPecas: number;
  readonly custoEnviado: number;
  readonly custoRetornado: number;
  readonly diferencaCusto: number;
  readonly custoParcial: boolean;
}

// Projeções administrativas sobre movimentações de lavanderia.
//
// Fonte de preço (ordem de prioridade):
//   1. movimentacao.precoUnitarioSnapshot — congelado no momento do
//      registro (ver MovimentacaoService + REGRAS_MOVIMENTACAO).
//   2. item.valorUnitario — cadastro atual, usado como fallback para
//      dados legados (sem snapshot) ou quando o snapshot nasceu null.
//   3. null — sem preço conhecido: contribuição entra como 0 mas o
//      relatório marca custoParcial para a UI sinalizar.
//
// Agregamos CUSTO mov-a-mov (não qty × preço-único), porque o preço pode
// variar entre movimentações do mesmo item se o gestor reajustou o
// cadastro entre elas. Essa é a blindagem contra alteração retroativa.
export class RelatorioLavanderiaService {
  constructor(
    private readonly movimentacoes: MovimentacaoRepository,
    private readonly itens: ItemRepository,
  ) {}

  async detalhePorItem(filtro: PeriodoFiltro = {}): Promise<DetalheItemLavanderia[]> {
    const [enviadas, retornadas, todosItens] = await Promise.all([
      this.movimentacoes.listar({
        tipo: 'envio_lavanderia',
        desdeDataHora: filtro.desde,
        ateDataHora: filtro.ate,
      }),
      this.movimentacoes.listar({
        tipo: 'retorno_lavanderia',
        desdeDataHora: filtro.desde,
        ateDataHora: filtro.ate,
      }),
      this.itens.listar(),
    ]);

    const itensPorId = new Map(todosItens.map((i) => [i.id, i]));

    interface Agg {
      totalEnviado: number;
      totalRetornado: number;
      custoEnviado: number;
      custoRetornado: number;
      contribuiuEnviado: boolean; // pelo menos uma mov do lado enviado teve preço
      contribuiuRetornado: boolean;
      algumaMovSemPreco: boolean;
    }
    const agg = new Map<ItemId, Agg>();
    const obter = (itemId: ItemId): Agg => {
      let a = agg.get(itemId);
      if (!a) {
        a = {
          totalEnviado: 0,
          totalRetornado: 0,
          custoEnviado: 0,
          custoRetornado: 0,
          contribuiuEnviado: false,
          contribuiuRetornado: false,
          algumaMovSemPreco: false,
        };
        agg.set(itemId, a);
      }
      return a;
    };

    for (const m of enviadas) {
      const a = obter(m.itemId);
      a.totalEnviado += m.quantidade;
      const preco = this.precoEfetivo(m, itensPorId);
      if (preco != null) {
        a.custoEnviado += m.quantidade * preco;
        a.contribuiuEnviado = true;
      } else if (m.quantidade > 0) {
        a.algumaMovSemPreco = true;
      }
    }
    for (const m of retornadas) {
      const a = obter(m.itemId);
      a.totalRetornado += m.quantidade;
      const preco = this.precoEfetivo(m, itensPorId);
      if (preco != null) {
        a.custoRetornado += m.quantidade * preco;
        a.contribuiuRetornado = true;
      } else if (m.quantidade > 0) {
        a.algumaMovSemPreco = true;
      }
    }

    const resultado: DetalheItemLavanderia[] = [];
    for (const [itemId, a] of agg) {
      const item = itensPorId.get(itemId);
      const valorUnitario = item?.valorUnitario ?? null;

      // null = nada a somar para este lado (sem preço em nenhuma
      // contribuição daquele lado no período).
      const custoEnviado =
        a.totalEnviado === 0 ? null : a.contribuiuEnviado ? a.custoEnviado : null;
      const custoRetornado =
        a.totalRetornado === 0 ? null : a.contribuiuRetornado ? a.custoRetornado : null;
      const diferencaCusto =
        custoEnviado != null && custoRetornado != null ? custoEnviado - custoRetornado : null;

      resultado.push({
        itemId,
        nomeItem: item?.nome ?? `(item ${itemId})`,
        categoria: item?.categoria ?? '',
        unidade: item?.unidade ?? 'un',
        totalEnviado: a.totalEnviado,
        totalRetornado: a.totalRetornado,
        diferencaPecas: a.totalEnviado - a.totalRetornado,
        valorUnitario,
        custoEnviado,
        custoRetornado,
        diferencaCusto,
        algumaMovSemPreco: a.algumaMovSemPreco,
      });
    }

    return resultado;
  }

  async resumo(filtro: PeriodoFiltro = {}): Promise<ResumoLavanderia> {
    const detalhes = await this.detalhePorItem(filtro);

    let totalEnviado = 0;
    let totalRetornado = 0;
    let custoEnviado = 0;
    let custoRetornado = 0;
    let itensSemValorUnitario = 0;
    let custoParcial = false;

    for (const d of detalhes) {
      totalEnviado += d.totalEnviado;
      totalRetornado += d.totalRetornado;
      custoEnviado += d.custoEnviado ?? 0;
      custoRetornado += d.custoRetornado ?? 0;

      // "custo parcial" agora é operacional: houve movimentação sem
      // preço resolvível. Independe do valorUnitario atual estar ou não
      // cadastrado (pode haver histórico com snapshot válido mesmo sem
      // preço atual).
      if (d.algumaMovSemPreco) custoParcial = true;

      // "itens sem preço atual" continua sendo o que o gestor pode
      // corrigir no cadastro — mantém o indicador acionável.
      if (d.valorUnitario == null && (d.totalEnviado > 0 || d.totalRetornado > 0)) {
        itensSemValorUnitario += 1;
      }
    }

    return {
      totalEnviado,
      totalRetornado,
      diferencaPecas: totalEnviado - totalRetornado,
      custoEnviado,
      custoRetornado,
      diferencaCusto: custoEnviado - custoRetornado,
      itensSemValorUnitario,
      custoParcial,
    };
  }

  async resumoMensal(filtro: PeriodoFiltro = {}): Promise<ResumoMensal[]> {
    const [enviadas, retornadas, todosItens] = await Promise.all([
      this.movimentacoes.listar({
        tipo: 'envio_lavanderia',
        desdeDataHora: filtro.desde,
        ateDataHora: filtro.ate,
      }),
      this.movimentacoes.listar({
        tipo: 'retorno_lavanderia',
        desdeDataHora: filtro.desde,
        ateDataHora: filtro.ate,
      }),
      this.itens.listar(),
    ]);
    const itensPorId = new Map(todosItens.map((i) => [i.id, i]));

    interface Bucket {
      totalEnviado: number;
      totalRetornado: number;
      custoEnviado: number;
      custoRetornado: number;
      custoParcial: boolean;
    }
    const buckets = new Map<string, Bucket>();
    const obter = (mes: string): Bucket => {
      let b = buckets.get(mes);
      if (!b) {
        b = {
          totalEnviado: 0,
          totalRetornado: 0,
          custoEnviado: 0,
          custoRetornado: 0,
          custoParcial: false,
        };
        buckets.set(mes, b);
      }
      return b;
    };

    const acumular = (movs: readonly Movimentacao[], lado: 'enviado' | 'retornado') => {
      for (const m of movs) {
        const mes = m.dataHora.slice(0, 7);
        const b = obter(mes);
        const preco = this.precoEfetivo(m, itensPorId);
        if (lado === 'enviado') {
          b.totalEnviado += m.quantidade;
          if (preco != null) b.custoEnviado += m.quantidade * preco;
          else if (m.quantidade > 0) b.custoParcial = true;
        } else {
          b.totalRetornado += m.quantidade;
          if (preco != null) b.custoRetornado += m.quantidade * preco;
          else if (m.quantidade > 0) b.custoParcial = true;
        }
      }
    };

    acumular(enviadas, 'enviado');
    acumular(retornadas, 'retornado');

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, b]) => ({
        mes,
        totalEnviado: b.totalEnviado,
        totalRetornado: b.totalRetornado,
        diferencaPecas: b.totalEnviado - b.totalRetornado,
        custoEnviado: b.custoEnviado,
        custoRetornado: b.custoRetornado,
        diferencaCusto: b.custoEnviado - b.custoRetornado,
        custoParcial: b.custoParcial,
      }));
  }

  // Preço efetivo de UMA movimentação, respeitando a ordem de prioridade:
  // snapshot congelado > cadastro atual > null.
  private precoEfetivo(
    m: Movimentacao,
    itensPorId: ReadonlyMap<ItemId, Item>,
  ): number | null {
    if (m.precoUnitarioSnapshot != null) return m.precoUnitarioSnapshot;
    const item = itensPorId.get(m.itemId);
    return item?.valorUnitario ?? null;
  }
}
