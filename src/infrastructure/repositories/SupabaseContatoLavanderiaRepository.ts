import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContatoLavanderia } from '@/domain/entities/ContatoLavanderia';
import type { ContatoLavanderiaId, LoteId } from '@/domain/types/ids';
import type { TipoContatoLavanderia } from '@/domain/types/enums';
import type { ContatoLavanderiaRepository } from '@/application/ports/ContatoLavanderiaRepository';

// Linha snake_case da tabela `contatos_lavanderia`. Confinada ao repositório.
interface ContatoRow {
  readonly id: string;
  readonly lote_id: string;
  readonly data_hora: string;
  readonly responsavel: string;
  readonly tipo: string;
  readonly observacao: string | null;
  readonly proxima_acao: string | null;
  // Aceita ISO date (YYYY-MM-DD) ou ISO datetime — text no schema
  // pra preservar exatamente o formato que veio do form.
  readonly promessa_retorno_data: string | null;
  readonly registrado_em: string;
}

const TABELA = 'contatos_lavanderia';

function rowToContato(row: ContatoRow): ContatoLavanderia {
  return {
    id: row.id as ContatoLavanderiaId,
    loteId: row.lote_id as LoteId,
    dataHora: row.data_hora,
    responsavel: row.responsavel,
    // CHECK do schema garante valor dentro do enum.
    tipo: row.tipo as TipoContatoLavanderia,
    observacao: row.observacao,
    proximaAcao: row.proxima_acao,
    promessaRetornoData: row.promessa_retorno_data,
    registradoEm: row.registrado_em,
  };
}

function contatoToRow(c: ContatoLavanderia): ContatoRow {
  return {
    id: c.id,
    lote_id: c.loteId,
    data_hora: c.dataHora,
    responsavel: c.responsavel,
    tipo: c.tipo,
    observacao: c.observacao,
    proxima_acao: c.proximaAcao,
    promessa_retorno_data: c.promessaRetornoData,
    registrado_em: c.registradoEm,
  };
}

// Implementação Supabase do ContatoLavanderiaRepository. Append-only por
// design — port não expõe atualizar/delete por contato individual. Pra
// "corrigir" um contato registrado errado, o fluxo é registrar outro
// contato explicando (mesmo do CategoryService.atualizar não existir
// como invalidate).
//
// Invariantes enforçados pelo banco:
//   - lote_id REFERENCES lotes_lavanderia(id) RESTRICT
//   - tipo in (whatsapp, telefone, email, presencial, outro)
//
// Substitui o InMemoryContatoLavanderiaRepository que perde histórico em
// cada restart (latent bug em produção, agendado pra resolver junto da
// migração Supabase).
//
// Ordenação: listar/listarPorLote ordena por data_hora ASC. InMemory
// preserva ordem de inserção (que tipicamente é cronológica), então
// adicionar ORDER BY no Supabase é superset compatível e dá determinismo
// para consumidores como ContatoLavanderiaService.contadorPorlote.
export class SupabaseContatoLavanderiaRepository
  implements ContatoLavanderiaRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async registrar(contato: ContatoLavanderia): Promise<void> {
    const { error } = await this.client.from(TABELA).insert(contatoToRow(contato));
    if (error) throw new Error(`Falha ao registrar contato: ${error.message}`);
  }

  async listarPorLote(loteId: LoteId): Promise<ContatoLavanderia[]> {
    const { data, error } = await this.client
      .from(TABELA)
      .select('*')
      .eq('lote_id', loteId)
      .order('data_hora', { ascending: true });
    if (error) throw new Error(`Falha ao listar contatos do lote: ${error.message}`);
    return (data ?? []).map((row) => rowToContato(row as ContatoRow));
  }

  async listar(): Promise<ContatoLavanderia[]> {
    const { data, error } = await this.client
      .from(TABELA)
      .select('*')
      .order('data_hora', { ascending: true });
    if (error) throw new Error(`Falha ao listar contatos: ${error.message}`);
    return (data ?? []).map((row) => rowToContato(row as ContatoRow));
  }

  async limpar(): Promise<void> {
    const { error } = await this.client
      .from(TABELA)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw new Error(`Falha ao limpar contatos: ${error.message}`);
  }
}
