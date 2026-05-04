import type { SupabaseClient } from '@supabase/supabase-js';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { ItemId, LocalId, LoteId, MovimentacaoId } from '@/domain/types/ids';
import type { MovimentacaoTipo } from '@/domain/types/enums';
import type {
  CancelamentoPatch,
  MovimentacaoFiltro,
  MovimentacaoRepository,
} from '@/application/ports/MovimentacaoRepository';

// Linha snake_case da tabela `movimentacoes`. Confinada ao repositório.
interface MovimentacaoRow {
  readonly id: string;
  readonly data_hora: string;
  readonly item_id: string;
  readonly quantidade: number;
  readonly tipo: string;
  readonly origem_id: string | null;
  readonly destino_id: string | null;
  readonly responsavel: string;
  readonly observacao: string | null;
  readonly lote_id: string | null;
  // numeric(12,2) — PostgREST geralmente devolve number; coerção defensiva
  // pra cobrir o caso raro de string em precisão alta.
  readonly preco_unitario_snapshot: number | string | null;
  readonly registrado_em: string;
  readonly cancelada: boolean;
  readonly cancelado_em: string | null;
  readonly cancelado_por: string | null;
  readonly motivo_cancelamento: string | null;
}

const TABELA = 'movimentacoes';

function numericToNumber(v: number | string | null): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToMovimentacao(row: MovimentacaoRow): Movimentacao {
  return {
    id: row.id as MovimentacaoId,
    dataHora: row.data_hora,
    itemId: row.item_id as ItemId,
    quantidade: row.quantidade,
    // CHECK do schema garante valor dentro do enum — cast seguro.
    tipo: row.tipo as MovimentacaoTipo,
    origemId: (row.origem_id ?? null) as LocalId | null,
    destinoId: (row.destino_id ?? null) as LocalId | null,
    responsavel: row.responsavel,
    observacao: row.observacao,
    loteId: (row.lote_id ?? null) as LoteId | null,
    precoUnitarioSnapshot: numericToNumber(row.preco_unitario_snapshot),
    registradoEm: row.registrado_em,
    cancelada: row.cancelada,
    canceladoEm: row.cancelado_em,
    canceladoPor: row.cancelado_por,
    motivoCancelamento: row.motivo_cancelamento,
  };
}

function movimentacaoToRow(m: Movimentacao): MovimentacaoRow {
  return {
    id: m.id,
    data_hora: m.dataHora,
    item_id: m.itemId,
    quantidade: m.quantidade,
    tipo: m.tipo,
    origem_id: m.origemId,
    destino_id: m.destinoId,
    responsavel: m.responsavel,
    observacao: m.observacao,
    lote_id: m.loteId,
    preco_unitario_snapshot: m.precoUnitarioSnapshot,
    registrado_em: m.registradoEm,
    cancelada: m.cancelada,
    cancelado_em: m.canceladoEm,
    cancelado_por: m.canceladoPor,
    motivo_cancelamento: m.motivoCancelamento,
  };
}

// Implementação Supabase do MovimentacaoRepository. É o coração do sistema —
// SaldoService e todos os relatórios derivam projetando sobre o log.
//
// Invariantes enforçados pelo banco (CHECKs e FKs do schema):
//   - quantidade > 0
//   - tipo in (entrada_deposito, saida_imovel, retorno_imovel,
//              envio_lavanderia, retorno_lavanderia, ajuste)
//   - item_id REFERENCES itens(id) RESTRICT
//   - origem_id, destino_id REFERENCES locais(id) RESTRICT (nullable)
//   - lote_id REFERENCES lotes_lavanderia(id) RESTRICT (nullable)
//   - movs_cancelamento_consistente: (cancelada=false ∧ 3 nulls) ou
//                                     (cancelada=true ∧ 3 preenchidos)
//
// Append-only: registrar() insere; mutação só via marcarCancelada(), que
// preserva todos os campos operacionais (tipo, quantidade, etc.) e atualiza
// só os 4 campos de auditoria de cancelamento. Sem update genérico.
export class SupabaseMovimentacaoRepository implements MovimentacaoRepository {
  constructor(private readonly client: SupabaseClient) {}

  async registrar(mov: Movimentacao): Promise<void> {
    const { error } = await this.client.from(TABELA).insert(movimentacaoToRow(mov));
    if (error) throw new Error(`Falha ao registrar movimentação: ${error.message}`);
  }

  async porId(id: MovimentacaoId): Promise<Movimentacao | null> {
    const { data, error } = await this.client
      .from(TABELA)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Falha ao buscar movimentação: ${error.message}`);
    return data ? rowToMovimentacao(data as MovimentacaoRow) : null;
  }

  async listar(filtro?: MovimentacaoFiltro): Promise<Movimentacao[]> {
    let query = this.client.from(TABELA).select('*');

    // Por padrão, canceladas ficam de fora — mesma semântica do Json/InMemory.
    // Consumidores de projeção (saldo, relatórios, dashboard) nunca passam
    // incluirCanceladas, então saldo já fica blindado contra movs canceladas.
    if (!filtro?.incluirCanceladas) {
      query = query.eq('cancelada', false);
    }

    if (filtro?.itemId) query = query.eq('item_id', filtro.itemId);
    if (filtro?.tipo) query = query.eq('tipo', filtro.tipo);
    if (filtro?.loteId) query = query.eq('lote_id', filtro.loteId);

    // localId casa origem OR destino — sintaxe `.or()` do PostgREST gera
    // `(origem_id.eq.X OR destino_id.eq.X)` na cláusula WHERE, combinado
    // por AND com os outros filtros via `.eq()`.
    if (filtro?.localId) {
      query = query.or(
        `origem_id.eq.${filtro.localId},destino_id.eq.${filtro.localId}`,
      );
    }

    // Range temporal inclusivo nas duas pontas (>=/<=) — bate com o
    // Json/InMemory que usam `<` e `>` para REJEITAR (efeito: <= e >= aceitam).
    if (filtro?.desdeDataHora) query = query.gte('data_hora', filtro.desdeDataHora);
    if (filtro?.ateDataHora) query = query.lte('data_hora', filtro.ateDataHora);

    const { data, error } = await query;
    if (error) throw new Error(`Falha ao listar movimentações: ${error.message}`);
    return (data ?? []).map((row) => rowToMovimentacao(row as MovimentacaoRow));
  }

  async marcarCancelada(
    id: MovimentacaoId,
    patch: CancelamentoPatch,
  ): Promise<void> {
    // Dois roundtrips pra preservar a semântica do port:
    //   - "não encontrada" e "já cancelada" são erros distintos (caller
    //     pode mostrar mensagens diferentes pro operador).
    // Race entre SELECT e UPDATE existe mas é benigna: em concorrência,
    // o segundo cancelamento sobrescreve com mesmo valor (idempotente em
    // efeito; a CHECK do banco continua satisfeita).
    const { data: existente, error: errSelect } = await this.client
      .from(TABELA)
      .select('id, cancelada')
      .eq('id', id)
      .maybeSingle();
    if (errSelect) {
      throw new Error(`Falha ao buscar movimentação para cancelar: ${errSelect.message}`);
    }
    if (!existente) {
      throw new Error(`Movimentação não encontrada para cancelar: ${id}`);
    }
    if (existente.cancelada) {
      throw new Error(`Movimentação já cancelada: ${id}`);
    }

    // O patch sempre traz os 3 campos preenchidos (CancelamentoPatch type),
    // então o UPDATE satisfaz movs_cancelamento_consistente automaticamente.
    const { error: errUpdate } = await this.client
      .from(TABELA)
      .update({
        cancelada: true,
        cancelado_em: patch.canceladoEm,
        cancelado_por: patch.canceladoPor,
        motivo_cancelamento: patch.motivoCancelamento,
      })
      .eq('id', id);
    if (errUpdate) {
      throw new Error(`Falha ao cancelar movimentação: ${errUpdate.message}`);
    }
  }

  async limpar(): Promise<void> {
    const { error } = await this.client
      .from(TABELA)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw new Error(`Falha ao limpar movimentações: ${error.message}`);
  }
}
