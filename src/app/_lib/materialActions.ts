'use server';

import { getContainer } from '@/infrastructure/singleton';
import { ItemId } from '@/domain/types/ids';
import { DomainError } from '@/domain/errors/DomainErrors';

export type AcaoResultado =
  | { ok: true; mensagem?: string }
  | { ok: false; code: string; error: string };

// Parsing tolerante a pt-BR: aceita "35,00" e "35.00". Retorna null quando
// vazio (= "preço não informado"), número >= 0 quando informado, ou erro.
function parseDecimal(raw: FormDataEntryValue | null, campo: string): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) {
    throw new ValidationFromAction(`${campo} inválido`);
  }
  return n;
}

function parseInteger(raw: FormDataEntryValue | null, campo: string): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ValidationFromAction(`${campo} deve ser número inteiro`);
  }
  return n;
}

// Erro sinalizador local — não precisa ser exportado. Convertido para
// AcaoResultado no catch abaixo.
class ValidationFromAction extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationFromAction';
  }
}

function coletarInput(formData: FormData): {
  nome: string;
  categoria: string;
  unidade: string;
  valorUnitario: number | null;
  estoqueMinimo: number | null;
  ativo: boolean;
} {
  const nome = String(formData.get('nome') ?? '');
  const categoria = String(formData.get('categoria') ?? '');
  const unidade = String(formData.get('unidade') ?? '');
  const valorUnitario = parseDecimal(formData.get('valorUnitario'), 'Valor unitário');
  const estoqueMinimo = parseInteger(formData.get('estoqueMinimo'), 'Estoque mínimo');
  const ativo = formData.get('ativo') === 'on' || formData.get('ativo') === 'true';
  return { nome, categoria, unidade, valorUnitario, estoqueMinimo, ativo };
}

export async function criarMaterialAction(formData: FormData): Promise<AcaoResultado> {
  try {
    const input = coletarInput(formData);
    const c = await getContainer();
    const item = await c.itemService.criar({
      nome: input.nome,
      categoria: input.categoria,
      unidade: input.unidade,
      valorUnitario: input.valorUnitario,
      estoqueMinimo: input.estoqueMinimo,
      ativo: input.ativo,
    });
    return { ok: true, mensagem: `Material "${item.nome}" cadastrado.` };
  } catch (err) {
    return toResultado(err, '[criarMaterialAction]');
  }
}

export async function atualizarMaterialAction(formData: FormData): Promise<AcaoResultado> {
  try {
    const idRaw = formData.get('id');
    if (typeof idRaw !== 'string' || !idRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Material inválido' };
    }
    const input = coletarInput(formData);
    const c = await getContainer();
    const item = await c.itemService.atualizar(ItemId(idRaw), {
      nome: input.nome,
      categoria: input.categoria,
      unidade: input.unidade,
      valorUnitario: input.valorUnitario,
      estoqueMinimo: input.estoqueMinimo,
      ativo: input.ativo,
    });
    return { ok: true, mensagem: `Material "${item.nome}" atualizado.` };
  } catch (err) {
    return toResultado(err, '[atualizarMaterialAction]');
  }
}

export async function alternarStatusMaterialAction(formData: FormData): Promise<AcaoResultado> {
  try {
    const idRaw = formData.get('id');
    if (typeof idRaw !== 'string' || !idRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Material inválido' };
    }
    const c = await getContainer();
    const item = await c.itemService.alternarAtivo(ItemId(idRaw));
    return {
      ok: true,
      mensagem: item.ativo
        ? `"${item.nome}" ativado.`
        : `"${item.nome}" inativado — sumiu da operação, segue visível no admin.`,
    };
  } catch (err) {
    return toResultado(err, '[alternarStatusMaterialAction]');
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
  return { ok: false, code: 'INTERNAL', error: 'Erro inesperado ao processar material' };
}
