import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CorrecaoAdmin,
  TipoBlocoCorrecao,
} from '@/domain/entities/CorrecaoAdmin';
import type { ItemId, LocalId, LoteId, MovimentacaoId } from '@/domain/types/ids';
import type {
  CorrecaoAdminFiltro,
  CorrecaoAdminRepository,
} from '@/application/ports/CorrecaoAdminRepository';

interface CorrecaoAdminRow {
  readonly id: string;
  readonly tipo_bloco: TipoBlocoCorrecao;
  readonly operacao_id: string | null;
  readonly item_id: string;
  readonly nome_item_snapshot: string;
  readonly lote_id: string | null;
  readonly local_id: string | null;
  readonly quantidade_anterior: number;
  readonly quantidade_nova: number;
  readonly diferenca: number;
  readonly motivo: string;
  readonly admin_responsavel: string;
  readonly corrigido_em: string;
  readonly movs_canceladas_ids: readonly string[];
  readonly movs_novas_ids: readonly string[];
  readonly observacao_automatica: string | null;
}

const TABELA = 'correcoes_admin';

function rowToCorrecao(row: CorrecaoAdminRow): CorrecaoAdmin {
  return {
    id: row.id,
    tipoBloco: row.tipo_bloco,
    operacaoId: row.operacao_id,
    itemId: row.item_id as ItemId,
    nomeItemSnapshot: row.nome_item_snapshot,
    loteId: (row.lote_id ?? null) as LoteId | null,
    localId: (row.local_id ?? null) as LocalId | null,
    quantidadeAnterior: row.quantidade_anterior,
    quantidadeNova: row.quantidade_nova,
    diferenca: row.diferenca,
    motivo: row.motivo,
    adminResponsavel: row.admin_responsavel,
    corrigidoEm: row.corrigido_em,
    movsCanceladasIds: (row.movs_canceladas_ids ?? []).map((s) => s as MovimentacaoId),
    movsNovasIds: (row.movs_novas_ids ?? []).map((s) => s as MovimentacaoId),
    observacaoAutomatica: row.observacao_automatica,
  };
}

function correcaoToRow(c: CorrecaoAdmin): CorrecaoAdminRow {
  return {
    id: c.id,
    tipo_bloco: c.tipoBloco,
    operacao_id: c.operacaoId,
    item_id: c.itemId,
    nome_item_snapshot: c.nomeItemSnapshot,
    lote_id: c.loteId,
    local_id: c.localId,
    quantidade_anterior: c.quantidadeAnterior,
    quantidade_nova: c.quantidadeNova,
    diferenca: c.diferenca,
    motivo: c.motivo,
    admin_responsavel: c.adminResponsavel,
    corrigido_em: c.corrigidoEm,
    movs_canceladas_ids: c.movsCanceladasIds.slice(),
    movs_novas_ids: c.movsNovasIds.slice(),
    observacao_automatica: c.observacaoAutomatica,
  };
}

export class SupabaseCorrecaoAdminRepository implements CorrecaoAdminRepository {
  constructor(private readonly client: SupabaseClient) {}

  async registrar(correcao: CorrecaoAdmin): Promise<void> {
    const { error } = await this.client.from(TABELA).insert(correcaoToRow(correcao));
    if (error) throw new Error(`Falha ao registrar correção: ${error.message}`);
  }

  async listar(filtro?: CorrecaoAdminFiltro): Promise<CorrecaoAdmin[]> {
    let query = this.client.from(TABELA).select('*').order('corrigido_em', {
      ascending: false,
    });
    if (filtro?.tipoBloco) query = query.eq('tipo_bloco', filtro.tipoBloco);
    if (filtro?.itemId) query = query.eq('item_id', filtro.itemId);
    if (filtro?.adminResponsavel) {
      query = query.eq('admin_responsavel', filtro.adminResponsavel);
    }
    if (filtro?.operacaoId) query = query.eq('operacao_id', filtro.operacaoId);
    if (filtro?.desde) query = query.gte('corrigido_em', filtro.desde);
    if (filtro?.ate) query = query.lte('corrigido_em', filtro.ate);

    const { data, error } = await query;
    if (error) throw new Error(`Falha ao listar correções: ${error.message}`);
    return (data ?? []).map((row) => rowToCorrecao(row as CorrecaoAdminRow));
  }

  async limpar(): Promise<void> {
    const { error } = await this.client
      .from(TABELA)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw new Error(`Falha ao limpar correções: ${error.message}`);
  }
}
