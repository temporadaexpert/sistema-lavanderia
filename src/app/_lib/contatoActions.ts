'use server';

import { getContainer } from '@/infrastructure/singleton';
import { LoteId } from '@/domain/types/ids';
import {
  TIPOS_CONTATO_LAVANDERIA,
  type TipoContatoLavanderia,
} from '@/domain/types/enums';
import { DomainError } from '@/domain/errors/DomainErrors';

export type AcaoResultado =
  | { ok: true; mensagem?: string }
  | { ok: false; code: string; error: string };

function parseTipo(raw: unknown): TipoContatoLavanderia | null {
  if (typeof raw !== 'string') return null;
  return (TIPOS_CONTATO_LAVANDERIA as readonly string[]).includes(raw)
    ? (raw as TipoContatoLavanderia)
    : null;
}

export async function registrarContatoAction(formData: FormData): Promise<AcaoResultado> {
  try {
    const loteIdRaw = formData.get('loteId');
    if (typeof loteIdRaw !== 'string' || !loteIdRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Lote inválido' };
    }
    const tipo = parseTipo(formData.get('tipo'));
    if (!tipo) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Tipo de contato inválido' };
    }
    const responsavel = String(formData.get('responsavel') ?? '');
    const observacaoRaw = formData.get('observacao');
    const proximaAcaoRaw = formData.get('proximaAcao');
    const promessaRaw = formData.get('promessaRetornoData');

    const observacao =
      typeof observacaoRaw === 'string' && observacaoRaw.trim()
        ? observacaoRaw.trim()
        : null;
    const proximaAcao =
      typeof proximaAcaoRaw === 'string' && proximaAcaoRaw.trim()
        ? proximaAcaoRaw.trim()
        : null;
    const promessa =
      typeof promessaRaw === 'string' && promessaRaw.trim() ? promessaRaw.trim() : null;

    const c = await getContainer();
    const contato = await c.contatoLavanderiaService.registrar({
      loteId: LoteId(loteIdRaw),
      tipo,
      responsavel,
      observacao,
      proximaAcao,
      promessaRetornoData: promessa,
    });

    return {
      ok: true,
      mensagem: `Cobrança registrada (${contato.tipo}${contato.promessaRetornoData ? ' · promessa para ' + formatarDataCurta(contato.promessaRetornoData) : ''}).`,
    };
  } catch (err) {
    if (err instanceof DomainError) {
      return { ok: false, code: err.code, error: err.message };
    }
    console.error('[registrarContatoAction]', err);
    return { ok: false, code: 'INTERNAL', error: 'Erro inesperado ao registrar cobrança' };
  }
}

function formatarDataCurta(iso: string): string {
  const ymd = iso.slice(0, 10);
  const [ano, mes, dia] = ymd.split('-');
  return `${dia}/${mes}/${ano}`;
}
