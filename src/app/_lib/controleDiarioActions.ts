'use server';

import { revalidatePath } from 'next/cache';
import { getContainer } from '@/infrastructure/singleton';
import { DomainError } from '@/domain/errors/DomainErrors';
import { ItemId } from '@/domain/types/ids';
import type { AcaoResultado } from './actions';
import type {
  LinhaEnviada,
  LinhaRetornada,
} from '@/domain/entities/ControleDiarioEnxoval';

function invalidarPaineis(): void {
  revalidatePath('/admin');
  revalidatePath('/admin/divergencias-diarias');
  revalidatePath('/operacao');
  revalidatePath('/operacao/envio-diario');
  revalidatePath('/operacao/retorno-diario');
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

// Parseia campos do tipo `qtd[item-xxx]=5` — o front envia um campo por
// item, zerado no default. Ignora keys não reconhecidas.
function parseEnvio(formData: FormData): LinhaEnviada[] {
  const out: LinhaEnviada[] = [];
  for (const [key, value] of formData.entries()) {
    const m = key.match(/^qtd\[(.+)\]$/);
    if (!m || !m[1]) continue;
    const itemId = m[1];
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    out.push({ itemId: ItemId(itemId), quantidade: Math.max(0, Math.floor(n)) });
  }
  return out;
}

function parseRetorno(formData: FormData): LinhaRetornada[] {
  // Junta pares sujo/limpo pelo itemId.
  const mapa = new Map<string, { sujo: number; limpo: number }>();
  for (const [key, value] of formData.entries()) {
    const mSujo = key.match(/^sujo\[(.+)\]$/);
    const mLimpo = key.match(/^limpo\[(.+)\]$/);
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    const q = Math.max(0, Math.floor(n));
    if (mSujo && mSujo[1]) {
      const atual = mapa.get(mSujo[1]) ?? { sujo: 0, limpo: 0 };
      mapa.set(mSujo[1], { ...atual, sujo: q });
    } else if (mLimpo && mLimpo[1]) {
      const atual = mapa.get(mLimpo[1]) ?? { sujo: 0, limpo: 0 };
      mapa.set(mLimpo[1], { ...atual, limpo: q });
    }
  }
  return Array.from(mapa, ([id, v]) => ({
    itemId: ItemId(id),
    recebidoSujo: v.sujo,
    recebidoLimpo: v.limpo,
  }));
}

export async function salvarEnvioDiarioAction(
  formData: FormData,
): Promise<AcaoResultado> {
  try {
    const dataRaw = formData.get('data');
    const responsavelRaw = formData.get('responsavel');
    if (typeof dataRaw !== 'string' || !dataRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Data é obrigatória' };
    }
    if (typeof responsavelRaw !== 'string' || !responsavelRaw.trim()) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Informe o responsável' };
    }
    const itens = parseEnvio(formData);
    if (itens.length === 0 || itens.every((l) => l.quantidade === 0)) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Informe pelo menos uma quantidade positiva',
      };
    }
    const container = await getContainer();
    await container.controleDiario.registrarEnvio({
      data: dataRaw,
      responsavel: responsavelRaw,
      itens,
    });
    invalidarPaineis();
    return { ok: true, mensagem: 'Envio do dia registrado.' };
  } catch (err) {
    return traduzir(err, '[salvarEnvioDiarioAction]');
  }
}

export async function salvarRetornoDiarioAction(
  formData: FormData,
): Promise<AcaoResultado> {
  try {
    const dataRaw = formData.get('data');
    const responsavelRaw = formData.get('responsavel');
    const fecharRaw = formData.get('fecharDia');
    const motivoRaw = formData.get('motivoDivergencia');
    const responsavelFechamentoRaw = formData.get('responsavelFechamento');
    if (typeof dataRaw !== 'string' || !dataRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Data é obrigatória' };
    }
    if (typeof responsavelRaw !== 'string' || !responsavelRaw.trim()) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Informe o responsável' };
    }
    const itens = parseRetorno(formData);
    const container = await getContainer();
    await container.controleDiario.registrarRetorno({
      data: dataRaw,
      responsavel: responsavelRaw,
      itens,
      fecharDia: fecharRaw === 'on' || fecharRaw === 'true',
      motivoDivergencia:
        typeof motivoRaw === 'string' && motivoRaw.trim() ? motivoRaw.trim() : undefined,
      responsavelFechamento:
        typeof responsavelFechamentoRaw === 'string' && responsavelFechamentoRaw.trim()
          ? responsavelFechamentoRaw.trim()
          : undefined,
    });
    invalidarPaineis();
    return { ok: true, mensagem: 'Retorno do dia registrado.' };
  } catch (err) {
    return traduzir(err, '[salvarRetornoDiarioAction]');
  }
}
