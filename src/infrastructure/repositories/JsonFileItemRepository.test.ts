import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { JsonFileItemRepository } from './JsonFileItemRepository';
import { JsonFileLocalRepository } from './JsonFileLocalRepository';
import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import { CategoryId, ItemId, LocalId } from '@/domain/types/ids';

// Sufixo único por teste pra isolar arquivos dos múltiplos runs.
let counter = 0;
const nextName = (base: string) => `${base}.${Date.now()}.${++counter}.json`;

function makeItem(id: string, nome: string, ativo = true): Item {
  return {
    id: ItemId(id),
    nome,
    categoriaId: CategoryId('cat-toalha'),
    categoria: 'Toalha',
    unidade: 'un',
    valorUnitario: 30,
    estoqueMinimo: 10,
    estoqueTotal: null,
    ativo,
    criadoEm: '2026-01-01T00:00:00.000Z',
  };
}

function makeLocal(id: string, nome: string, ativo = true): Local {
  return {
    id: LocalId(id),
    nome,
    tipo: 'imovel',
    ativo,
    criadoEm: '2026-01-01T00:00:00.000Z',
  };
}

async function removerArquivo(nomeArquivo: string) {
  const p = path.resolve(process.cwd(), 'data', nomeArquivo);
  try {
    await fs.unlink(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

describe('JsonFileItemRepository', () => {
  let nome: string;

  beforeEach(() => {
    nome = nextName('test-itens');
  });
  afterEach(async () => {
    await removerArquivo(nome);
  });

  it('persiste entre instâncias (sobrevive a "restart")', async () => {
    const r1 = new JsonFileItemRepository(nome);
    await r1.criar(makeItem('item-a', 'Toalha A'));
    await r1.criar(makeItem('item-b', 'Toalha B'));

    // Simula restart: nova instância, mesmo arquivo
    const r2 = new JsonFileItemRepository(nome);
    const lista = await r2.listar();
    expect(lista).toHaveLength(2);
    expect(lista.map((i) => i.id).sort()).toEqual(['item-a', 'item-b']);
  });

  it('atualiza e persiste a nova versão', async () => {
    const r1 = new JsonFileItemRepository(nome);
    await r1.criar(makeItem('item-a', 'Toalha A'));
    await r1.atualizar({
      ...makeItem('item-a', 'Toalha A renomeada'),
      valorUnitario: 99,
    });

    const r2 = new JsonFileItemRepository(nome);
    const item = await r2.porId(ItemId('item-a'));
    expect(item?.nome).toBe('Toalha A renomeada');
    expect(item?.valorUnitario).toBe(99);
  });

  it('rejeita atualizar id inexistente', async () => {
    const r = new JsonFileItemRepository(nome);
    await expect(r.atualizar(makeItem('nao-existe', 'X'))).rejects.toThrow();
  });

  it('filtra por apenasAtivos', async () => {
    const r = new JsonFileItemRepository(nome);
    await r.criar(makeItem('ativo', 'Ativo', true));
    await r.criar(makeItem('inativo', 'Inativo', false));
    const ativos = await r.listar({ apenasAtivos: true });
    expect(ativos).toHaveLength(1);
    expect(ativos[0]?.id).toBe('ativo');
    const todos = await r.listar();
    expect(todos).toHaveLength(2);
  });

  it('listar vazio quando o arquivo não existe ainda', async () => {
    const r = new JsonFileItemRepository(nome);
    expect(await r.listar()).toHaveLength(0);
    expect(await r.porId(ItemId('qualquer'))).toBeNull();
  });

  it('sobrevive a arquivo corrompido (não-array)', async () => {
    const arquivo = path.resolve(process.cwd(), 'data', nome);
    await fs.mkdir(path.dirname(arquivo), { recursive: true });
    await fs.writeFile(arquivo, '{"isso":"não é array"}', 'utf-8');
    const r = new JsonFileItemRepository(nome);
    expect(await r.listar()).toHaveLength(0);
  });

  it('suporta escritas concorrentes sem perder dados (Promise.all)', async () => {
    // Cenário que reproduzia o ENOENT original: criar em paralelo
    // provocava colisão no rename do .tmp compartilhado.
    const r = new JsonFileItemRepository(nome);
    const n = 10;
    await Promise.all(
      Array.from({ length: n }, (_, i) => r.criar(makeItem(`concor-${i}`, `Item ${i}`))),
    );
    // Todas as gravações devem ter sido aplicadas
    const persistido = await new JsonFileItemRepository(nome).listar();
    expect(persistido).toHaveLength(n);
    expect(persistido.map((i) => i.id).sort()).toEqual(
      Array.from({ length: n }, (_, i) => `concor-${i}`).sort(),
    );
  });

  it('escrita + leitura + escrita intercaladas não corrompem', async () => {
    const r = new JsonFileItemRepository(nome);
    await r.criar(makeItem('a', 'A'));
    const [listaA] = await Promise.all([r.listar(), r.criar(makeItem('b', 'B'))]);
    expect(listaA.length).toBeGreaterThanOrEqual(1);
    const final = await r.listar();
    expect(final).toHaveLength(2);
  });
});

describe('JsonFileLocalRepository', () => {
  let nome: string;

  beforeEach(() => {
    nome = nextName('test-locais');
  });
  afterEach(async () => {
    await removerArquivo(nome);
  });

  it('persiste e sobrevive entre instâncias', async () => {
    const r1 = new JsonFileLocalRepository(nome);
    await r1.criar(makeLocal('l-a', 'Apto 101'));
    await r1.criar(makeLocal('l-b', 'Apto 202'));

    const r2 = new JsonFileLocalRepository(nome);
    expect(await r2.listar()).toHaveLength(2);
  });

  it('filtra por tipo e ativo', async () => {
    const r = new JsonFileLocalRepository(nome);
    await r.criar(makeLocal('l1', 'Imóvel 1', true));
    await r.criar({
      id: LocalId('d1'),
      nome: 'Depósito',
      tipo: 'deposito',
      ativo: true,
      criadoEm: '2026-01-01T00:00:00.000Z',
    });
    await r.criar(makeLocal('l2', 'Inativo', false));

    const imoveis = await r.listar({ tipo: 'imovel' });
    expect(imoveis.map((l) => l.id).sort()).toEqual(['l1', 'l2']);
    const imoveisAtivos = await r.listar({ tipo: 'imovel', apenasAtivos: true });
    expect(imoveisAtivos.map((l) => l.id)).toEqual(['l1']);
    const depositos = await r.listar({ tipo: 'deposito' });
    expect(depositos).toHaveLength(1);
  });
});
