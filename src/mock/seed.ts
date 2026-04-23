import type { Container } from '@/infrastructure/container';
import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import { ItemId, LocalId } from '@/domain/types/ids';

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

export async function popularSeed(c: Container): Promise<void> {
  const agora = new Date().toISOString();

  // valorUnitario em reais (2 decimais). Quando houver contabilidade séria
  // migra para inteiros em centavos — mas é mudança local a este tipo,
  // não ao domínio do saldo.
  const itens: Item[] = [
    {
      id: ITENS.toalhaBanho,
      nome: 'Toalha de banho branca',
      categoria: 'toalha',
      unidade: 'un',
      valorUnitario: 35.0,
      estoqueMinimo: 60,
      ativo: true,
      criadoEm: agora,
    },
    {
      id: ITENS.toalhaRosto,
      nome: 'Toalha de rosto branca',
      categoria: 'toalha',
      unidade: 'un',
      valorUnitario: 18.0,
      estoqueMinimo: 50,
      ativo: true,
      criadoEm: agora,
    },
    {
      id: ITENS.lencolCasal,
      nome: 'Lençol casal',
      categoria: 'roupa_cama',
      unidade: 'un',
      valorUnitario: 80.0,
      estoqueMinimo: 40,
      ativo: true,
      criadoEm: agora,
    },
    {
      id: ITENS.froha,
      nome: 'Fronha',
      categoria: 'roupa_cama',
      unidade: 'un',
      valorUnitario: 15.0,
      estoqueMinimo: 80,
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

  await Promise.all([...itens.map((i) => c.itens.criar(i)), ...locais.map((l) => c.locais.criar(l))]);
}
