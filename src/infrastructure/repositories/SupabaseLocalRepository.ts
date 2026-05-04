import type { SupabaseClient } from '@supabase/supabase-js';
import type { Local } from '@/domain/entities/Local';
import type { LocalId } from '@/domain/types/ids';
import type { LocalTipo } from '@/domain/types/enums';
import type { LocalRepository } from '@/application/ports/LocalRepository';

// Linha snake_case da tabela `locais`. Confinada ao repositório — services
// e UI continuam consumindo `Local` (camelCase).
interface LocalRow {
  readonly id: string;
  readonly nome: string;
  readonly tipo: LocalTipo;
  readonly ativo: boolean;
  readonly criado_em: string;
}

const TABELA = 'locais';

function rowToLocal(row: LocalRow): Local {
  return {
    id: row.id as LocalId,
    nome: row.nome,
    tipo: row.tipo,
    ativo: row.ativo,
    criadoEm: row.criado_em,
  };
}

function localToRow(l: Local): LocalRow {
  return {
    id: l.id,
    nome: l.nome,
    tipo: l.tipo,
    ativo: l.ativo,
    criado_em: l.criadoEm,
  };
}

// Implementação Supabase do LocalRepository. Mesma semântica das versões
// JsonFile/InMemory — nenhum service ou teste de service muda.
//
// Sem ordenação no listar: nem o JsonFile* nem o InMemory* ordenam (cada
// page que mostra locais aplica a ordem desejada). Mantemos paridade pra
// não introduzir comportamento divergente entre drivers.
//
// Sem `limpar()`: o port não expõe (diferente de CategoryRepository). Se
// um teste precisar zerar a tabela, fala direto com o SupabaseClient.
export class SupabaseLocalRepository implements LocalRepository {
  constructor(private readonly client: SupabaseClient) {}

  async criar(local: Local): Promise<void> {
    const { error } = await this.client.from(TABELA).insert(localToRow(local));
    if (error) throw new Error(`Falha ao criar local: ${error.message}`);
  }

  async atualizar(local: Local): Promise<void> {
    // Match a semântica do Json/InMemory: erro explícito se id não existe.
    // O `.select('id')` força o retorno das linhas afetadas pra contagem.
    const { data, error } = await this.client
      .from(TABELA)
      .update(localToRow(local))
      .eq('id', local.id)
      .select('id');
    if (error) throw new Error(`Falha ao atualizar local: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(`Local não encontrado para atualizar: ${local.id}`);
    }
  }

  async porId(id: LocalId): Promise<Local | null> {
    const { data, error } = await this.client
      .from(TABELA)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Falha ao buscar local: ${error.message}`);
    return data ? rowToLocal(data as LocalRow) : null;
  }

  async listar(opts?: { tipo?: LocalTipo; apenasAtivos?: boolean }): Promise<Local[]> {
    let query = this.client.from(TABELA).select('*');
    if (opts?.tipo) query = query.eq('tipo', opts.tipo);
    if (opts?.apenasAtivos) query = query.eq('ativo', true);
    const { data, error } = await query;
    if (error) throw new Error(`Falha ao listar locais: ${error.message}`);
    return (data ?? []).map((row) => rowToLocal(row as LocalRow));
  }
}
