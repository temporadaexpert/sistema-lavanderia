import type { SupabaseClient } from '@supabase/supabase-js';
import type { Item } from '@/domain/entities/Item';
import { CategoryId, type ItemId } from '@/domain/types/ids';
import type { ItemRepository } from '@/application/ports/ItemRepository';

// Linha snake_case da tabela `itens`. Confinada ao repositório — services
// e UI continuam consumindo `Item` (camelCase).
interface ItemRow {
  readonly id: string;
  readonly nome: string;
  readonly categoria_id: string;
  readonly categoria: string;
  readonly unidade: string;
  // Postgres numeric vira number na serialização JSON do PostgREST. Em casos
  // raros (precisão alta) pode vir como string — coerção defensiva abaixo.
  readonly valor_unitario: number | string | null;
  readonly estoque_minimo: number | null;
  readonly estoque_total: number | null;
  readonly ativo: boolean;
  readonly criado_em: string;
}

const TABELA = 'itens';

// Coerção defensiva: domain define valorUnitario como number|null. Garante
// que round-trip via Postgres numeric não vaze string pra cima da camada
// de service mesmo se o SDK escolher serializar como string.
function numericToNumber(v: number | string | null): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToItem(row: ItemRow): Item {
  return {
    id: row.id as ItemId,
    nome: row.nome,
    categoriaId: row.categoria_id as CategoryId,
    categoria: row.categoria,
    unidade: row.unidade,
    valorUnitario: numericToNumber(row.valor_unitario),
    estoqueMinimo: row.estoque_minimo,
    estoqueTotal: row.estoque_total,
    ativo: row.ativo,
    criadoEm: row.criado_em,
  };
}

function itemToRow(i: Item): ItemRow {
  return {
    id: i.id,
    nome: i.nome,
    categoria_id: i.categoriaId,
    categoria: i.categoria,
    unidade: i.unidade,
    valor_unitario: i.valorUnitario,
    estoque_minimo: i.estoqueMinimo,
    estoque_total: i.estoqueTotal,
    ativo: i.ativo,
    criado_em: i.criadoEm,
  };
}

// Implementação Supabase do ItemRepository. Mesma semântica do Json/InMemory.
//
// FK categoria_id é validada no banco (itens.categoria_id REFERENCES
// categorias(id) ON DELETE RESTRICT). Insert com categoria_id inexistente
// falha com erro de FK do Postgres — propagado como Error com prefixo do
// método. Não duplicamos a validação no app: o ItemService já checa
// `categorias.porId` antes de chamar o repo (mensagem amigável); o FK do
// banco é a rede de segurança contra bug ou race condition.
//
// Sem `limpar()`: o port não expõe. Cleanup de teste fala direto com o
// SupabaseClient (e respeita ordem de FK: itens antes de categorias).
export class SupabaseItemRepository implements ItemRepository {
  constructor(private readonly client: SupabaseClient) {}

  async criar(item: Item): Promise<void> {
    const { error } = await this.client.from(TABELA).insert(itemToRow(item));
    if (error) throw new Error(`Falha ao criar item: ${error.message}`);
  }

  async atualizar(item: Item): Promise<void> {
    const { data, error } = await this.client
      .from(TABELA)
      .update(itemToRow(item))
      .eq('id', item.id)
      .select('id');
    if (error) throw new Error(`Falha ao atualizar item: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(`Item não encontrado para atualizar: ${item.id}`);
    }
  }

  async porId(id: ItemId): Promise<Item | null> {
    const { data, error } = await this.client
      .from(TABELA)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`Falha ao buscar item: ${error.message}`);
    return data ? rowToItem(data as ItemRow) : null;
  }

  async listar(opts?: { apenasAtivos?: boolean }): Promise<Item[]> {
    let query = this.client.from(TABELA).select('*');
    if (opts?.apenasAtivos) query = query.eq('ativo', true);
    const { data, error } = await query;
    if (error) throw new Error(`Falha ao listar itens: ${error.message}`);
    return (data ?? []).map((row) => rowToItem(row as ItemRow));
  }
}
