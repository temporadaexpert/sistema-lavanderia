'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getContainer } from '@/infrastructure/singleton';
import { ItemId, LocalId, LoteId } from '@/domain/types/ids';
import {
  MOTIVOS_FECHAMENTO,
  ORIGENS_DIVERGENCIA,
  type MotivoFechamento,
  type OrigemDivergencia,
} from '@/domain/types/enums';
import {
  DomainError,
  DivergenciaDetectadaError,
  type LinhaDivergencia,
} from '@/domain/errors/DomainErrors';
import { ACAO_CONFIG, parseAcao } from './acoes';
import type {
  ClassificacaoRetorno,
  LinhaLoteInput,
} from '@/application/services/LoteLavanderiaService';

// Após qualquer operação que mude o estado do domínio, invalidamos os
// caches de server components que mostram agregados. Assim o admin vê
// novos envios imediatamente sem depender de F5 do usuário (Next ainda
// pode cachear layouts/fetches em rotas adjacentes).
function invalidarPaineis(): void {
  revalidatePath('/admin');
  revalidatePath('/admin/divergencias-diarias');
  revalidatePath('/admin/lotes-lavanderia');
  revalidatePath('/admin/lavanderia');
  revalidatePath('/admin/perdas');
  revalidatePath('/operacao');
}

export type AcaoResultado =
  | { ok: true; mensagem?: string; loteId?: string; fechado?: boolean }
  // Caso especial: o retorno deixaria pendência mas o operador não
  // classificou. NÃO é falha fatal — é etapa operacional. UI deve abrir
  // o modal de classificação e re-submeter com `classificacao` preenchida.
  | {
      ok: false;
      code: 'DIVERGENCIA_DETECTADA';
      error: string;
      divergencias: readonly LinhaDivergencia[];
    }
  | { ok: false; code: string; error: string };

const CLASSIFICACOES_VALIDAS = [
  'perda',
  'dano',
  'extravio',
  'erro_operacional',
  'retorno_parcial',
  'outro',
] as const satisfies readonly ClassificacaoRetorno[];

function parseClassificacao(raw: unknown): ClassificacaoRetorno | undefined {
  if (typeof raw !== 'string') return undefined;
  return (CLASSIFICACOES_VALIDAS as readonly string[]).includes(raw)
    ? (raw as ClassificacaoRetorno)
    : undefined;
}

// Resultado tri-estado: ausente (undefined), null explícito (string vazia)
// ou valor enum válido. Valor inválido vira sentinela `INVALIDO` pra que
// a action devolva VALIDATION_ERROR antes de chamar o service.
type OrigemParse = OrigemDivergencia | null | undefined | 'INVALIDO';

function parseOrigemDivergencia(raw: unknown): OrigemParse {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') return undefined;
  if (raw === '') return null;
  return (ORIGENS_DIVERGENCIA as readonly string[]).includes(raw)
    ? (raw as OrigemDivergencia)
    : 'INVALIDO';
}

// Server actions da camada operacional. Todas são adapters finos: parseiam
// FormData, montam o DTO do caso de uso e traduzem DomainError em mensagem.
// Nenhuma regra de negócio vive aqui.

// Ação genérica (ações que não são de lavanderia): saída/retorno de imóvel,
// entrada de depósito, ajuste. Mantém o comportamento da etapa anterior.
export async function registrarAcaoAction(formData: FormData): Promise<AcaoResultado> {
  try {
    const acao = parseAcao(formData.get('acao'));
    if (!acao) return { ok: false, code: 'VALIDATION_ERROR', error: 'Ação inválida' };
    if (acao === 'enviar_lavanderia' || acao === 'receber_lavanderia') {
      return {
        ok: false,
        code: 'WRONG_HANDLER',
        error: 'Ações de lavanderia agora são registradas por lote — use o formulário de lote',
      };
    }
    const cfg = ACAO_CONFIG[acao];

    const itemIdRaw = formData.get('itemId');
    if (typeof itemIdRaw !== 'string' || !itemIdRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Selecione um item' };
    }

    const quantidade = Number(formData.get('quantidade'));
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Quantidade deve ser inteiro positivo' };
    }

    const origemRaw = formData.get('origemId');
    const destinoRaw = formData.get('destinoId');
    const responsavelRaw = formData.get('responsavel');
    const observacaoRaw = formData.get('observacao');

    const container = await getContainer();
    await container.movimentacaoService.registrar({
      itemId: ItemId(itemIdRaw),
      quantidade,
      tipo: cfg.tipoMovimentacao,
      origemId: typeof origemRaw === 'string' && origemRaw ? LocalId(origemRaw) : null,
      destinoId: typeof destinoRaw === 'string' && destinoRaw ? LocalId(destinoRaw) : null,
      responsavel: typeof responsavelRaw === 'string' ? responsavelRaw : '',
      observacao: typeof observacaoRaw === 'string' && observacaoRaw.trim() ? observacaoRaw.trim() : null,
    });

    invalidarPaineis();
    return { ok: true };
  } catch (err) {
    return toResultado(err, '[registrarAcaoAction]');
  }
}

// Lê pares item/quantidade de FormData multi-valued. O formulário usa
// `getAll('itemId')` e `getAll('quantidade')` preservando a ordem das
// linhas renderizadas. Linhas com quantidade 0/vazio são ignoradas.
function coletarLinhas(formData: FormData): { linhas: LinhaLoteInput[]; erro: string | null } {
  const itensRaw = formData.getAll('itemLinhaId');
  const qtdsRaw = formData.getAll('itemLinhaQtd');
  if (itensRaw.length !== qtdsRaw.length) {
    return { linhas: [], erro: 'Itens e quantidades desalinhados' };
  }
  const linhas: LinhaLoteInput[] = [];
  const idsVistos = new Set<string>();
  for (let i = 0; i < itensRaw.length; i++) {
    const idRaw = itensRaw[i];
    const qtdRaw = qtdsRaw[i];
    if (typeof idRaw !== 'string' || !idRaw) continue;
    const qtd = Number(qtdRaw);
    if (!Number.isFinite(qtd) || qtd <= 0) continue;
    if (!Number.isInteger(qtd)) {
      return { linhas: [], erro: 'Quantidade deve ser inteira' };
    }
    if (idsVistos.has(idRaw)) {
      return { linhas: [], erro: 'Mesmo item aparece em mais de uma linha — some antes de enviar' };
    }
    idsVistos.add(idRaw);
    linhas.push({ itemId: ItemId(idRaw), quantidade: qtd });
  }
  return { linhas, erro: null };
}

export async function criarLoteEnvioAction(formData: FormData): Promise<AcaoResultado> {
  // Estrutura: tudo que pode falhar fica DENTRO do try (incluindo
  // criação do lote). O redirect() fica DEPOIS do try/catch para que
  // o NEXT_REDIRECT (lançado pelo redirect) suba sem ser capturado e
  // o Next handle a navegação. Se algo falhar, retornamos AcaoResultado
  // friendly antes de chegar no redirect.
  let loteIdCriado: string | null = null;
  let erroResultado: AcaoResultado | null = null;
  try {
    const origemRaw = formData.get('origemId');
    const destinoRaw = formData.get('destinoId');
    const responsavelRaw = formData.get('responsavel');
    const observacaoRaw = formData.get('observacao');

    if (typeof origemRaw !== 'string' || !origemRaw) {
      erroResultado = {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Origem (depósito) é obrigatória',
      };
    } else if (typeof destinoRaw !== 'string' || !destinoRaw) {
      erroResultado = {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Destino (lavanderia) é obrigatório',
      };
    } else {
      const { linhas, erro } = coletarLinhas(formData);
      if (erro) {
        erroResultado = { ok: false, code: 'VALIDATION_ERROR', error: erro };
      } else if (linhas.length === 0) {
        erroResultado = {
          ok: false,
          code: 'VALIDATION_ERROR',
          error: 'Adicione pelo menos 1 item ao lote',
        };
      } else {
        const container = await getContainer();
        const lote = await container.loteLavanderia.criarEnvio({
          origemId: LocalId(origemRaw),
          destinoId: LocalId(destinoRaw),
          responsavel: typeof responsavelRaw === 'string' ? responsavelRaw : '',
          observacao:
            typeof observacaoRaw === 'string' && observacaoRaw.trim()
              ? observacaoRaw.trim()
              : null,
          itens: linhas,
        });
        loteIdCriado = lote.id;
        invalidarPaineis();
      }
    }
  } catch (err) {
    erroResultado = toResultado(err, '[criarLoteEnvioAction]');
  }

  if (erroResultado) return erroResultado;
  if (loteIdCriado) {
    // Redirect FORA do try/catch: NEXT_REDIRECT propaga normalmente
    // até o RPC do Next, que dispara navegação real do client pra
    // /romaneio/lavanderia/[id]. Garantia de que a página de impressão
    // SEMPRE abre após sucesso, sem depender de router.push do client.
    redirect(`/romaneio/lavanderia/${loteIdCriado}`);
  }
  // Caminho impossível na prática (ou erro ou lote criado). Defensive.
  return { ok: false, code: 'INTERNAL', error: 'Estado inesperado.' };
}

export async function registrarRetornoLoteAction(formData: FormData): Promise<AcaoResultado> {
  try {
    const loteIdRaw = formData.get('loteId');
    const responsavelRaw = formData.get('responsavel');
    const observacaoRaw = formData.get('observacao');
    // Campos opcionais: presentes só na 2ª submissão (após modal de
    // classificação). Na 1ª submissão chegam undefined → service detecta
    // divergência e devolve DivergenciaDetectadaError pra UI abrir modal.
    const classificacaoRaw = formData.get('classificacao');
    const motivoDescricaoRaw = formData.get('motivoDescricao');
    const responsavelFechamentoRaw = formData.get('responsavelFechamento');
    const reconhecimentoRiscoRaw = formData.get('reconhecimentoRisco');
    const origemDivergenciaRaw = formData.get('origemDivergencia');

    // Diagnóstico temporário em produção: aparece no painel Vercel
    // (Logs → Functions). Remove depois que confirmar que a action
    // certa está sendo invocada. Não loga responsável/observação pra
    // não vazar nome em log persistente.
    console.info('[registrarRetornoLoteAction] entrou', {
      loteIdPresente: typeof loteIdRaw === 'string' && loteIdRaw.length > 0,
      classificacaoRaw,
      origemDivergenciaRaw,
      temMotivoDescricao:
        typeof motivoDescricaoRaw === 'string' && motivoDescricaoRaw.length > 0,
      temResponsavelFechamento:
        typeof responsavelFechamentoRaw === 'string' &&
        responsavelFechamentoRaw.length > 0,
    });

    if (typeof loteIdRaw !== 'string' || !loteIdRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Selecione o lote a receber' };
    }

    const { linhas, erro } = coletarLinhas(formData);
    if (erro) return { ok: false, code: 'VALIDATION_ERROR', error: erro };
    if (linhas.length === 0) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error: 'Informe a quantidade retornada de pelo menos 1 item',
      };
    }

    const container = await getContainer();
    const classificacao = parseClassificacao(classificacaoRaw);
    const origemParse = parseOrigemDivergencia(origemDivergenciaRaw);
    if (origemParse === 'INVALIDO') {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        error:
          'Origem da divergência inválida. Use lavanderia, imovel, operacao ou desconhecida.',
      };
    }
    const origemDivergencia: OrigemDivergencia | null | undefined =
      origemParse === undefined ? undefined : origemParse;
    const resultado = await container.loteLavanderia.registrarRetornoEFinalizar({
      loteId: LoteId(loteIdRaw),
      responsavel: typeof responsavelRaw === 'string' ? responsavelRaw : '',
      observacao:
        typeof observacaoRaw === 'string' && observacaoRaw.trim() ? observacaoRaw.trim() : null,
      itens: linhas,
      classificacao,
      motivoDescricao:
        typeof motivoDescricaoRaw === 'string' && motivoDescricaoRaw.trim()
          ? motivoDescricaoRaw.trim()
          : null,
      responsavelFechamento:
        typeof responsavelFechamentoRaw === 'string' && responsavelFechamentoRaw.trim()
          ? responsavelFechamentoRaw.trim()
          : null,
      reconhecimentoRisco:
        reconhecimentoRiscoRaw === 'on' ||
        reconhecimentoRiscoRaw === 'true' ||
        reconhecimentoRiscoRaw === '1',
      origemDivergencia,
    });

    console.info('[registrarRetornoLoteAction] chamou registrarRetornoEFinalizar', {
      status: resultado.status,
      fechado: resultado.fechado,
      pendenciaResidual: resultado.pendenciaResidual,
    });
    invalidarPaineis();
    const mensagem =
      resultado.status === 'concluido_com_divergencia'
        ? 'Retorno registrado e lote concluído com divergência.'
        : resultado.status === 'registrado_parcial'
          ? 'Retorno parcial registrado — lote permanece aberto aguardando o restante.'
          : 'Retorno registrado e pendências atualizadas.';
    return { ok: true, mensagem, fechado: resultado.fechado };
  } catch (err) {
    // Caso especial: divergência detectada sem classificação. Não é
    // falha — UI deve oferecer modal de motivo e re-submeter.
    if (err instanceof DivergenciaDetectadaError) {
      console.info('[registrarRetornoLoteAction] retornou DIVERGENCIA_DETECTADA', {
        qtdLinhas: err.divergencias.length,
        totalFaltante: err.divergencias.reduce((s, l) => s + l.diferenca, 0),
      });
      return {
        ok: false,
        code: 'DIVERGENCIA_DETECTADA',
        error: err.message,
        divergencias: err.divergencias,
      };
    }
    console.info('[registrarRetornoLoteAction] erro', {
      tipo: err instanceof Error ? err.constructor.name : typeof err,
      msg: err instanceof Error ? err.message : String(err),
    });
    return toResultado(err, '[registrarRetornoLoteAction]');
  }
}

function parseMotivo(raw: unknown): MotivoFechamento | null {
  if (typeof raw !== 'string') return null;
  return (MOTIVOS_FECHAMENTO as readonly string[]).includes(raw)
    ? (raw as MotivoFechamento)
    : null;
}

export async function encerrarLoteAction(formData: FormData): Promise<AcaoResultado> {
  try {
    const loteIdRaw = formData.get('loteId');
    const motivoRaw = formData.get('motivo');
    const motivoDescricaoRaw = formData.get('motivoDescricao');
    const responsavelRaw = formData.get('responsavel');
    const reconhecimentoRiscoRaw = formData.get('reconhecimentoRisco');

    if (typeof loteIdRaw !== 'string' || !loteIdRaw) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Lote inválido' };
    }
    const motivo = parseMotivo(motivoRaw);
    if (!motivo) {
      return { ok: false, code: 'VALIDATION_ERROR', error: 'Selecione um motivo' };
    }

    const container = await getContainer();
    await container.loteLavanderia.encerrarComPendencia({
      loteId: LoteId(loteIdRaw),
      motivo,
      motivoDescricao:
        typeof motivoDescricaoRaw === 'string' && motivoDescricaoRaw.trim()
          ? motivoDescricaoRaw.trim()
          : null,
      responsavel: typeof responsavelRaw === 'string' ? responsavelRaw : '',
      reconhecimentoRisco: reconhecimentoRiscoRaw === 'on' || reconhecimentoRiscoRaw === 'true',
    });

    invalidarPaineis();
    return { ok: true, mensagem: 'Lote encerrado. Ajuste de saldo registrado.' };
  } catch (err) {
    return toResultado(err, '[encerrarLoteAction]');
  }
}

function toResultado(err: unknown, tag: string): AcaoResultado {
  if (err instanceof DomainError) {
    return { ok: false, code: err.code, error: err.message };
  }
  // Erros não-domínio geralmente são bugs (TypeError, I/O, etc). Em vez
  // de mascarar com "Erro inesperado" (que impede qualquer diagnóstico),
  // surface a mensagem real para a UI. Stack completa fica no log do server.
  console.error(tag, err);
  const msg = err instanceof Error ? err.message : String(err);
  return {
    ok: false,
    code: 'INTERNAL',
    error: msg
      ? `Erro inesperado: ${msg}`
      : 'Erro inesperado ao processar operação (sem detalhes).',
  };
}
