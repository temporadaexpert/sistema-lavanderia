import type { SupabaseClient } from '@supabase/supabase-js';
import type { Category } from '@/domain/entities/Category';
import type { CategoryId } from '@/domain/types/ids';
import type { CategoryRepository } from '@/application/ports/CategoryRepository';

// Shape literal da linha em `categorias` no Postgres (snake_case). Restrito
// a este repositório — services e UI continuam consumindo Category (camelCase).
interface CategoriaRow {
  readonly id: string;
  readonly nome: string;
  readonly ativo: boolean;
  readonly criado_em: string;
}

const TABELA = 'categorias';

function rowToCategory(row: CategoriaRow): Category {
  return {
    id: row.id as CategoryId,
    nome: row.nome,
    ativo: row.ativo,
    criadoEm: row.criado_em,
  };
}

function categoryToRow(c: Category): CategoriaRow {
  return {
    id: c.id,
    nome: c.nome,
    ativo: c.ativo,
    criado_em: c.criadoEm,
  };
}

// Implementação Supabase do CategoryRepository. Mesma semântica das versões
// JsonFile/InMemory — services e CategoryService.test.ts continuam válidos
// sem alteração quando este repo é injetado.
//
// Erros do banco são propagados como Error simples — a UI já trata
// DomainError (validação) na camada do service; falhas de I/O do DB são
// erros técnicos que sobem pra middleware do Next.
export class SupabaseCategoryRepository implements CategoryRepository {
  constructor(private readonly client: SupabaseClient) {}

  async criar(category: Category): Promise<void> {
    const { error } = await this.client.from(TABELA).insert(categoryToRow(category));
    if (error) throw new Error(`Falha ao criar categoria: ${error.message}`);
  }

  async atualizar(category: Category): Promise<void> {
    // Match a semântica do Json/InMemory: erro explícito se id não existe.
    // Usamos `select` no retorno pra contar linhas afetadas (Supabase JS
    // não devolve count direto sem `head: true` + count param).
    const { data, error } = await this.client
      .from(TABELA)
      .update(categoryToRow(category))
      .eq('id', category.id)
      .select('id');
    if (error) throw new Error(`Falha ao atualizar categoria: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(`Categoria não encontrada para atualizar: ${category.id}`);
    }
  }

  async porId(id: CategoryId): Promise<Category | null> {
    const { data, error } = await this.client
      .from(TABELA)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Falha ao buscar categoria: ${error.message}`);
    return data ? rowToCategory(data as CategoriaRow) : null;
  }

  async listar(opts?: { apenasAtivos?: boolean }): Promise<Category[]> {
    let query = this.client.from(TABELA).select('*');
    if (opts?.apenasAtivos) {
      query = query.eq('ativo', true);
    }
    const { data, error } = await query;
    if (error) throw new Error(`Falha ao listar categorias: ${error.message}`);
    const categorias = (data ?? []).map((row) => rowToCategory(row as CategoriaRow));
    // Ordenação pt-BR feita em JS (mesma regra das versões Json/InMemory).
    // Sort no Postgres usaria collation default que não respeita acentuação
    // brasileira de forma confiável entre instalações.
    return categorias.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  async limpar(): Promise<void> {
    // Supabase JS exige um filtro explícito em delete (proteção anti-tudo).
    // Idiomatic: filtro tautológico `id != uuid-zero` apaga todas as linhas.
    const { error } = await this.client
      .from(TABELA)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw new Error(`Falha ao limpar categorias: ${error.message}`);
  }
}
