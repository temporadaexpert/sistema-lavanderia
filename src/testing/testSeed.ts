import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import { ItemId, LocalId } from '@/domain/types/ids';
import type { ContainerDeTeste } from './testContainer';

// IDs fixos facilitam asserts nos testes (não dependem da ordem de
// execução do gerador sequencial).
export const TEST_ITENS = {
  toalha: ItemId('item-toalha'),
  fronha: ItemId('item-fronha'),
  semPreco: ItemId('item-sem-preco'),
} as const;

export const TEST_LOCAIS = {
  deposito: LocalId('local-deposito'),
  imovel: LocalId('local-imovel'),
  lavanderia: LocalId('local-lavanderia'),
} as const;

export function itemToalha(): Item {
  return {
    id: TEST_ITENS.toalha,
    nome: 'Toalha',
    categoria: 'toalha',
    unidade: 'un',
    valorUnitario: 30,
    estoqueMinimo: 10,
    ativo: true,
    criadoEm: '2026-01-01T00:00:00.000Z',
  };
}
export function itemFronha(): Item {
  return {
    id: TEST_ITENS.fronha,
    nome: 'Fronha',
    categoria: 'cama',
    unidade: 'un',
    valorUnitario: 15,
    estoqueMinimo: 20,
    ativo: true,
    criadoEm: '2026-01-01T00:00:00.000Z',
  };
}
export function itemSemPreco(): Item {
  return {
    id: TEST_ITENS.semPreco,
    nome: 'Item sem preço',
    categoria: 'outro',
    unidade: 'un',
    valorUnitario: null,
    estoqueMinimo: null,
    ativo: true,
    criadoEm: '2026-01-01T00:00:00.000Z',
  };
}

export function localDeposito(): Local {
  return {
    id: TEST_LOCAIS.deposito,
    nome: 'Depósito Teste',
    tipo: 'deposito',
    ativo: true,
    criadoEm: '2026-01-01T00:00:00.000Z',
  };
}
export function localImovel(): Local {
  return {
    id: TEST_LOCAIS.imovel,
    nome: 'Imóvel Teste',
    tipo: 'imovel',
    ativo: true,
    criadoEm: '2026-01-01T00:00:00.000Z',
  };
}
export function localLavanderia(): Local {
  return {
    id: TEST_LOCAIS.lavanderia,
    nome: 'Lavanderia Teste',
    tipo: 'lavanderia',
    ativo: true,
    criadoEm: '2026-01-01T00:00:00.000Z',
  };
}

// Popula o catálogo mínimo que todos os testes usam. Chamado em beforeEach.
export async function semearBasico(c: ContainerDeTeste): Promise<void> {
  await c.itens.criar(itemToalha());
  await c.itens.criar(itemFronha());
  await c.itens.criar(itemSemPreco());
  await c.locais.criar(localDeposito());
  await c.locais.criar(localImovel());
  await c.locais.criar(localLavanderia());
}
