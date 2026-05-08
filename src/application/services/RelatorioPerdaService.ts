import type { Lote } from '@/domain/entities/Lote';
import type { ItemId, LoteId } from '@/domain/types/ids';
import type { MotivoFechamento } from '@/domain/types/enums';
import type { ItemRepository } from '../ports/ItemRepository';
import type { LoteRepository } from '../ports/LoteRepository';
import type { MovimentacaoRepository } from '../ports/MovimentacaoRepository';

export interface PeriodoFiltro {
  readonly desde?: string;
  readonly ate?: string;
}

export interface ResumoPerdas {
  readonly totalPecas: number;
  readonly valorEstimado: number;
  readonly lotesEncerrados: number;
  readonly motivoMaisFrequente: {
    readonly motivo: MotivoFechamento;
    readonly pecas: number;
    readonly valor: number;
  } | null;
  readonly itemMaiorPerda: {
    readonly itemId: ItemId;
    readonly nome: string;
    readonly pecas: number;
    readonly valor: number | null;
  } | null;
  readonly mediaPecasPorLote: number;
  readonly itensSemValorUnitario: number;
  readonly custoParcial: boolean;
}

export interface PerdaPorMotivo {
  readonly motivo: MotivoFechamento;
  readonly pecas: number;
  readonly valor: number;
  readonly lotesAfetados: number;
  readonly custoParcial: boolean;
}

export interface PerdaPorItem {
  readonly itemId: ItemId;
  readonly nomeItem: string;
  readonly unidade: string;
  readonly valorUnitario: number | null;
  readonly pecas: number;
  readonly valor: number | null;
  readonly lotesAfetados: number;
}

export interface PerdaPorLote {
  readonly lote: Lote;
  readonly motivo: MotivoFechamento;
  readonly encerradoEm: string;
  readonly encerradoPor: string;
  readonly pecas: number;
  readonly valor: number;
  readonly itensDistintos: number;
  readonly custoParcial: boolean;
}

export interface PerdaMensal {
  readonly mes: string;
  readonly pecas: number;
  readonly valor: number;
  readonly lotesEncerrados: number;
  readonly custoParcial: boolean;
}

// "Baixa" = uma linha (ajuste) vinculada a um lote encerrado. É a unidade
// atômica de perda no sistema. Cada agrupamento do relatório é uma soma
// sobre o conjunto de baixas do período.
//
// valorUnitario aqui = PREÇO EFETIVO (snapshot da movimentação se existir,
// senão valorUnitario atual do item, senão null). Essa é a blindagem
// contra alterações retroativas do cadastro.
interface Baixa {
  readonly lote: Lote;
  readonly motivo: MotivoFechamento;
  readonly itemId: ItemId;
  readonly nomeItem: string;
  readonly unidade: string;
  readonly pecas: number;
  readonly valorUnitario: number | null;
  readonly valor: number | null;
}

// Serviço de projeções administrativas sobre PERDAS DECIDIDAS.
//
// Fonte de verdade (decisão explícita da etapa):
//   - LOTE com `encerradoEm != null` e `motivoFechamento != null` no período
//     (cabeçalho: motivo, data, responsável).
//   - MOVIMENTAÇÕES de tipo `ajuste` vinculadas via `loteId` aos lotes
//     encerrados (quantidades físicas, uma baixa por item).
//
// Importante: não contamos "pendência aberta" — só "perda baixada".
// Pendência ainda aberta é decisão em aberto; perda entra no relatório
// depois que o gestor encerrou o lote.
export class RelatorioPerdaService {
  constructor(
    private readonly lotes: LoteRepository,
    private readonly movs: MovimentacaoRepository,
    private readonly itens: ItemRepository,
  ) {}

  async resumo(filtro: PeriodoFiltro = {}): Promise<ResumoPerdas> {
    const baixas = await this.coletarBaixas(filtro);
    const lotesUnicos = new Set(baixas.map((b) => b.lote.id));
    const totalPecas = baixas.reduce((s, b) => s + b.pecas, 0);
    const valorEstimado = baixas.reduce((s, b) => s + (b.valor ?? 0), 0);
    const itensSemValor = new Set(
      baixas.filter((b) => b.valorUnitario == null).map((b) => b.itemId),
    ).size;

    const motivoMaisFrequente = this.acharTopMotivo(baixas);
    const itemMaiorPerda = this.acharTopItem(baixas);

    return {
      totalPecas,
      valorEstimado,
      lotesEncerrados: lotesUnicos.size,
      motivoMaisFrequente,
      itemMaiorPerda,
      mediaPecasPorLote: lotesUnicos.size > 0 ? totalPecas / lotesUnicos.size : 0,
      itensSemValorUnitario: itensSemValor,
      custoParcial: itensSemValor > 0,
    };
  }

  async porMotivo(filtro: PeriodoFiltro = {}): Promise<PerdaPorMotivo[]> {
    const baixas = await this.coletarBaixas(filtro);
    interface Acc {
      pecas: number;
      valor: number;
      lotes: Set<LoteId>;
      custoParcial: boolean;
    }
    const mapa = new Map<MotivoFechamento, Acc>();
    for (const b of baixas) {
      let acc = mapa.get(b.motivo);
      if (!acc) {
        acc = { pecas: 0, valor: 0, lotes: new Set(), custoParcial: false };
        mapa.set(b.motivo, acc);
      }
      acc.pecas += b.pecas;
      if (b.valor != null) acc.valor += b.valor;
      else acc.custoParcial = true;
      acc.lotes.add(b.lote.id);
    }
    return Array.from(mapa.entries())
      .map(([motivo, acc]) => ({
        motivo,
        pecas: acc.pecas,
        valor: acc.valor,
        lotesAfetados: acc.lotes.size,
        custoParcial: acc.custoParcial,
      }))
      .sort((a, b) => b.pecas - a.pecas || b.valor - a.valor);
  }

  async porItem(filtro: PeriodoFiltro = {}): Promise<PerdaPorItem[]> {
    const baixas = await this.coletarBaixas(filtro);
    interface Acc {
      nome: string;
      unidade: string;
      valorUnitario: number | null;
      pecas: number;
      valor: number | null;
      lotes: Set<LoteId>;
    }
    const mapa = new Map<ItemId, Acc>();
    for (const b of baixas) {
      let acc = mapa.get(b.itemId);
      if (!acc) {
        acc = {
          nome: b.nomeItem,
          unidade: b.unidade,
          valorUnitario: b.valorUnitario,
          pecas: 0,
          valor: b.valorUnitario != null ? 0 : null,
          lotes: new Set(),
        };
        mapa.set(b.itemId, acc);
      }
      acc.pecas += b.pecas;
      if (b.valor != null && acc.valor != null) acc.valor += b.valor;
      acc.lotes.add(b.lote.id);
    }
    return Array.from(mapa.entries())
      .map(([itemId, acc]) => ({
        itemId,
        nomeItem: acc.nome,
        unidade: acc.unidade,
        valorUnitario: acc.valorUnitario,
        pecas: acc.pecas,
        valor: acc.valor,
        lotesAfetados: acc.lotes.size,
      }))
      .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0) || b.pecas - a.pecas);
  }

  async porLote(filtro: PeriodoFiltro = {}): Promise<PerdaPorLote[]> {
    const baixas = await this.coletarBaixas(filtro);
    interface Acc {
      lote: Lote;
      motivo: MotivoFechamento;
      encerradoEm: string;
      encerradoPor: string;
      pecas: number;
      valor: number;
      itens: Set<ItemId>;
      custoParcial: boolean;
    }
    const mapa = new Map<LoteId, Acc>();
    for (const b of baixas) {
      let acc = mapa.get(b.lote.id);
      if (!acc) {
        acc = {
          lote: b.lote,
          motivo: b.motivo,
          encerradoEm: b.lote.encerradoEm ?? '',
          encerradoPor: b.lote.encerradoPor ?? '',
          pecas: 0,
          valor: 0,
          itens: new Set(),
          custoParcial: false,
        };
        mapa.set(b.lote.id, acc);
      }
      acc.pecas += b.pecas;
      if (b.valor != null) acc.valor += b.valor;
      else acc.custoParcial = true;
      acc.itens.add(b.itemId);
    }
    return Array.from(mapa.values())
      .map((acc) => ({
        lote: acc.lote,
        motivo: acc.motivo,
        encerradoEm: acc.encerradoEm,
        encerradoPor: acc.encerradoPor,
        pecas: acc.pecas,
        valor: acc.valor,
        itensDistintos: acc.itens.size,
        custoParcial: acc.custoParcial,
      }))
      .sort((a, b) => b.valor - a.valor || b.pecas - a.pecas);
  }

  async mensal(filtro: PeriodoFiltro = {}): Promise<PerdaMensal[]> {
    const baixas = await this.coletarBaixas(filtro);
    interface Acc {
      pecas: number;
      valor: number;
      lotes: Set<LoteId>;
      custoParcial: boolean;
    }
    const mapa = new Map<string, Acc>();
    for (const b of baixas) {
      const mes = (b.lote.encerradoEm ?? '').slice(0, 7);
      if (!mes) continue;
      let acc = mapa.get(mes);
      if (!acc) {
        acc = { pecas: 0, valor: 0, lotes: new Set(), custoParcial: false };
        mapa.set(mes, acc);
      }
      acc.pecas += b.pecas;
      if (b.valor != null) acc.valor += b.valor;
      else acc.custoParcial = true;
      acc.lotes.add(b.lote.id);
    }
    return Array.from(mapa.entries())
      .map(([mes, acc]) => ({
        mes,
        pecas: acc.pecas,
        valor: acc.valor,
        lotesEncerrados: acc.lotes.size,
        custoParcial: acc.custoParcial,
      }))
      .sort((a, b) => a.mes.localeCompare(b.mes));
  }

  private async coletarBaixas(filtro: PeriodoFiltro): Promise<Baixa[]> {
    const todosLotes = await this.lotes.listar();
    const lotesEncerrados = todosLotes.filter((l) => {
      if (!l.encerradoEm || !l.motivoFechamento) return false;
      // 'duplicado' significa "lote nunca deveria ter existido". Foi
      // cancelado via cancelarLoteDuplicado, que cancelou todas as movs
      // (envios + ajustes prévios). NÃO é perda real — exclui dos
      // relatórios pra não inflar 'Perdas no mês' fictícias.
      if (l.motivoFechamento === 'duplicado') return false;
      if (filtro.desde && l.encerradoEm < filtro.desde) return false;
      if (filtro.ate && l.encerradoEm > filtro.ate) return false;
      return true;
    });

    if (lotesEncerrados.length === 0) return [];

    const loteIds = new Set(lotesEncerrados.map((l) => l.id));
    const lotePorId = new Map(lotesEncerrados.map((l) => [l.id, l]));

    // Ajustes SEMPRE vinculados (loteId != null) e apenas dos lotes
    // encerrados no período. Assim excluímos ajustes manuais avulsos
    // (loteId=null) e ajustes de lotes ainda abertos (cenário impossível
    // hoje, mas a checagem é defensiva).
    const todosAjustes = await this.movs.listar({ tipo: 'ajuste' });
    const ajustes = todosAjustes.filter((m) => m.loteId && loteIds.has(m.loteId));

    const todosItens = await this.itens.listar();
    const itemPorId = new Map(todosItens.map((i) => [i.id, i]));

    const baixas: Baixa[] = [];
    for (const m of ajustes) {
      const lote = m.loteId ? lotePorId.get(m.loteId) : null;
      if (!lote || !lote.motivoFechamento) continue;
      const item = itemPorId.get(m.itemId);
      // Prioridade: snapshot congelado > valorUnitario atual > null.
      // Snapshot protege o relatório contra reajustes futuros do cadastro.
      // Fallback para o preço atual cobre movs legadas anteriores ao
      // snapshot ou cujo item estava sem preço no momento do registro.
      const precoEfetivo = m.precoUnitarioSnapshot ?? item?.valorUnitario ?? null;
      baixas.push({
        lote,
        motivo: lote.motivoFechamento,
        itemId: m.itemId,
        nomeItem: item?.nome ?? String(m.itemId),
        unidade: item?.unidade ?? 'un',
        pecas: m.quantidade,
        valorUnitario: precoEfetivo,
        valor: precoEfetivo != null ? m.quantidade * precoEfetivo : null,
      });
    }
    return baixas;
  }

  private acharTopMotivo(baixas: readonly Baixa[]): ResumoPerdas['motivoMaisFrequente'] {
    const porMotivo = new Map<MotivoFechamento, { pecas: number; valor: number }>();
    for (const b of baixas) {
      const atual = porMotivo.get(b.motivo) ?? { pecas: 0, valor: 0 };
      porMotivo.set(b.motivo, {
        pecas: atual.pecas + b.pecas,
        valor: atual.valor + (b.valor ?? 0),
      });
    }
    let top: ResumoPerdas['motivoMaisFrequente'] = null;
    for (const [motivo, agg] of porMotivo) {
      if (!top || agg.pecas > top.pecas) {
        top = { motivo, pecas: agg.pecas, valor: agg.valor };
      }
    }
    return top;
  }

  private acharTopItem(baixas: readonly Baixa[]): ResumoPerdas['itemMaiorPerda'] {
    interface Agg {
      nome: string;
      pecas: number;
      valor: number | null;
    }
    const porItem = new Map<ItemId, Agg>();
    for (const b of baixas) {
      const atual = porItem.get(b.itemId);
      if (atual) {
        porItem.set(b.itemId, {
          nome: atual.nome,
          pecas: atual.pecas + b.pecas,
          valor:
            b.valor == null || atual.valor == null ? null : atual.valor + b.valor,
        });
      } else {
        porItem.set(b.itemId, { nome: b.nomeItem, pecas: b.pecas, valor: b.valor });
      }
    }
    let top: ResumoPerdas['itemMaiorPerda'] = null;
    for (const [itemId, agg] of porItem) {
      if (!top || agg.pecas > top.pecas) {
        top = { itemId, nome: agg.nome, pecas: agg.pecas, valor: agg.valor };
      }
    }
    return top;
  }
}
