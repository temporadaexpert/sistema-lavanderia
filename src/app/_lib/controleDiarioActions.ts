'use server';

import { revalidatePath } from 'next/cache';
import { getContainer } from '@/infrastructure/singleton';
import {
  DomainError,
  DivergenciaDiariaDetectadaError,
} from '@/domain/errors/DomainErrors';
import { ItemId } from '@/domain/types/ids';
import {
  CLASSIFICACOES_DIVERGENCIA_DIARIA,
  ORIGENS_DIVERGENCIA,
  type ClassificacaoDivergenciaDiaria,
  type OrigemDivergencia,
} from '@/domain/types/enums';
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

// Parsers tri-estado: undefined (ausente), null (string vazia), valor
// válido, ou 'INVALIDO' (valor fora do enum — action devolve VALIDATION_ERROR).
type ClassParse = ClassificacaoDivergenciaDiaria | null | undefined | 'INVALIDO';
function parseClassificacao(raw: unknown): ClassParse {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') return undefined;
  if (raw === '') return null;
  return (CLASSIFICACOES_DIVERGENCIA_DIARIA as readonly string[]).includes(raw)
    ? (raw as ClassificacaoDivergenciaDiaria)
    : 'INVALIDO';
}

type OrigemParse = OrigemDivergencia | null | undefined | 'INVALIDO';
function parseOrigem(raw: unknown): OrigemParse {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') return undefined;
  if (raw === '') return null;
  return (ORIGENS_DIVERGENCIA as readonly string[]).includes(raw)
    ? (raw as OrigemDivergencia)
    : 'INVALIDO';
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
    const classificacaoRaw = formData.get('classificacaoDivergencia');
    const origemRaw = formData.get('origemDivergencia');
    if (typeof dataRaw !== 'string' || !dataRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Data é obrigatória' };
    }
    if (typeof responsavelRaw !== 'string' || !responsavelRaw.trim()) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Informe o responsável' };
    }

    // Validação dos enums na fronteira HTTP (antes de chegar no service).
    const classParse = parseClassificacao(classificacaoRaw);
    if (classParse === 'INVALIDO') {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Classificação de divergência inválida.',
      };
    }
    const origemParse = parseOrigem(origemRaw);
    if (origemParse === 'INVALIDO') {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error:
          'Origem da divergência inválida. Use lavanderia, imovel, operacao ou desconhecida.',
      };
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
      // Após early-return em 'INVALIDO' acima, parses só podem ser
      // undefined | null | <enum>. Convertemos null → undefined porque o
      // service trata ausência como undefined.
      classificacaoDivergencia: classParse ?? undefined,
      origemDivergencia: origemParse ?? undefined,
    });
    invalidarPaineis();
    return { ok: true, mensagem: 'Retorno do dia registrado.' };
  } catch (err) {
    // Caso especial: divergência detectada SEM classificação ao tentar
    // fechar o dia. Não é falha — é etapa operacional. UI deve abrir
    // modal de classificação reativamente.
    if (err instanceof DivergenciaDiariaDetectadaError) {
      return {
        ok: false,
        code: 'DIVERGENCIA_DIARIA_DETECTADA',
        error: err.message,
        divergencias: err.divergencias,
        totalFaltante: err.totalFaltante,
        totalExcedente: err.totalExcedente,
      };
    }
    return traduzir(err, '[salvarRetornoDiarioAction]');
  }
}
