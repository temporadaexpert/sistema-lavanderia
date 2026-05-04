import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseItemRepository } from './SupabaseItemRepository';
import type { Item } from '@/domain/entities/Item';
import { CategoryId, type ItemId } from '@/domain/types/ids';

// Teste de integração contra Supabase real. Mesmo gating dos outros
// (Category/Local): exige opt-in explícito por causa das deletions
// destrutivas no beforeEach.
//
//   SUPABASE_URL=https://...supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   SUPABASE_TEST_OK=1 \
//   npm test
//
// Cleanup respeita ordem de FK: itens antes de categorias (itens.categoria_id
// REFERENCES categorias(id) ON DELETE RESTRICT). Inverter quebra com FK error.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const optIn = process.env.SUPABASE_TEST_OK === '1';
const ativo = !!url && !!key && optIn;

const ID_ZERO = '00000000-0000-0000-0000-000000000000';

function novoItemId(): ItemId {
  return crypto.randomUUID() as ItemId;
}

function novoCategoryId(): CategoryId {
  return crypto.randomUUID() as CategoryId;
}

function novoItem(categoriaId: CategoryId, overrides: Partial<Item> = {}): Item {
  return {
    id: novoItemId(),
    nome: 'Item Teste',
    categoriaId,
    categoria: 'Categoria Teste',
    ativo: true,
    unidade: 'un',
    valorUnitario: 25.5,
    estoqueMinimo: 10,
    estoqueTotal: 100,
    criadoEm: new Date().toISOString(),
    ...overrides,
  };
}

// Seeds + cleanup falam com o SupabaseClient direto. Não usamos os repos
// SupabaseCategoryRepository/SupabaseItemRepository pra setup pra deixar
// o teste auto-suficiente — falha aqui aponta direto pro SQL/SDK, não
// indireto via outro repo.
async function limpar(client: SupabaseClient): Promise<void> {
  // Ordem importa: filhos antes de pais por causa de FK RESTRICT.
  const itensErr = (await client.from('itens').delete().neq('id', ID_ZERO)).error;
  if (itensErr) throw new Error(`Falha no cleanup de itens: ${itensErr.message}`);
  const catErr = (await client.from('categorias').delete().neq('id', ID_ZERO)).error;
  if (catErr) throw new Error(`Falha no cleanup de categorias: ${catErr.message}`);
}

async function seedCategoria(client: SupabaseClient, nome = 'Cat Teste'): Promise<CategoryId> {
  const id = novoCategoryId();
  const { error } = await client.from('categorias').insert({
    id,
    nome,
    ativo: true,
    criado_em: new Date().toISOString(),
  });
  if (error) throw new Error(`Falha ao seed categoria: ${error.message}`);
  return id;
}

describe.skipIf(!ativo)('SupabaseItemRepository (integração)', () => {
  let client: SupabaseClient;
  let repo: SupabaseItemRepository;
  let categoriaId: CategoryId;

  beforeAll(() => {
    client = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    repo = new SupabaseItemRepository(client);
  });

  beforeEach(async () => {
    await limpar(client);
    categoriaId = await seedCategoria(client, 'Cat Padrão');
  });

  it('criar e porId devolve o mesmo item, com mapping snake↔camel', async () => {
    const item = novoItem(categoriaId, {
      nome: 'Toalha de banho',
      categoria: 'Cat Padrão',
      unidade: 'un',
      valorUnitario: 30,
      estoqueMinimo: 20,
      estoqueTotal: 200,
    });
    await repo.criar(item);
    const lido = await repo.porId(item.id);
    expect(lido).not.toBeNull();
    expect(lido!.id).toBe(item.id);
    expect(lido!.nome).toBe('Toalha de banho');
    expect(lido!.categoriaId).toBe(categoriaId);
    expect(lido!.categoria).toBe('Cat Padrão');
    expect(lido!.unidade).toBe('un');
    expect(lido!.valorUnitario).toBe(30);
    expect(lido!.estoqueMinimo).toBe(20);
    expect(lido!.estoqueTotal).toBe(200);
    expect(lido!.ativo).toBe(true);
    expect(new Date(lido!.criadoEm).toISOString()).toBe(item.criadoEm);
  });

  it('porId devolve null quando não existe', async () => {
    const lido = await repo.porId(novoItemId());
    expect(lido).toBeNull();
  });

  it('listar sem filtro retorna tudo', async () => {
    await repo.criar(novoItem(categoriaId, { nome: 'A' }));
    await repo.criar(novoItem(categoriaId, { nome: 'B' }));
    await repo.criar(novoItem(categoriaId, { nome: 'C' }));
    const lista = await repo.listar();
    expect(lista).toHaveLength(3);
    expect(lista.map((i) => i.nome).sort()).toEqual(['A', 'B', 'C']);
  });

  it('listar com apenasAtivos filtra ativo=false', async () => {
    const ativoItem = novoItem(categoriaId, { nome: 'Ativo' });
    const inativoItem = novoItem(categoriaId, { nome: 'Inativo', ativo: false });
    await repo.criar(ativoItem);
    await repo.criar(inativoItem);

    const todos = await repo.listar();
    expect(todos).toHaveLength(2);

    const ativos = await repo.listar({ apenasAtivos: true });
    expect(ativos).toHaveLength(1);
    expect(ativos[0]?.id).toBe(ativoItem.id);
  });

  it('atualizar substitui campos preservando id', async () => {
    const item = novoItem(categoriaId, {
      nome: 'Antigo',
      valorUnitario: 10,
      estoqueMinimo: 5,
    });
    await repo.criar(item);
    await repo.atualizar({
      ...item,
      nome: 'Renomeado',
      valorUnitario: 99.99,
      estoqueMinimo: 50,
    });
    const lido = await repo.porId(item.id);
    expect(lido!.nome).toBe('Renomeado');
    expect(lido!.valorUnitario).toBe(99.99);
    expect(lido!.estoqueMinimo).toBe(50);
    expect(lido!.id).toBe(item.id);
  });

  it('atualizar inativa preservando o resto (alternar ativo)', async () => {
    const item = novoItem(categoriaId, { nome: 'Pra inativar', ativo: true });
    await repo.criar(item);
    await repo.atualizar({ ...item, ativo: false });
    let lido = await repo.porId(item.id);
    expect(lido!.ativo).toBe(false);
    expect(lido!.nome).toBe('Pra inativar');

    // Reativar
    await repo.atualizar({ ...item, ativo: true });
    lido = await repo.porId(item.id);
    expect(lido!.ativo).toBe(true);
  });

  it('atualizar lança erro quando id não existe (mesma semântica do JSON/InMemory)', async () => {
    const fantasma = novoItem(categoriaId, { nome: 'Não existe' });
    await expect(repo.atualizar(fantasma)).rejects.toThrow(
      /não encontrado para atualizar/i,
    );
  });

  it('nullable fields (valorUnitario, estoqueMinimo, estoqueTotal) round-trip preservam null', async () => {
    const item = novoItem(categoriaId, {
      nome: 'Sem valores',
      valorUnitario: null,
      estoqueMinimo: null,
      estoqueTotal: null,
    });
    await repo.criar(item);
    const lido = await repo.porId(item.id);
    expect(lido).not.toBeNull();
    expect(lido!.valorUnitario).toBeNull();
    expect(lido!.estoqueMinimo).toBeNull();
    expect(lido!.estoqueTotal).toBeNull();
    // Campos não-nullable preservados
    expect(lido!.nome).toBe('Sem valores');
    expect(lido!.unidade).toBe('un');
    expect(lido!.categoriaId).toBe(categoriaId);
  });

  it('FK no INSERT: criar com categoria_id inexistente é rejeitado pelo banco', async () => {
    const categoriaInexistente = novoCategoryId();
    const item = novoItem(categoriaInexistente, { nome: 'FK quebrada' });
    await expect(repo.criar(item)).rejects.toThrow(/Falha ao criar item/i);
    // Nada foi persistido
    const todos = await repo.listar();
    expect(todos).toHaveLength(0);
  });

  it('FK no UPDATE: trocar categoria_id pra inexistente é rejeitado pelo banco', async () => {
    const item = novoItem(categoriaId, { nome: 'OK' });
    await repo.criar(item);
    const categoriaInexistente = novoCategoryId();
    await expect(
      repo.atualizar({ ...item, categoriaId: categoriaInexistente }),
    ).rejects.toThrow(/Falha ao atualizar item/i);
    // Estado preservado
    const lido = await repo.porId(item.id);
    expect(lido!.categoriaId).toBe(categoriaId);
  });

  it('FK ON DELETE RESTRICT: apagar categoria com item filho é rejeitado', async () => {
    await repo.criar(novoItem(categoriaId, { nome: 'Filho' }));
    const { error } = await client
      .from('categorias')
      .delete()
      .eq('id', categoriaId);
    // Postgres bloqueia a deleção pq existe item referenciando.
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/foreign key|violates|still referenced/i);
    // Item segue lá
    const lista = await repo.listar();
    expect(lista).toHaveLength(1);
  });

  it('cleanup respeita ordem de FK (sanity)', async () => {
    await repo.criar(novoItem(categoriaId, { nome: 'A apagar' }));
    expect(await repo.listar()).toHaveLength(1);
    await limpar(client);
    expect(await repo.listar()).toHaveLength(0);
    // Categorias também limpas
    const { data: cats } = await client.from('categorias').select('id');
    expect(cats).toHaveLength(0);
  });
});
