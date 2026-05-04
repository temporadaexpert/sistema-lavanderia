import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  criarContainerDeTeste,
  type ContainerDeTeste,
} from '@/testing/testContainer';
import { CategoryId, ItemId } from '@/domain/types/ids';

// Mocka o singleton: troca o container global por um InMemory isolado.
// Isso testa a função `listarTodosMateriais` (e amigas) na CADEIA REAL
// que /admin/materiais executa em produção, sem depender de Supabase nem
// dos arquivos data/*.json.
vi.mock('@/infrastructure/singleton', () => ({
  getContainer: vi.fn(),
}));

import { getContainer } from '@/infrastructure/singleton';
import {
  listarTodosMateriais,
  listarCategoriasAtivas,
  unidadesExistentes,
} from './materialData';

describe('materialData (loaders de /admin/materiais)', () => {
  let c: ContainerDeTeste;

  beforeEach(() => {
    c = criarContainerDeTeste();
    vi.mocked(getContainer).mockResolvedValue(c as never);
  });

  afterEach(() => {
    vi.mocked(getContainer).mockReset();
  });

  it('listarTodosMateriais devolve ativos + inativos, ativos primeiro, ordenados por nome', async () => {
    const cat = await c.categoryService.criar({ nome: 'Toalha' });
    await c.itemService.criar({
      nome: 'Zebra',
      categoriaId: cat.id,
      unidade: 'un',
      valorUnitario: 10,
      estoqueMinimo: null,
    });
    const meio = await c.itemService.criar({
      nome: 'Meio',
      categoriaId: cat.id,
      unidade: 'un',
      valorUnitario: 20,
      estoqueMinimo: null,
    });
    await c.itemService.criar({
      nome: 'Antes',
      categoriaId: cat.id,
      unidade: 'un',
      valorUnitario: 30,
      estoqueMinimo: null,
    });
    // Inativa o "Meio" pra verificar ordenação ativos→inativos
    await c.itemService.alternarAtivo(meio.id);

    const lista = await listarTodosMateriais();
    expect(lista).toHaveLength(3);
    expect(lista.map((i) => i.nome)).toEqual(['Antes', 'Zebra', 'Meio']);
    expect(lista[2]?.ativo).toBe(false);
  });

  it('listarTodosMateriais devolve [] quando container está vazio (não crasha)', async () => {
    const lista = await listarTodosMateriais();
    expect(lista).toEqual([]);
  });

  it('listarCategoriasAtivas devolve só categorias ativas', async () => {
    const a = await c.categoryService.criar({ nome: 'Ativa' });
    const b = await c.categoryService.criar({ nome: 'Inativa' });
    await c.categoryService.alternarAtivo(b.id);

    const cats = await listarCategoriasAtivas();
    expect(cats).toHaveLength(1);
    expect(cats[0]?.id).toBe(a.id);
  });

  it('unidadesExistentes deduplica e ordena unidades dos itens cadastrados', async () => {
    const cat = await c.categoryService.criar({ nome: 'X' });
    await c.itemService.criar({
      nome: 'A',
      categoriaId: cat.id,
      unidade: 'un',
      valorUnitario: null,
      estoqueMinimo: null,
    });
    await c.itemService.criar({
      nome: 'B',
      categoriaId: cat.id,
      unidade: 'un', // duplicada
      valorUnitario: null,
      estoqueMinimo: null,
    });
    await c.itemService.criar({
      nome: 'C',
      categoriaId: cat.id,
      unidade: 'kg',
      valorUnitario: null,
      estoqueMinimo: null,
    });

    const u = await unidadesExistentes();
    expect(u).toEqual(['kg', 'un']);
  });

  it('reproduz o cenário do bug em produção: 11 itens reais carregados pelo loader', async () => {
    // Mesma forma que o data/itens.json (10 ativos + 1 inativo). Garante
    // que o caminho `c.itens.listar()` → sort → render funciona ponta-a-ponta.
    const catToalha = await c.categoryService.criar({ nome: 'toalha' });
    const catCama = await c.categoryService.criar({ nome: 'roupa_cama' });

    const dadosItens = [
      { nome: 'Toalha de banho', cat: catToalha.id, ativo: true },
      { nome: 'Toalha de rosto branca', cat: catToalha.id, ativo: false },
      { nome: 'Lençol casal', cat: catCama.id, ativo: true },
      { nome: 'Fronha', cat: catCama.id, ativo: true },
      { nome: 'Lençol Solteiro', cat: catCama.id, ativo: true },
      { nome: 'PANO DE PRATO', cat: catCama.id, ativo: true },
      { nome: 'PANO DE PISO', cat: catCama.id, ativo: true },
      { nome: 'PROTETOR DE COLCHÃO', cat: catCama.id, ativo: true },
      { nome: 'Manta Sofá', cat: catCama.id, ativo: true },
      { nome: 'MANTA CAMA', cat: catCama.id, ativo: true },
      { nome: 'CORTINA', cat: catCama.id, ativo: true },
    ];
    for (const d of dadosItens) {
      const item = await c.itemService.criar({
        nome: d.nome,
        categoriaId: d.cat,
        unidade: 'un',
        valorUnitario: 1,
        estoqueMinimo: null,
      });
      if (!d.ativo) await c.itemService.alternarAtivo(item.id);
    }

    const lista = await listarTodosMateriais();
    expect(lista).toHaveLength(11);
    expect(lista.filter((i) => i.ativo)).toHaveLength(10);
    expect(lista.filter((i) => !i.ativo)).toHaveLength(1);
    // Ativos vêm antes dos inativos
    const indexInativo = lista.findIndex((i) => !i.ativo);
    expect(indexInativo).toBe(10); // último

    // Categorias ativas aparecem
    const cats = await listarCategoriasAtivas();
    expect(cats.map((c) => c.nome).sort()).toEqual(['roupa_cama', 'toalha']);

    // unidadesExistentes deduplica a 'un' única
    expect(await unidadesExistentes()).toEqual(['un']);
  });

  // Ids não-utilizados — placeholder que silencia warnings se algum import
  // de tipo for tree-shaken por engano. Mantemos pra deixar claro que os
  // CategoryId/ItemId branded types são consumidos via `c.itemService.criar`.
  void CategoryId;
  void ItemId;
});
