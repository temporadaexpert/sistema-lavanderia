import { getContainer } from '@/infrastructure/singleton';
import type { Local } from '@/domain/entities/Local';

export async function listarTodosLocais(): Promise<Local[]> {
  const c = await getContainer();
  const locais = await c.locais.listar();
  // Ordena: ativos primeiro, depois por tipo (deposito → imovel → lavanderia),
  // depois por nome. Mantém a listagem previsível.
  const ordemTipo: Record<string, number> = { deposito: 0, imovel: 1, lavanderia: 2 };
  return locais.slice().sort((a, b) => {
    if (a.ativo !== b.ativo) return a.ativo ? -1 : 1;
    const ordA = ordemTipo[a.tipo] ?? 99;
    const ordB = ordemTipo[b.tipo] ?? 99;
    if (ordA !== ordB) return ordA - ordB;
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });
}
