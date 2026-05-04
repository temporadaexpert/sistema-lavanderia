import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { ValidationError } from '@/domain/errors/DomainErrors';

describe('CategoryService', () => {
  let c: ContainerDeTeste;

  beforeEach(() => {
    c = criarContainerDeTeste();
  });

  it('cria categoria com trim e ativa por padrão', async () => {
    const cat = await c.categoryService.criar({ nome: '  Toalha  ' });
    expect(cat.nome).toBe('Toalha');
    expect(cat.ativo).toBe(true);
    expect(cat.id).toBeTruthy();
  });

  it('rejeita nome vazio ou só espaços', async () => {
    await expect(c.categoryService.criar({ nome: '' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(c.categoryService.criar({ nome: '   ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejeita duplicata case-insensitive', async () => {
    await c.categoryService.criar({ nome: 'Toalha' });
    await expect(c.categoryService.criar({ nome: 'toalha' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(c.categoryService.criar({ nome: 'TOALHA  ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('obterOuCriarPorNome é idempotente', async () => {
    const a = await c.categoryService.obterOuCriarPorNome('Cama');
    const b = await c.categoryService.obterOuCriarPorNome('cama');
    const d = await c.categoryService.obterOuCriarPorNome('  Cama  ');
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(d.id);
    // Só uma categoria em disco
    const todas = await c.categorias.listar();
    expect(todas).toHaveLength(1);
  });

  it('listar ordena alfabeticamente', async () => {
    await c.categoryService.criar({ nome: 'Zebra' });
    await c.categoryService.criar({ nome: 'Antes' });
    await c.categoryService.criar({ nome: 'Meio' });
    const lista = await c.categorias.listar();
    expect(lista.map((c) => c.nome)).toEqual(['Antes', 'Meio', 'Zebra']);
  });

  it('alternarAtivo inverte a flag sem tocar no resto', async () => {
    const cat = await c.categoryService.criar({ nome: 'Toalha' });
    const inativa = await c.categoryService.alternarAtivo(cat.id);
    expect(inativa.ativo).toBe(false);
    expect(inativa.nome).toBe('Toalha');
    const reativa = await c.categoryService.alternarAtivo(cat.id);
    expect(reativa.ativo).toBe(true);
  });

  it('filtra apenasAtivos', async () => {
    const a = await c.categoryService.criar({ nome: 'Ativa' });
    const b = await c.categoryService.criar({ nome: 'Inativa' });
    await c.categoryService.alternarAtivo(b.id);

    const ativas = await c.categorias.listar({ apenasAtivos: true });
    expect(ativas).toHaveLength(1);
    expect(ativas[0]?.id).toBe(a.id);

    const todas = await c.categorias.listar();
    expect(todas).toHaveLength(2);
  });

  it('atualizar rejeita renomear pra nome já existente', async () => {
    await c.categoryService.criar({ nome: 'Toalha' });
    const outra = await c.categoryService.criar({ nome: 'Cama' });
    await expect(
      c.categoryService.atualizar(outra.id, { nome: 'toalha', ativo: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('ItemService.criar exige categoria ativa e existente', async () => {
    // Sem categoria cadastrada: rejeita
    await expect(
      c.itemService.criar({
        nome: 'X',
        categoriaId: 'inexistente' as never,
        unidade: 'un',
        valorUnitario: null,
        estoqueMinimo: null,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Categoria inativa: rejeita
    const cat = await c.categoryService.criar({ nome: 'Teste' });
    await c.categoryService.alternarAtivo(cat.id);
    await expect(
      c.itemService.criar({
        nome: 'Y',
        categoriaId: cat.id,
        unidade: 'un',
        valorUnitario: null,
        estoqueMinimo: null,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('ItemService denormaliza nome da categoria no item', async () => {
    const cat = await c.categoryService.criar({ nome: 'Roupa de cama' });
    const item = await c.itemService.criar({
      nome: 'Lençol',
      categoriaId: cat.id,
      unidade: 'un',
      valorUnitario: 80,
      estoqueMinimo: null,
    });
    expect(item.categoriaId).toBe(cat.id);
    expect(item.categoria).toBe('Roupa de cama');
  });
});
