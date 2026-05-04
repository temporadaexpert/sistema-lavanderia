'use server';

import { revalidatePath } from 'next/cache';
import { getContainer } from '@/infrastructure/singleton';
import { DomainError } from '@/domain/errors/DomainErrors';
import { MovimentacaoId } from '@/domain/types/ids';
import { ResetOperacionalError } from '@/application/services/ResetOperacionalService';
import type { AcaoResultado } from './actions';

function invalidarPaineis(): void {
  revalidatePath('/admin');
  revalidatePath('/admin/divergencias-diarias');
  revalidatePath('/admin/lotes-lavanderia');
  revalidatePath('/operacao');
}

function traduzir(err: unknown, tag: string): AcaoResultado {
  if (err instanceof DomainError) {
    return { ok: false, code: err.code, error: err.message };
  }
  console.error(tag, err);
  const msg = err instanceof Error ? err.message : String(err);
  return {
    ok: false,
    code: 'INTERNAL',
    error: msg ? `Erro inesperado: ${msg}` : 'Erro inesperado ao processar operação.',
  };
}

// ---------- Cancelamento de movimentação ----------

export async function cancelarMovimentacaoAction(
  formData: FormData,
): Promise<AcaoResultado> {
  try {
    const idRaw = formData.get('movimentacaoId');
    const motivoRaw = formData.get('motivo');
    const responsavelRaw = formData.get('responsavel');

    if (typeof idRaw !== 'string' || !idRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Movimentação inválida' };
    }
    if (typeof motivoRaw !== 'string' || !motivoRaw.trim()) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Descreva o motivo do cancelamento',
      };
    }
    if (typeof responsavelRaw !== 'string' || !responsavelRaw.trim()) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Informe o responsável pela decisão',
      };
    }

    const container = await getContainer();
    await container.movimentacaoService.cancelar({
      id: MovimentacaoId(idRaw),
      motivo: motivoRaw,
      responsavel: responsavelRaw,
    });
    invalidarPaineis();
    return { ok: true, mensagem: 'Lançamento cancelado.' };
  } catch (err) {
    return traduzir(err, '[cancelarMovimentacaoAction]');
  }
}

// ---------- Limpeza de dados de teste ----------

// Frase que o gestor precisa digitar, igual ao padrão das dangerous actions
// do git/k8s. Dificulta o uso acidental.
const FRASE_CONFIRMACAO = 'LIMPAR TESTES';

export interface ResultadoLimpeza {
  readonly ok: boolean;
  readonly code?: string;
  readonly error?: string;
  readonly stepFalhou?: string;
  readonly removidos?: {
    readonly movimentacoes: number;
    readonly lotes: number;
    readonly contatos: number;
    readonly controlesDiarios: number;
  };
  readonly preservados?: {
    readonly itens: number;
    readonly locais: number;
  };
}

export async function limparDadosTesteAction(
  formData: FormData,
): Promise<ResultadoLimpeza> {
  try {
    const confirmacaoRaw = formData.get('confirmacao');
    if (typeof confirmacaoRaw !== 'string' || confirmacaoRaw.trim() !== FRASE_CONFIRMACAO) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: `Confirmação inválida — digite exatamente: ${FRASE_CONFIRMACAO}`,
      };
    }

    const container = await getContainer();
    const resumo = await container.resetOperacional.zerar();
    invalidarPaineis();
    return {
      ok: true,
      removidos: resumo.removidos,
      preservados: resumo.preservados,
    };
  } catch (err) {
    // ResetOperacionalError carrega o nome do step que falhou —
    // devolvemos na mensagem pra UI mostrar ao gestor qual bucket
    // quebrou em vez do "erro inesperado" genérico.
    if (err instanceof ResetOperacionalError) {
      console.error('[limparDadosTesteAction] step-failure', {
        step: err.step,
        cause: err.cause,
      });
      return {
        ok: false,
        code: 'RESET_STEP_FAILED',
        error: `Falha ao limpar "${err.step}": ${
          err.cause instanceof Error ? err.cause.message : String(err.cause)
        }`,
        stepFalhou: err.step,
      };
    }
    console.error('[limparDadosTesteAction]', err);
    return {
      ok: false,
      code: 'INTERNAL',
      error:
        err instanceof Error
          ? `Erro inesperado: ${err.message}`
          : 'Erro inesperado ao limpar dados de teste',
    };
  }
}
