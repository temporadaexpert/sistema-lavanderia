'use server';

import { getContainer } from '@/infrastructure/singleton';
import { LocalId } from '@/domain/types/ids';
import { LOCAL_TIPOS, type LocalTipo } from '@/domain/types/enums';
import { DomainError } from '@/domain/errors/DomainErrors';

export type AcaoResultado =
  | { ok: true; mensagem?: string }
  | { ok: false; code: string; error: string };

class ValidationFromAction extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationFromAction';
  }
}

function coletarInput(formData: FormData): { nome: string; tipo: LocalTipo; ativo: boolean } {
  const nome = String(formData.get('nome') ?? '');
  const tipoRaw = String(formData.get('tipo') ?? '');
  if (!tipoRaw) {
    throw new ValidationFromAction('Tipo é obrigatório');
  }
  if (!(LOCAL_TIPOS as readonly string[]).includes(tipoRaw)) {
    throw new ValidationFromAction(`Tipo inválido: ${tipoRaw}`);
  }
  const tipo = tipoRaw as LocalTipo;
  const ativo = formData.get('ativo') === 'on' || formData.get('ativo') === 'true';
  return { nome, tipo, ativo };
}

export async function criarLocalAction(formData: FormData): Promise<AcaoResultado> {
  try {
    const input = coletarInput(formData);
    const c = await getContainer();
    const local = await c.localService.criar({
      nome: input.nome,
      tipo: input.tipo,
      ativo: input.ativo,
    });
    return { ok: true, mensagem: `Local "${local.nome}" cadastrado.` };
  } catch (err) {
    return toResultado(err, '[criarLocalAction]');
  }
}

export async function atualizarLocalAction(formData: FormData): Promise<AcaoResultado> {
  try {
    const idRaw = formData.get('id');
    if (typeof idRaw !== 'string' || !idRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Local inválido' };
    }
    const input = coletarInput(formData);
    const c = await getContainer();
    const local = await c.localService.atualizar(LocalId(idRaw), {
      nome: input.nome,
      tipo: input.tipo,
      ativo: input.ativo,
    });
    return { ok: true, mensagem: `Local "${local.nome}" atualizado.` };
  } catch (err) {
    return toResultado(err, '[atualizarLocalAction]');
  }
}

export async function alternarStatusLocalAction(formData: FormData): Promise<AcaoResultado> {
  try {
    const idRaw = formData.get('id');
    if (typeof idRaw !== 'string' || !idRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Local inválido' };
    }
    const c = await getContainer();
    const local = await c.localService.alternarAtivo(LocalId(idRaw));
    return {
      ok: true,
      mensagem: local.ativo
        ? `"${local.nome}" ativado.`
        : `"${local.nome}" inativado — sumiu dos selects operacionais, histórico preservado.`,
    };
  } catch (err) {
    return toResultado(err, '[alternarStatusLocalAction]');
  }
}

function toResultado(err: unknown, tag: string): AcaoResultado {
  if (err instanceof DomainError) {
    return { ok: false, code: err.code, error: err.message };
  }
  if (err instanceof ValidationFromAction) {
    return { ok: false, code: 'VALIDATION_ERROR', error: err.message };
  }
  console.error(tag, err);
  return { ok: false, code: 'INTERNAL', error: 'Erro inesperado ao processar local' };
}
