import { getContainer } from '@/infrastructure/singleton';
import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type {
  DisponibilidadeItem,
  SaldoEntrada,
} from '@/application/services/SaldoService';

// Data loaders consumidos por server components. Leves, só chamam os
// serviços já existentes. Nenhuma regra nova aqui.

export async function listarItens(): Promise<Item[]> {
  const c = await getContainer();
  return c.itens.listar({ apenasAtivos: true });
}

export async function listarLocais(): Promise<Local[]> {
  const c = await getContainer();
  return c.locais.listar({ apenasAtivos: true });
}

// Catálogo completo (ativos + inativos) — usado só para resolver nomes em
// listas históricas. Selectors/saldo continuam com `listarItens`/`listarLocais`
// (ativos). Se um material foi desativado no admin DEPOIS de uma movimentação,
// a linha histórica precisa continuar legível.
export async function listarItensTodos(): Promise<Item[]> {
  const c = await getContainer();
  return c.itens.listar();
}

export async function listarLocaisTodos(): Promise<Local[]> {
  const c = await getContainer();
  return c.locais.listar();
}

// MVP: "depósito central" = o primeiro depósito ativo. Quando houver
// múltiplos depósitos, a UI ganhará seletor e este helper morre.
export async function obterDepositoPrincipal(): Promise<Local | null> {
  const c = await getContainer();
  const depositos = await c.locais.listar({ tipo: 'deposito', apenasAtivos: true });
  return depositos[0] ?? null;
}

export async function saldoNoDeposito(): Promise<{ local: Local | null; saldos: SaldoEntrada[] }> {
  const deposito = await obterDepositoPrincipal();
  if (!deposito) return { local: null, saldos: [] };
  const c = await getContainer();
  const saldos = await c.saldoService.saldoPorItemNoLocal(deposito.id);
  return { local: deposito, saldos };
}

// Quebra de disponibilidade (total / em imóveis / em lavanderia / disponível)
// usada pelo painel da funcionária e pelo admin. Retorna só itens ativos
// por padrão — itens inativos não poluem a listagem operacional.
export async function disponibilidadeDeTodos(opts?: {
  apenasAtivos?: boolean;
}): Promise<DisponibilidadeItem[]> {
  const c = await getContainer();
  return c.saldoService.disponibilidadeDeTodos({
    apenasAtivos: opts?.apenasAtivos ?? true,
  });
}

export async function historicoRecente(limite = 15): Promise<Movimentacao[]> {
  const c = await getContainer();
  // Histórico inclui canceladas (exibidas riscadas) — trilha de auditoria.
  // As projeções (saldo, relatórios) seguem excluindo por padrão.
  const todas = await c.movimentacoes.listar({ incluirCanceladas: true });
  return todas
    .slice()
    .sort((a, b) => b.dataHora.localeCompare(a.dataHora))
    .slice(0, limite);
}
