import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCategoryRepository } from './SupabaseCategoryRepository';
import type { Category } from '@/domain/entities/Category';
import type { CategoryId } from '@/domain/types/ids';

// Teste de integração contra um projeto Supabase real. NÃO roda no CI nem
// no `npm test` padrão — só quando o operador opta explicitamente:
//
//   SUPABASE_URL=https://...supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   SUPABASE_TEST_OK=1 \
//   npm test
//
// Os 3 envs são exigidos juntos. SUPABASE_TEST_OK é uma trava extra:
// `limpar()` apaga TODAS as linhas de `categorias` na URL configurada;
// sem o opt-in, alguém com `SUPABASE_URL` apontando pra produção (caso
// rode npm test no laptop com env de prod carregado) zeraria tudo.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const optIn = process.env.SUPABASE_TEST_OK === '1';
const ativo = !!url && !!key && optIn;

function novoId(): CategoryId {
  return crypto.randomUUID() as CategoryId;
}

function novaCategoria(overrides: Partial<Category> = {}): Category {
  return {
    id: novoId(),
    nome: 'Teste',
    ativo: true,
    criadoEm: new Date().toISOString(),
    ...overrides,
  };
}

describe.skipIf(!ativo)('SupabaseCategoryRepository (integração)', () => {
  let client: SupabaseClient;
  let repo: SupabaseCategoryRepository;

  beforeAll(() => {
    client = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    repo = new SupabaseCategoryRepository(client);
  });

  beforeEach(async () => {
    await repo.limpar();
  });

  it('criar e porId devolve a mesma categoria', async () => {
    const cat = novaCategoria({ nome: 'Toalha' });
    await repo.criar(cat);
    const lido = await repo.porId(cat.id);
    expect(lido).not.toBeNull();
    expect(lido!.id).toBe(cat.id);
    expect(lido!.nome).toBe('Toalha');
    expect(lido!.ativo).toBe(true);
    // Comparação semântica: Postgres timestamptz devolve com offset
    // explícito (`+00:00`) enquanto Date.toISOString() usa `Z`. Mesmo
    // instante, formato canônico diferente — round-trip via Date confere
    // o ponto-no-tempo, não a string literal.
    expect(new Date(lido!.criadoEm).toISOString()).toBe(cat.criadoEm);
  });

  it('porId devolve null quando não existe', async () => {
    const lido = await repo.porId(novoId());
    expect(lido).toBeNull();
  });

  it('listar ordena alfabeticamente em pt-BR', async () => {
    await repo.criar(novaCategoria({ nome: 'Zebra' }));
    await repo.criar(novaCategoria({ nome: 'Antes' }));
    await repo.criar(novaCategoria({ nome: 'Ácido' }));
    const lista = await repo.listar();
    expect(lista.map((c) => c.nome)).toEqual(['Ácido', 'Antes', 'Zebra']);
  });

  it('listar com apenasAtivos filtra ativo=false', async () => {
    const ativa = novaCategoria({ nome: 'Ativa' });
    const inativa = novaCategoria({ nome: 'Inativa', ativo: false });
    await repo.criar(ativa);
    await repo.criar(inativa);

    const todas = await repo.listar();
    expect(todas).toHaveLength(2);

    const ativas = await repo.listar({ apenasAtivos: true });
    expect(ativas).toHaveLength(1);
    expect(ativas[0]?.id).toBe(ativa.id);
  });

  it('atualizar substitui campos preservando id', async () => {
    const cat = novaCategoria({ nome: 'Original' });
    await repo.criar(cat);
    await repo.atualizar({ ...cat, nome: 'Renomeada' });
    const lido = await repo.porId(cat.id);
    expect(lido!.nome).toBe('Renomeada');
    expect(lido!.id).toBe(cat.id);
  });

  it('atualizar ativo=false (inativar) preserva o resto', async () => {
    const cat = novaCategoria({ nome: 'Pra inativar' });
    await repo.criar(cat);
    await repo.atualizar({ ...cat, ativo: false });
    const lido = await repo.porId(cat.id);
    expect(lido!.ativo).toBe(false);
    expect(lido!.nome).toBe('Pra inativar');
  });

  it('atualizar lança erro quando id não existe (mesma semântica do JSON/InMemory)', async () => {
    const fantasma = novaCategoria({ nome: 'Não existe' });
    await expect(repo.atualizar(fantasma)).rejects.toThrow(
      /não encontrada para atualizar/i,
    );
  });

  it('limpar remove todas as linhas', async () => {
    await repo.criar(novaCategoria({ nome: 'A' }));
    await repo.criar(novaCategoria({ nome: 'B' }));
    expect(await repo.listar()).toHaveLength(2);
    await repo.limpar();
    expect(await repo.listar()).toHaveLength(0);
  });
});
