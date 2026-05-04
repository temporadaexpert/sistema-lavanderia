import type { Container } from '@/infrastructure/container';
import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import type { Category } from '@/domain/entities/Category';
import { CategoryId, ItemId, LocalId } from '@/domain/types/ids';

// IDs fixos para facilitar inspeção em logs e testes manuais do MVP.
export const ITENS = {
  toalhaBanho: ItemId('item-toalha-banho'),
  toalhaRosto: ItemId('item-toalha-rosto'),
  lencolCasal: ItemId('item-lencol-casal'),
  froha: ItemId('item-fronha'),
} as const;

export const LOCAIS = {
  depositoCentral: LocalId('local-deposito-central'),
  imovel302: LocalId('local-imovel-302'),
  imovel405: LocalId('local-imovel-405'),
  lavanderiaExterna: LocalId('local-lavanderia-externa'),
} as const;

export const CATEGORIAS = {
  toalha: CategoryId('cat-toalha'),
  roupaCama: CategoryId('cat-roupa-cama'),
} as const;

export async function popularSeed(c: Container): Promise<void> {
  const agora = new Date().toISOString();

  const categorias: Category[] = [
    { id: CATEGORIAS.toalha, nome: 'Toalha', ativo: true, criadoEm: agora },
    { id: CATEGORIAS.roupaCama, nome: 'Roupa de cama', ativo: true, criadoEm: agora },
  ];

  const itens: Item[] = [
    {
      id: ITENS.toalhaBanho,
      nome: 'Toalha de banho branca',
      categoriaId: CATEGORIAS.toalha,
      categoria: 'Toalha',
      unidade: 'un',
      valorUnitario: 35.0,
      estoqueMinimo: 60,
      estoqueTotal: null,
      ativo: true,
      criadoEm: agora,
    },
    {
      id: ITENS.toalhaRosto,
      nome: 'Toalha de rosto branca',
      categoriaId: CATEGORIAS.toalha,
      categoria: 'Toalha',
      unidade: 'un',
      valorUnitario: 18.0,
      estoqueMinimo: 50,
      estoqueTotal: null,
      ativo: true,
      criadoEm: agora,
    },
    {
      id: ITENS.lencolCasal,
      nome: 'Lençol casal',
      categoriaId: CATEGORIAS.roupaCama,
      categoria: 'Roupa de cama',
      unidade: 'un',
      valorUnitario: 80.0,
      estoqueMinimo: 40,
      estoqueTotal: null,
      ativo: true,
      criadoEm: agora,
    },
    {
      id: ITENS.froha,
      nome: 'Fronha',
      categoriaId: CATEGORIAS.roupaCama,
      categoria: 'Roupa de cama',
      unidade: 'un',
      valorUnitario: 15.0,
      estoqueMinimo: 80,
      estoqueTotal: null,
      ativo: true,
      criadoEm: agora,
    },
  ];

  const locais: Local[] = [
    { id: LOCAIS.depositoCentral, nome: 'Depósito Central', tipo: 'deposito', ativo: true, criadoEm: agora },
    { id: LOCAIS.imovel302, nome: 'Apto 302 — Ed. Palmeiras', tipo: 'imovel', ativo: true, criadoEm: agora },
    { id: LOCAIS.imovel405, nome: 'Apto 405 — Ed. Palmeiras', tipo: 'imovel', ativo: true, criadoEm: agora },
    { id: LOCAIS.lavanderiaExterna, nome: 'Lavanderia Externa', tipo: 'lavanderia', ativo: true, criadoEm: agora },
  ];

  // Seed é sequencial por design — ordem importa: categorias antes dos
  // itens (integridade referencial), locais em qualquer ordem. Cardinality
  // é pequena; 10+ awaits instantâneo.
  for (const cat of categorias) {
    await c.categorias.criar(cat);
  }
  for (const i of itens) {
    await c.itens.criar(i);
  }
  for (const l of locais) {
    await c.locais.criar(l);
  }
}
