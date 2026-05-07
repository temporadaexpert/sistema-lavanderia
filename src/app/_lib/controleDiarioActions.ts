'use server';

import { revalidatePath } from 'next/cache';
import { getContainer } from '@/infrastructure/singleton';
import {
  DomainError,
  DivergenciaDiariaDetectadaError,
  type LinhaDivergenciaDiariaDetectada,
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

// Detecção robusta de DivergenciaDiariaDetectadaError tolerante a boundary
// de módulo (Next.js às vezes carrega o mesmo arquivo via 2 paths em
// build de produção, fazendo `instanceof` falhar mesmo quando os campos
// batem). Verifica em 3 camadas: instanceof, name e code.
//
// Sem essa blindagem, em runtime de produção `instanceof` pode retornar
// false para um objeto que SEMANTICAMENTE é o erro, e o controlador cai
// no `traduzir()` genérico — gerando "Erro inesperado:" com a mensagem
// do erro. Sintoma exato relatado pelo operador.
function ehDivergenciaDiariaDetectada(
  err: unknown,
): err is DivergenciaDiariaDetectadaError {
  if (err instanceof DivergenciaDiariaDetectadaError) return true;
  // Fallback duck-typing — funciona se a classe veio de outro module
  // resolution path mas mantém shape esperado.
  if (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: unknown }).code === 'DIVERGENCIA_DIARIA_DETECTADA' &&
    'divergencias' in err &&
    Array.isArray((err as { divergencias: unknown }).divergencias)
  ) {
    return true;
  }
  if (
    err instanceof Error &&
    err.name === 'DivergenciaDiariaDetectadaError'
  ) {
    return true;
  }
  return false;
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
  // Logs temporários — aparecem em Vercel Dashboard → Logs → Functions.
  // Comprovam que a action está sendo chamada e ajudam a confirmar que o
  // commit deployado contém o fluxo novo. Remove depois de validado.
  console.info('[salvarRetornoDiarioAction] entrou', {
    fecharDia: formData.get('fecharDia'),
    classificacao: formData.get('classificacaoDivergencia'),
    origem: formData.get('origemDivergencia'),
    temMotivo: typeof formData.get('motivoDivergencia') === 'string',
    versao: 'fluxo-divergencia-diaria-v1',
  });
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
    // Diagnóstico estruturado — aparece em Functions logs.
    console.info('[salvarRetornoDiarioAction] catch', {
      tipo: err instanceof Error ? err.constructor.name : typeof err,
      name: err instanceof Error ? err.name : undefined,
      code:
        err !== null && typeof err === 'object' && 'code' in err
          ? (err as { code: unknown }).code
          : undefined,
      msg: err instanceof Error ? err.message : String(err),
    });

    // Caso especial: divergência detectada SEM classificação ao tentar
    // fechar o dia. Detecção tolerante a boundary de módulo (instanceof
    // pode falhar em produção quando o erro vem de outro path de bundle).
    if (ehDivergenciaDiariaDetectada(err)) {
      const divergencias = (err as { divergencias: readonly LinhaDivergenciaDiariaDetectada[] })
        .divergencias;
      const totalFaltante =
        (err as { totalFaltante?: number }).totalFaltante ??
        divergencias.reduce((s, l) => s + l.faltante, 0);
      const totalExcedente =
        (err as { totalExcedente?: number }).totalExcedente ??
        divergencias.reduce((s, l) => s + l.excedente, 0);
      console.info('[salvarRetornoDiarioAction] retornou DIVERGENCIA_DIARIA_DETECTADA', {
        qtdLinhas: divergencias.length,
        totalFaltante,
        totalExcedente,
      });
      return {
        ok: false,
        code: 'DIVERGENCIA_DIARIA_DETECTADA',
        error: (err as Error).message,
        divergencias,
        totalFaltante,
        totalExcedente,
      };
    }
    return traduzir(err, '[salvarRetornoDiarioAction]');
  }
}
