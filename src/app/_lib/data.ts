import { getContainer } from '@/infrastructure/singleton';
import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { SaldoEntrada } from '@/application/services/SaldoService';

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

export async function historicoRecente(limite = 15): Promise<Movimentacao[]> {
  const c = await getContainer();
  const todas = await c.movimentacoes.listar();
  return todas
    .slice()
    .sort((a, b) => b.dataHora.localeCompare(a.dataHora))
    .slice(0, limite);
}
