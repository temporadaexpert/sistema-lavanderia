import { getContainer } from '@/infrastructure/singleton';
import type { Item } from '@/domain/entities/Item';

export async function listarTodosMateriais(): Promise<Item[]> {
  const c = await getContainer();
  const itens = await c.itens.listar();
  // Ordena: ativos primeiro (por nome), depois inativos (por nome).
  return itens.slice().sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

export async function categoriasExistentes(): Promise<string[]> {
  const c = await getContainer();
  const itens = await c.itens.listar();
  const set = new Set<string>();
  for (const i of itens) if (i.categoria) set.add(i.categoria);
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export async function unidadesExistentes(): Promise<string[]> {
  const c = await getContainer();
  const itens = await c.itens.listar();
  const set = new Set<string>();
  for (const i of itens) if (i.unidade) set.add(i.unidade);
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
