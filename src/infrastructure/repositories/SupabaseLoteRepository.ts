import type { SupabaseClient } from '@supabase/supabase-js';
import type { Lote } from '@/domain/entities/Lote';
import type { LocalId, LoteId } from '@/domain/types/ids';
import type {
  MotivoFechamento,
  OrigemDivergencia,
} from '@/domain/types/enums';
import type { LoteFiltro, LoteRepository } from '@/application/ports/LoteRepository';

// Linha snake_case da tabela `lotes_lavanderia`. Confinada ao repositório —
// services e UI continuam consumindo `Lote` (camelCase).
interface LoteRow {
  readonly id: string;
  readonly codigo: string;
  readonly criado_em: string;
  readonly data_envio: string;
  readonly origem_id: string;
  readonly destino_id: string;
  readonly responsavel: string;
  readonly observacao: string | null;
  readonly encerrado_em: string | null;
  readonly encerrado_por: string | null;
  readonly motivo_fechamento: string | null;
  readonly motivo_descricao: string | null;
  // CHECK no schema aceita 'lavanderia' | 'imovel' | 'operacao' |
  // 'desconhecida' | null. Lotes pré-existentes têm null (campo
  // adicionado por migração).
  readonly origem_divergencia: string | null;
}

const TABELA = 'lotes_lavanderia';

function rowToLote(row: LoteRow): Lote {
  return {
    id: row.id as LoteId,
    codigo: row.codigo,
    criadoEm: row.criado_em,
    dataEnvio: row.data_envio,
    origemId: row.origem_id as LocalId,
    destinoId: row.destino_id as LocalId,
    responsavel: row.responsavel,
    observacao: row.observacao,
    encerradoEm: row.encerrado_em,
    encerradoPor: row.encerrado_por,
    // Schema CHECK garante que motivo_fechamento é um dos valores do enum
    // ou null. Cast seguro porque o banco rejeita valores fora da lista.
    motivoFechamento: row.motivo_fechamento as MotivoFechamento | null,
    motivoDescricao: row.motivo_descricao,
    // Schema CHECK garante valor dentro do enum ou null — cast seguro.
    // PostgREST devolve undefined em colunas adicionadas por migração que
    // foram lidas via cliente cacheado antes do schema reload; coerce
    // pra null defensivamente.
    origemDivergencia:
      (row.origem_divergencia ?? null) as OrigemDivergencia | null,
  };
}

function loteToRow(l: Lote): LoteRow {
  return {
    id: l.id,
    codigo: l.codigo,
    criado_em: l.criadoEm,
    data_envio: l.dataEnvio,
    origem_id: l.origemId,
    destino_id: l.destinoId,
    responsavel: l.responsavel,
    observacao: l.observacao,
    encerrado_em: l.encerradoEm,
    encerrado_por: l.encerradoPor,
    motivo_fechamento: l.motivoFechamento,
    motivo_descricao: l.motivoDescricao,
    origem_divergencia: l.origemDivergencia,
  };
}

// Implementação Supabase do LoteRepository. Mesma semântica do Json/InMemory.
//
// Invariantes enforçados pelo banco (CHECKs e FKs do schema):
//   - origem_id e destino_id devem existir em `locais` (FKs RESTRICT).
//   - codigo é UNIQUE — INSERT duplicado falha.
//   - constraint `lotes_encerramento_consistente`: encerrado_em, encerrado_por
//     e motivo_fechamento devem estar todos null OU todos preenchidos. Estados
//     parciais (ex.: encerrado_em sem motivo) são rejeitados pelo banco.
//
// Esses invariantes vivem também no LoteLavanderiaService.encerrarComPendencia
// (mensagens amigáveis), mas o banco é a rede de segurança final.
export class SupabaseLoteRepository implements LoteRepository {
  constructor(private readonly client: SupabaseClient) {}

  async criar(lote: Lote): Promise<void> {
    const { error } = await this.client.from(TABELA).insert(loteToRow(lote));
    if (error) throw new Error(`Falha ao criar lote: ${error.message}`);
  }

  async atualizar(lote: Lote): Promise<void> {
    const { data, error } = await this.client
      .from(TABELA)
      .update(loteToRow(lote))
      .eq('id', lote.id)
      .select('id');
    if (error) throw new Error(`Falha ao atualizar lote: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(`Lote não encontrado para atualizar: ${lote.id}`);
    }
  }

  async porId(id: LoteId): Promise<Lote | null> {
    const { data, error } = await this.client
      .from(TABELA)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Falha ao buscar lote: ${error.message}`);
    return data ? rowToLote(data as LoteRow) : null;
  }

  async porCodigo(codigo: string): Promise<Lote | null> {
    const { data, error } = await this.client
      .from(TABELA)
      .select('*')
      .eq('codigo', codigo)
      .maybeSingle();
    if (error) throw new Error(`Falha ao buscar lote por código: ${error.message}`);
    return data ? rowToLote(data as LoteRow) : null;
  }

  async listar(filtro?: LoteFiltro): Promise<Lote[]> {
    let query = this.client.from(TABELA).select('*');
    if (filtro?.destinoId) query = query.eq('destino_id', filtro.destinoId);
    if (filtro?.desdeDataEnvio) query = query.gte('data_envio', filtro.desdeDataEnvio);
    if (filtro?.ateDataEnvio) query = query.lte('data_envio', filtro.ateDataEnvio);
    const { data, error } = await query;
    if (error) throw new Error(`Falha ao listar lotes: ${error.message}`);
    return (data ?? []).map((row) => rowToLote(row as LoteRow));
  }

  async limpar(): Promise<void> {
    const { error } = await this.client
      .from(TABELA)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw new Error(`Falha ao limpar lotes: ${error.message}`);
  }
}
