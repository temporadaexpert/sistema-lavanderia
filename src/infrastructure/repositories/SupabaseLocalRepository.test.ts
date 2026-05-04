import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseLocalRepository } from './SupabaseLocalRepository';
import type { Local } from '@/domain/entities/Local';
import type { LocalId } from '@/domain/types/ids';
import type { LocalTipo } from '@/domain/types/enums';

// Teste de integração contra Supabase real. Mesmo gating do
// SupabaseCategoryRepository.test.ts — exige opt-in explícito por causa
// das deletions destrutivas no beforeEach.
//
//   SUPABASE_URL=https://...supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   SUPABASE_TEST_OK=1 \
//   npm test
//
// Atenção: se o projeto Supabase de teste tiver lotes_lavanderia
// referenciando linhas em `locais`, o cleanup falha (FK RESTRICT).
// Use um projeto dedicado a testes ou limpe lotes/movs antes.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const optIn = process.env.SUPABASE_TEST_OK === '1';
const ativo = !!url && !!key && optIn;

function novoId(): LocalId {
  return crypto.randomUUID() as LocalId;
}

function novoLocal(overrides: Partial<Local> = {}): Local {
  return {
    id: novoId(),
    nome: 'Local Teste',
    tipo: 'deposito',
    ativo: true,
    criadoEm: new Date().toISOString(),
    ...overrides,
  };
}

// LocalRepository não expõe `limpar()` (diferente de CategoryRepository).
// Pra cleanup do teste falamos direto com o SupabaseClient — não usamos
// o port pra fazer o que o port intencionalmente não permite.
async function limparLocais(client: SupabaseClient): Promise<void> {
  const { error } = await client
    .from('locais')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error(`Falha no cleanup de locais: ${error.message}`);
}

describe.skipIf(!ativo)('SupabaseLocalRepository (integração)', () => {
  let client: SupabaseClient;
  let repo: SupabaseLocalRepository;

  beforeAll(() => {
    client = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    repo = new SupabaseLocalRepository(client);
  });

  beforeEach(async () => {
    await limparLocais(client);
  });

  it('criar e porId devolve o mesmo local', async () => {
    const local = novoLocal({ nome: 'Depósito Central', tipo: 'deposito' });
    await repo.criar(local);
    const lido = await repo.porId(local.id);
    expect(lido).not.toBeNull();
    expect(lido!.id).toBe(local.id);
    expect(lido!.nome).toBe('Depósito Central');
    expect(lido!.tipo).toBe('deposito');
    expect(lido!.ativo).toBe(true);
    // Comparação semântica: timestamptz volta com `+00:00`, ISO source usa `Z`.
    expect(new Date(lido!.criadoEm).toISOString()).toBe(local.criadoEm);
  });

  it('porId devolve null quando não existe', async () => {
    const lido = await repo.porId(novoId());
    expect(lido).toBeNull();
  });

  it('listar sem filtro retorna tudo', async () => {
    await repo.criar(novoLocal({ nome: 'A', tipo: 'deposito' }));
    await repo.criar(novoLocal({ nome: 'B', tipo: 'imovel' }));
    await repo.criar(novoLocal({ nome: 'C', tipo: 'lavanderia' }));
    const lista = await repo.listar();
    expect(lista).toHaveLength(3);
    expect(lista.map((l) => l.nome).sort()).toEqual(['A', 'B', 'C']);
  });

  it('listar com filtro tipo isola um único subconjunto', async () => {
    await repo.criar(novoLocal({ nome: 'Dep1', tipo: 'deposito' }));
    await repo.criar(novoLocal({ nome: 'Dep2', tipo: 'deposito' }));
    await repo.criar(novoLocal({ nome: 'Im1', tipo: 'imovel' }));
    await repo.criar(novoLocal({ nome: 'Lav1', tipo: 'lavanderia' }));

    const depositos = await repo.listar({ tipo: 'deposito' });
    expect(depositos).toHaveLength(2);
    expect(depositos.every((l) => l.tipo === 'deposito')).toBe(true);

    const imoveis = await repo.listar({ tipo: 'imovel' });
    expect(imoveis).toHaveLength(1);
    expect(imoveis[0]?.nome).toBe('Im1');

    const lavanderias = await repo.listar({ tipo: 'lavanderia' });
    expect(lavanderias).toHaveLength(1);
  });

  it('listar com apenasAtivos filtra ativo=false', async () => {
    const ativoLocal = novoLocal({ nome: 'Ativo', tipo: 'deposito' });
    const inativoLocal = novoLocal({ nome: 'Inativo', tipo: 'deposito', ativo: false });
    await repo.criar(ativoLocal);
    await repo.criar(inativoLocal);

    const todos = await repo.listar();
    expect(todos).toHaveLength(2);

    const ativos = await repo.listar({ apenasAtivos: true });
    expect(ativos).toHaveLength(1);
    expect(ativos[0]?.id).toBe(ativoLocal.id);
  });

  it('listar combina tipo + apenasAtivos', async () => {
    await repo.criar(novoLocal({ nome: 'Dep ativo', tipo: 'deposito', ativo: true }));
    await repo.criar(novoLocal({ nome: 'Dep inativo', tipo: 'deposito', ativo: false }));
    await repo.criar(novoLocal({ nome: 'Imovel ativo', tipo: 'imovel', ativo: true }));

    const depAtivos = await repo.listar({ tipo: 'deposito', apenasAtivos: true });
    expect(depAtivos).toHaveLength(1);
    expect(depAtivos[0]?.nome).toBe('Dep ativo');
  });

  it('atualizar substitui campos preservando id', async () => {
    const local = novoLocal({ nome: 'Antigo', tipo: 'deposito', ativo: true });
    await repo.criar(local);
    await repo.atualizar({ ...local, nome: 'Renomeado', tipo: 'lavanderia' });
    const lido = await repo.porId(local.id);
    expect(lido!.nome).toBe('Renomeado');
    expect(lido!.tipo).toBe('lavanderia');
    expect(lido!.id).toBe(local.id);
  });

  it('atualizar inativa preservando o resto (alternar ativo)', async () => {
    const local = novoLocal({ nome: 'Pra inativar', tipo: 'imovel', ativo: true });
    await repo.criar(local);
    await repo.atualizar({ ...local, ativo: false });
    let lido = await repo.porId(local.id);
    expect(lido!.ativo).toBe(false);
    expect(lido!.nome).toBe('Pra inativar');
    expect(lido!.tipo).toBe('imovel');

    // Reativar
    await repo.atualizar({ ...local, ativo: true });
    lido = await repo.porId(local.id);
    expect(lido!.ativo).toBe(true);
  });

  it('atualizar lança erro quando id não existe (mesma semântica do JSON/InMemory)', async () => {
    const fantasma = novoLocal({ nome: 'Não existe' });
    await expect(repo.atualizar(fantasma)).rejects.toThrow(
      /não encontrado para atualizar/i,
    );
  });

  it('cleanup zera a tabela entre testes', async () => {
    // Sanity: garante que beforeEach do próximo teste vai começar limpo.
    await repo.criar(novoLocal({ nome: 'Vai sumir', tipo: 'deposito' }));
    expect(await repo.listar()).toHaveLength(1);
    await limparLocais(client);
    expect(await repo.listar()).toHaveLength(0);
  });
});
