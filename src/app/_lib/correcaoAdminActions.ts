'use server';

import { revalidatePath } from 'next/cache';
import { getContainer } from '@/infrastructure/singleton';
import {
  ItemId,
  LoteId,
  MovimentacaoId,
} from '@/domain/types/ids';
import { DomainError } from '@/domain/errors/DomainErrors';
import type {
  CorrigirEnvioLavanderiaInput,
  CorrigirRetornoLavanderiaInput,
  CorrigirMovimentacaoSimplesInput,
  LinhaCorrecaoItem,
} from '@/application/services/CorrecaoAdminService';

// Resultado uniforme das 3 actions de correção administrativa. Discriminado
// por `ok` pra UI estreitar com narrowing simples.
export type CorrecaoResultado =
  | { ok: true; mensagem: string; quantidadeCorrigida: number }
  | { ok: false; code: string; error: string };

function invalidarPaineis(): void {
  // Toda a área admin pode estar mostrando snapshots de saldo/lotes/movs;
  // invalida largo pra refletir a correção sem F5.
  revalidatePath('/admin');
  revalidatePath('/admin/correcoes');
  revalidatePath('/admin/lotes-lavanderia');
  revalidatePath('/admin/lavanderia');
  revalidatePath('/admin/perdas');
  revalidatePath('/admin/divergencias');
  revalidatePath('/operacao');
}

// Lê pares item+nova_quantidade enviados pelo modal de correção. O form
// usa getAll('itemId') / getAll('quantidadeNova') preservando ordem.
function coletarItensCorrigidos(
  formData: FormData,
): { itens: LinhaCorrecaoItem[]; erro: string | null } {
  const idsRaw = formData.getAll('itemCorrigidoId');
  const qtdsRaw = formData.getAll('itemCorrigidoQtdNova');
  if (idsRaw.length !== qtdsRaw.length) {
    return { itens: [], erro: 'Itens e quantidades desalinhados' };
  }
  const itens: LinhaCorrecaoItem[] = [];
  for (let i = 0; i < idsRaw.length; i++) {
    const id = idsRaw[i];
    const qtd = Number(qtdsRaw[i]);
    if (typeof id !== 'string' || !id) continue;
    if (!Number.isFinite(qtd) || qtd < 0 || !Number.isInteger(qtd)) {
      return { itens: [], erro: 'Quantidade nova inválida (precisa ser inteiro ≥ 0).' };
    }
    itens.push({ itemId: ItemId(id), quantidadeNova: qtd });
  }
  return { itens, erro: null };
}

function leConfirmacaoCorrecaoGrande(formData: FormData): boolean {
  const v = formData.get('confirmacaoCorrecaoGrande');
  return v === 'on' || v === 'true' || v === '1';
}

export async function corrigirEnvioLavanderiaAction(
  formData: FormData,
): Promise<CorrecaoResultado> {
  try {
    const loteIdRaw = formData.get('loteId');
    const motivoRaw = formData.get('motivo');
    const adminRaw = formData.get('adminResponsavel');
    if (typeof loteIdRaw !== 'string' || !loteIdRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Lote inválido.' };
    }
    if (typeof motivoRaw !== 'string') {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Motivo é obrigatório.' };
    }
    if (typeof adminRaw !== 'string') {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Admin responsável é obrigatório.' };
    }
    const { itens, erro } = coletarItensCorrigidos(formData);
    if (erro) return { ok: false, code: 'VALIDATION_ERROR', error: erro };
    if (itens.length === 0) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Nenhum item para corrigir.' };
    }

    const c = await getContainer();
    const input: CorrigirEnvioLavanderiaInput = {
      loteId: LoteId(loteIdRaw),
      itensCorrigidos: itens,
      motivo: motivoRaw,
      adminResponsavel: adminRaw,
      confirmacaoCorrecaoGrande: leConfirmacaoCorrecaoGrande(formData),
    };
    const r = await c.correcaoAdmin.corrigirEnvioLavanderia(input);
    invalidarPaineis();
    return {
      ok: true,
      mensagem: `${r.correcoesRegistradas.length} item(ns) corrigido(s) com sucesso.`,
      quantidadeCorrigida: r.correcoesRegistradas.length,
    };
  } catch (err) {
    return toResultado(err);
  }
}

export async function corrigirRetornoLavanderiaAction(
  formData: FormData,
): Promise<CorrecaoResultado> {
  try {
    const operacaoIdRaw = formData.get('operacaoId');
    const motivoRaw = formData.get('motivo');
    const adminRaw = formData.get('adminResponsavel');
    if (typeof operacaoIdRaw !== 'string' || !operacaoIdRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Operação inválida.' };
    }
    if (typeof motivoRaw !== 'string') {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Motivo é obrigatório.' };
    }
    if (typeof adminRaw !== 'string') {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Admin responsável é obrigatório.' };
    }
    const { itens, erro } = coletarItensCorrigidos(formData);
    if (erro) return { ok: false, code: 'VALIDATION_ERROR', error: erro };
    if (itens.length === 0) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Nenhum item para corrigir.' };
    }
    const c = await getContainer();
    const input: CorrigirRetornoLavanderiaInput = {
      operacaoId: operacaoIdRaw,
      itensCorrigidos: itens,
      motivo: motivoRaw,
      adminResponsavel: adminRaw,
      confirmacaoCorrecaoGrande: leConfirmacaoCorrecaoGrande(formData),
    };
    const r = await c.correcaoAdmin.corrigirRetornoLavanderia(input);
    invalidarPaineis();
    return {
      ok: true,
      mensagem: `${r.correcoesRegistradas.length} item(ns) corrigido(s) com sucesso.`,
      quantidadeCorrigida: r.correcoesRegistradas.length,
    };
  } catch (err) {
    return toResultado(err);
  }
}

export async function corrigirMovSimplesAction(
  formData: FormData,
): Promise<CorrecaoResultado> {
  try {
    const movIdRaw = formData.get('movId');
    const qtdNovaRaw = formData.get('quantidadeNova');
    const motivoRaw = formData.get('motivo');
    const adminRaw = formData.get('adminResponsavel');
    if (typeof movIdRaw !== 'string' || !movIdRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Movimentação inválida.' };
    }
    const qtdNova = Number(qtdNovaRaw);
    if (!Number.isFinite(qtdNova) || qtdNova < 0 || !Number.isInteger(qtdNova)) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Quantidade nova inválida (inteiro ≥ 0).',
      };
    }
    if (typeof motivoRaw !== 'string') {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Motivo é obrigatório.' };
    }
    if (typeof adminRaw !== 'string') {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Admin responsável é obrigatório.' };
    }

    const c = await getContainer();
    const input: CorrigirMovimentacaoSimplesInput = {
      movId: MovimentacaoId(movIdRaw),
      quantidadeNova: qtdNova,
      motivo: motivoRaw,
      adminResponsavel: adminRaw,
      confirmacaoCorrecaoGrande: leConfirmacaoCorrecaoGrande(formData),
    };
    const r = await c.correcaoAdmin.corrigirMovimentacaoSimples(input);
    invalidarPaineis();
    return {
      ok: true,
      mensagem: 'Movimentação corrigida com sucesso.',
      quantidadeCorrigida: r.correcoesRegistradas.length,
    };
  } catch (err) {
    return toResultado(err);
  }
}

function toResultado(err: unknown): CorrecaoResultado {
  if (err instanceof DomainError) {
    return { ok: false, code: err.code, error: err.message };
  }
  console.error('[correcaoAdminActions]', err);
  const msg = err instanceof Error ? err.message : String(err);
  return {
    ok: false,
    code: 'INTERNAL',
    error: msg ? `Erro inesperado: ${msg}` : 'Erro inesperado.',
  };
}
