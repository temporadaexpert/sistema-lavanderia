import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { ItemId, LocalId } from '@/domain/types/ids';
import type { MovimentacaoRepository } from '../ports/MovimentacaoRepository';

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

// Saldo é SEMPRE projeção sobre o log de movimentações. Nada é armazenado.
// Regra única:
//   saldo(item, local) = Σ qtd (destino=local) − Σ qtd (origem=local)
// Essa regra vale para todos os tipos de movimentação, porque a semântica
// de cada tipo foi codificada em "quem é origem" e "quem é destino".
export class SaldoService {
  constructor(private readonly movimentacoes: MovimentacaoRepository) {}

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
}
