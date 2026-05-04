'use server';

import { getContainer } from '@/infrastructure/singleton';
import { DomainError } from '@/domain/errors/DomainErrors';
import type { Category } from '@/domain/entities/Category';

export type CriarCategoriaResultado =
  | { ok: true; categoria: Category }
  | { ok: false; code: string; error: string };

export async function criarCategoriaAction(
  formData: FormData,
): Promise<CriarCategoriaResultado> {
  try {
    const nomeRaw = formData.get('nome');
    if (typeof nomeRaw !== 'string' || !nomeRaw.trim()) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Nome é obrigatório' };
    }
    const c = await getContainer();
    const categoria = await c.categoryService.criar({ nome: nomeRaw });
    return { ok: true, categoria };
  } catch (err) {
    if (err instanceof DomainError) {
      return { ok: false, code: err.code, error: err.message };
    }
    console.error('[criarCategoriaAction]', err);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: 'INTERNAL',
      error: msg ? `Erro inesperado: ${msg}` : 'Erro inesperado ao criar categoria.',
    };
  }
}
