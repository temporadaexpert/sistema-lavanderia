import type { Lote } from '@/domain/entities/Lote';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { ItemId, LocalId, LoteId } from '@/domain/types/ids';
import { LoteId as LoteIdCtor } from '@/domain/types/ids';
import {
  MOTIVOS_FECHAMENTO,
  ORIGENS_DIVERGENCIA,
  type LoteStatus,
  type MotivoFechamento,
  type OrigemDivergencia,
} from '@/domain/types/enums';
import {
  DivergenciaDetectadaError,
  type LinhaDivergencia,
  NotFoundError,
  ValidationError,
} from '@/domain/errors/DomainErrors';
import { REGRAS_DIVERGENCIA } from '@/domain/rules/divergenciaRules';
import type { ItemRepository } from '../ports/ItemRepository';
import type { LocalRepository } from '../ports/LocalRepository';
import type { LoteRepository } from '../ports/LoteRepository';
import type { MovimentacaoRepository } from '../ports/MovimentacaoRepository';
import type { Clock, IdGenerator, MovimentacaoService } from './MovimentacaoService';
import type { SaldoService } from './SaldoService';
import type { DivergenciaService } from './DivergenciaService';
import type { ContatoLavanderiaService } from './ContatoLavanderiaService';

export interface LinhaLoteInput {
  readonly itemId: ItemId;
  readonly quantidade: number;
  readonly observacao?: string | null;
}

export interface CriarLoteEnvioInput {
  readonly origemId: LocalId;
  readonly destinoId: LocalId;
  readonly responsavel: string;
  readonly observacao?: string | null;
  readonly dataEnvio?: string;
  readonly itens: readonly LinhaLoteInput[];
}

export interface RegistrarRetornoLoteInput {
  readonly loteId: LoteId;
  readonly responsavel: string;
  readonly observacao?: string | null;
  readonly dataRetorno?: string;
  readonly itens: readonly LinhaLoteInput[];
}

// Classificação operacional do retorno quando há divergência. Só 5 das 6
// opções da UI viram fechamento — `retorno_parcial` é UI-only e mapeia
// para "registra retorno e mantém lote aberto" (comportamento default).
//
//   perda          → fecha como 'perda_confirmada'
//   dano           → fecha como 'danificado'
//   extravio       → fecha como 'extravio'
//   erro_operacional → fecha como 'erro_operacional'
//   outro          → fecha como 'outros' (exige descricao)
//   retorno_parcial → não fecha (mais peças virão)
export type ClassificacaoRetorno =
  | 'perda'
  | 'dano'
  | 'extravio'
  | 'erro_operacional'
  | 'retorno_parcial'
  | 'outro';

const CLASSIFICACAO_PARA_MOTIVO: Record<
  Exclude<ClassificacaoRetorno, 'retorno_parcial'>,
  MotivoFechamento
> = {
  perda: 'perda_confirmada',
  dano: 'danificado',
  extravio: 'extravio',
  erro_operacional: 'erro_operacional',
  outro: 'outros',
};

export interface RegistrarRetornoEFinalizarInput extends RegistrarRetornoLoteInput {
  // Se ausente e o retorno deixar pendência, o service lança
  // DivergenciaDetectadaError em vez de gravar — UI deve abrir o modal
  // de classificação e re-submeter com este campo preenchido.
  readonly classificacao?: ClassificacaoRetorno;
  // Texto livre do motivo (obrigatório quando classificacao='outro').
  readonly motivoDescricao?: string | null;
  // Se diferente do `responsavel`, registra quem autorizou o fechamento.
  // Útil quando o operador chama o gestor pra autorizar a baixa.
  readonly responsavelFechamento?: string | null;
  // Confirmação de risco — propagada pro encerrarComPendencia interno
  // quando classificação fecha o lote. Mantém invariante de que lotes
  // de risco exigem ciência explícita.
  readonly reconhecimentoRisco?: boolean;
  // Origem provável da divergência. OBRIGATÓRIA quando classificacao é
  // uma das 5 que fecham o lote (perda/dano/extravio/erro_operacional/outro).
  // Opcional/null quando classificacao é 'retorno_parcial' (lote permanece
  // aberto, ainda não há divergência consolidada pra atribuir origem).
  readonly origemDivergencia?: OrigemDivergencia | null;
}

export interface ResultadoRetornoFinalizado {
  readonly status: 'registrado_sem_pendencia' | 'registrado_parcial' | 'concluido_com_divergencia';
  readonly pendenciaResidual: number;
  readonly fechado: boolean;
}

export interface EncerrarLoteInput {
  readonly loteId: LoteId;
  readonly motivo: MotivoFechamento;
  readonly motivoDescricao?: string | null;
  readonly responsavel: string;
  // Confirmação explícita de que o gestor está ciente dos riscos
  // (lote nunca cobrado, promessa vencida, valor alto, pendência antiga).
  // Quando há risco detectado e essa flag é false/ausente, o service
  // rejeita — protege contra baixas descuidadas.
  readonly reconhecimentoRisco?: boolean;
  // Origem provável da divergência. Obrigatória quando o encerramento
  // resulta de uma classificação operacional (ver registrarRetornoEFinalizar);
  // opcional no caminho admin (encerramento direto via /admin) — fica null
  // se não informada.
  readonly origemDivergencia?: OrigemDivergencia | null;
}

// Análise de risco pré-encerramento. Consumido pela UI (modal) para
// alertar o gestor antes do clique, e pelo próprio service como
// revalidação server-side (não dá pra confiar no input do cliente).
export interface RiscoEncerramento {
  readonly temRisco: boolean;
  readonly nuncaCobrado: boolean;
  readonly promessaVencida: boolean;
  readonly diasAtrasoPromessa: number | null;
  readonly valorPendenteAlto: boolean;
  readonly valorPendente: number;
  readonly pendenciaAntiga: boolean;
  readonly diasDesdeEnvio: number;
  // Mensagens legíveis — usadas no aviso da UI e gravadas no
  // motivoDescricao quando o encerramento é forçado.
  readonly motivos: readonly string[];
}

export interface LoteItemDetalhe {
  readonly itemId: ItemId;
  readonly nomeItem: string;
  readonly unidade: string;
  readonly totalEnviado: number;
  readonly totalRetornado: number;
  readonly pendencia: number;           // enviado - retornado (fato operacional)
  readonly baixadoPorAjuste: number;    // total dado baixa via ajustes vinculados ao lote
  readonly pendenciaEfetiva: number;    // pendência - baixado (o que ainda sobra em aberto)
}

export interface LoteResumo {
  readonly lote: Lote;
  readonly status: LoteStatus;
  readonly encerrado: boolean;
  readonly totalEnviado: number;
  readonly totalRetornado: number;
  readonly totalAjustado: number;
  readonly pendenciaTotal: number;       // enviado - retornado (fato operacional)
  readonly pendenciaEfetiva: number;     // o que ainda sobra depois de ajustes
  readonly possuiDivergencia: boolean;
  readonly itensDistintos: number;
}

export interface LoteDetalhe extends LoteResumo {
  readonly itens: readonly LoteItemDetalhe[];
  readonly origemNome: string;
  readonly destinoNome: string;
  readonly movimentacoes: readonly Movimentacao[];
}

// Orquestra criação de lotes, registro de retornos vinculados, encerramento
// com baixa de pendência e projeções de status/pendência. A aritmética e o
// mapeamento ação→tipo vivem aqui; a fonte de verdade das quantidades
// continua sendo o log de Movimentacao. As quantidades do lote NÃO são
// armazenadas — são derivadas filtrando movs por loteId. Mesmo invariante
// do SaldoService.
export class LoteLavanderiaService {
  constructor(
    private readonly lotes: LoteRepository,
    private readonly itens: ItemRepository,
    private readonly locais: LocalRepository,
    private readonly movimentacoes: MovimentacaoRepository,
    private readonly movService: MovimentacaoService,
    private readonly saldos: SaldoService,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
    // Deps adicionadas para avaliação de risco no encerramento. Ambas
    // puras (não mutam nada) — só fornecem dados para a decisão.
    private readonly divergencias: DivergenciaService,
    private readonly contatos: ContatoLavanderiaService,
  ) {}

  async criarEnvio(input: CriarLoteEnvioInput): Promise<Lote> {
    if (!input.itens || input.itens.length === 0) {
      throw new ValidationError('Lote precisa de pelo menos 1 item');
    }
    if (!input.responsavel?.trim()) {
      throw new ValidationError('Responsável é obrigatório');
    }
    // Validação da data operacional (separada de `criadoEm`). Permite
    // retroativo (até DIAS_RETROATIVO_MAX dias) mas NÃO futuro — auditoria
    // só fica íntegra se nenhum lote for datado depois do "agora real".
    if (input.dataEnvio) {
      this.validarDataEnvioOperacional(input.dataEnvio);
    }
    for (const linha of input.itens) {
      if (!Number.isInteger(linha.quantidade) || linha.quantidade <= 0) {
        throw new ValidationError('Quantidade de cada linha deve ser inteiro positivo');
      }
    }
    const idsNoLote = new Set<ItemId>();
    for (const linha of input.itens) {
      if (idsNoLote.has(linha.itemId)) {
        throw new ValidationError(
          `Item ${linha.itemId} aparece mais de uma vez no lote — some as quantidades antes de enviar`,
        );
      }
      idsNoLote.add(linha.itemId);
    }

    const origem = await this.locais.porId(input.origemId);
    const destino = await this.locais.porId(input.destinoId);
    if (!origem) throw new NotFoundError('Local (origem)', input.origemId);
    if (!destino) throw new NotFoundError('Local (destino)', input.destinoId);
    if (origem.tipo !== 'deposito') {
      throw new ValidationError(`Origem do lote deve ser depósito (recebido: ${origem.tipo})`);
    }
    if (destino.tipo !== 'lavanderia') {
      throw new ValidationError(`Destino do lote deve ser lavanderia (recebido: ${destino.tipo})`);
    }

    // Pré-check antes de criar o lote: se alguma linha não couber no
    // estoque disponível, rejeita sem side-effects. Usa a validação
    // central do SaldoService (novo modelo com fallback legacy).
    for (const linha of input.itens) {
      await this.saldos.garantirEstoqueParaSaida(
        linha.itemId,
        input.origemId,
        linha.quantidade,
      );
    }

    const agora = this.clock.agoraISO();
    const dataEnvio = input.dataEnvio ?? agora;
    const id = LoteIdCtor(this.idGen.gerar());
    const codigo = await this.proximoCodigo(dataEnvio);
    const lote: Lote = {
      id,
      codigo,
      criadoEm: agora,
      dataEnvio,
      origemId: input.origemId,
      destinoId: input.destinoId,
      responsavel: input.responsavel,
      observacao: input.observacao?.trim() ? input.observacao.trim() : null,
      encerradoEm: null,
      encerradoPor: null,
      motivoFechamento: null,
      motivoDescricao: null,
      origemDivergencia: null,
    };
    await this.lotes.criar(lote);

    for (const linha of input.itens) {
      await this.movService.registrar({
        itemId: linha.itemId,
        quantidade: linha.quantidade,
        tipo: 'envio_lavanderia',
        origemId: input.origemId,
        destinoId: input.destinoId,
        responsavel: input.responsavel,
        dataHora: dataEnvio,
        loteId: id,
        observacao: linha.observacao ?? null,
      });
    }

    return lote;
  }

  // Limite máximo de retroatividade — escolhido em 90 dias por:
  //   - cobre lançamentos esquecidos do trimestre anterior (caso real)
  //   - bloqueia digitação acidental (operador colocando ano 1925)
  //   - mantém auditoria com janela razoável de "registros ainda em revisão"
  private readonly DIAS_RETROATIVO_MAX = 90;

  // Valida a data operacional do envio. Regras:
  //   - Formato ISO datetime válido (parseável por Date)
  //   - Não pode ser FUTURA (em horário São Paulo) — não se "envia"
  //     amanhã hoje; envio futuro deve ser registrado quando ocorrer.
  //   - Pode ser passada até DIAS_RETROATIVO_MAX (lançamento retroativo
  //     legítimo). Operador classifica retroatividade, sistema permite.
  //
  // Timezone São Paulo é usado pra resolver "hoje" — o operador trabalha
  // no horário local e o conceito de "data do envio" é local. Internamente
  // a data é armazenada como ISO datetime (timestamptz no banco) ancorada
  // ao meio-dia UTC pelo caller, evitando drift de fuso.
  private validarDataEnvioOperacional(iso: string): void {
    const data = new Date(iso);
    if (Number.isNaN(data.getTime())) {
      throw new ValidationError(
        `Data de envio inválida: "${iso}".`,
      );
    }

    const TZ = 'America/Sao_Paulo';
    const fmtYmd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });

    const agora = new Date(this.clock.agoraISO());
    const hojeYmd = fmtYmd.format(agora);
    const dataYmd = fmtYmd.format(data);

    if (dataYmd > hojeYmd) {
      throw new ValidationError(
        `Data de envio não pode ser futura. Informado: ${dataYmd}, hoje: ${hojeYmd}.`,
      );
    }

    // Limite retroativo: subtrai dias do "agora" e converte para YMD em
    // SP. Comparação por string YYYY-MM-DD é segura (lexicográfica = temporal).
    const limite = new Date(agora);
    limite.setUTCDate(limite.getUTCDate() - this.DIAS_RETROATIVO_MAX);
    const limiteYmd = fmtYmd.format(limite);

    if (dataYmd < limiteYmd) {
      throw new ValidationError(
        `Data de envio muito antiga (limite: ${this.DIAS_RETROATIVO_MAX} dias). Informado: ${dataYmd}, mínimo: ${limiteYmd}.`,
      );
    }
  }

  async registrarRetorno(input: RegistrarRetornoLoteInput): Promise<void> {
    if (!input.itens || input.itens.length === 0) {
      throw new ValidationError('Retorno precisa de pelo menos 1 item');
    }
    if (!input.responsavel?.trim()) {
      throw new ValidationError('Responsável é obrigatório');
    }
    const lote = await this.lotes.porId(input.loteId);
    if (!lote) throw new NotFoundError('Lote', input.loteId);
    if (lote.encerradoEm) {
      throw new ValidationError('Lote encerrado não aceita mais retornos');
    }

    const agora = this.clock.agoraISO();
    const dataRetorno = input.dataRetorno ?? agora;

    for (const linha of input.itens) {
      if (!Number.isInteger(linha.quantidade) || linha.quantidade <= 0) {
        continue;
      }
      await this.movService.registrar({
        itemId: linha.itemId,
        quantidade: linha.quantidade,
        tipo: 'retorno_lavanderia',
        origemId: lote.destinoId,
        destinoId: lote.origemId,
        responsavel: input.responsavel,
        dataHora: dataRetorno,
        loteId: input.loteId,
        observacao: linha.observacao ?? input.observacao ?? null,
      });
    }
  }

  // Fluxo unificado do operador no /operacao/acao/receber-lavanderia.
  //
  // Resolve a "trava" do fluxo antigo, em que o operador registrava menos
  // peças que o pendente e o lote ficava preso em `retorno_parcial` para
  // sempre — sem caminho operacional para concluir. Agora:
  //
  //   1. PRÉ-VALIDA: projeta a pendência residual a partir do estado atual
  //      e do retorno proposto, SEM gravar nada ainda.
  //   2. Se haverá pendência E `classificacao` foi omitida → lança
  //      `DivergenciaDetectadaError` com a lista detalhada item-a-item
  //      (a UI abre modal e re-submete com classificacao preenchida).
  //   3. Se haverá pendência E `classificacao` indica retorno_parcial →
  //      grava só o retorno (lote permanece aberto, mais virá).
  //   4. Se haverá pendência E `classificacao` é uma das 5 que fecham →
  //      grava retorno + fecha o lote via `encerrarComPendencia` (que
  //      registra um ajuste por item zerando o saldo de lavanderia).
  //   5. Se NÃO houver pendência → grava só o retorno (status 'concluido'
  //      derivado; encerradoEm fica null porque não há pendência a baixar).
  //
  // Atomicidade: o pre-check (passo 1) garante que NUNCA gravamos retorno
  // sem direito a fechar quando o operador esqueceu de classificar. Quando
  // grava + fecha, o fechamento usa `encerrarComPendencia` que é auto-
  // convergente (re-tentativa cobre o que sobrou em caso de falha parcial).
  async registrarRetornoEFinalizar(
    input: RegistrarRetornoEFinalizarInput,
  ): Promise<ResultadoRetornoFinalizado> {
    // Validações estruturais idênticas ao registrarRetorno (preserva
    // mensagens amigáveis para o operador).
    if (!input.itens || input.itens.length === 0) {
      throw new ValidationError('Retorno precisa de pelo menos 1 item');
    }
    if (!input.responsavel?.trim()) {
      throw new ValidationError('Responsável é obrigatório');
    }
    const lote = await this.lotes.porId(input.loteId);
    if (!lote) throw new NotFoundError('Lote', input.loteId);
    if (lote.encerradoEm) {
      throw new ValidationError('Lote encerrado não aceita mais retornos');
    }

    // Projeta pendência APÓS o retorno proposto, sem gravar. Soma o que
    // já voltou (movs históricas) + o que está sendo proposto agora.
    const detalheAtual = await this.detalhe(input.loteId);
    if (!detalheAtual) throw new NotFoundError('Lote', input.loteId);

    const propostaPorItem = new Map<ItemId, number>();
    for (const linha of input.itens) {
      if (!Number.isInteger(linha.quantidade) || linha.quantidade < 0) continue;
      propostaPorItem.set(
        linha.itemId,
        (propostaPorItem.get(linha.itemId) ?? 0) + linha.quantidade,
      );
    }

    // Linhas com pendência residual (após propor). Excedente — operador
    // tentando devolver mais que o pendente — é proibido por integridade
    // (não tem como ser pendência negativa).
    const divergenciasResiduais: LinhaDivergencia[] = [];
    for (const item of detalheAtual.itens) {
      const proposto = propostaPorItem.get(item.itemId) ?? 0;
      if (proposto > item.pendenciaEfetiva) {
        throw new ValidationError(
          `Quantidade retornada de "${item.nomeItem}" (${proposto}) excede o pendente (${item.pendenciaEfetiva}).`,
        );
      }
      const residual = item.pendenciaEfetiva - proposto;
      if (residual > 0) {
        divergenciasResiduais.push({
          itemId: item.itemId,
          nomeItem: item.nomeItem,
          enviado: item.totalEnviado,
          retornado: item.totalRetornado + proposto,
          diferenca: residual,
        });
      }
    }

    const haDivergencia = divergenciasResiduais.length > 0;

    // Diagnóstico temporário pra confirmar caminho em produção. Aparece
    // nos logs de Function da Vercel.
    console.info('[registrarRetornoEFinalizar] pré-check', {
      haDivergencia,
      qtdLinhasDivergentes: divergenciasResiduais.length,
      classificacao: input.classificacao,
      origemDivergencia: input.origemDivergencia,
    });

    // Bloqueia se há divergência mas operador não classificou — UI deve
    // abrir modal de motivo e re-submeter. Nada foi gravado.
    if (haDivergencia && !input.classificacao) {
      throw new DivergenciaDetectadaError(divergenciasResiduais);
    }

    // Validação de motivo='outro' exige descrição (mesma regra do encerrarComPendencia).
    if (
      haDivergencia &&
      input.classificacao === 'outro' &&
      !input.motivoDescricao?.trim()
    ) {
      throw new ValidationError(
        'Quando a classificação é "outro", a descrição do motivo é obrigatória.',
      );
    }

    // Origem da divergência é OBRIGATÓRIA quando a classificação fecha o
    // lote (5 das 6 opções). Sem origem, relatórios de "perda por imóvel"
    // vs "perda por lavanderia" ficam corrompidos por valores nulos. Para
    // `retorno_parcial`, origem fica null (lote permanece aberto, ainda
    // não há divergência consolidada).
    if (
      haDivergencia &&
      input.classificacao &&
      input.classificacao !== 'retorno_parcial'
    ) {
      if (!input.origemDivergencia) {
        throw new ValidationError(
          'Origem provável da divergência é obrigatória quando há perda/dano/extravio/erro/outro.',
        );
      }
      if (!(ORIGENS_DIVERGENCIA as readonly string[]).includes(input.origemDivergencia)) {
        throw new ValidationError(
          `Origem da divergência inválida: "${input.origemDivergencia}". Use lavanderia, imovel, operacao ou desconhecida.`,
        );
      }
    }

    // Caminho 1: grava o retorno (mesmo path do registrarRetorno legado).
    await this.registrarRetorno(input);

    // Caminho 2: sem divergência ou retorno parcial → não fecha. Done.
    if (!haDivergencia) {
      return {
        status: 'registrado_sem_pendencia',
        pendenciaResidual: 0,
        fechado: false,
      };
    }
    if (input.classificacao === 'retorno_parcial') {
      return {
        status: 'registrado_parcial',
        pendenciaResidual: divergenciasResiduais.reduce((s, l) => s + l.diferenca, 0),
        fechado: false,
      };
    }

    // Caminho 3: classificação fecha o lote. Mapeia pra MotivoFechamento
    // e delega pro fluxo administrativo de encerramento.
    const classFechamento = input.classificacao as Exclude<
      ClassificacaoRetorno,
      'retorno_parcial'
    >;
    const motivo = CLASSIFICACAO_PARA_MOTIVO[classFechamento];
    await this.encerrarComPendencia({
      loteId: input.loteId,
      motivo,
      motivoDescricao: input.motivoDescricao ?? null,
      responsavel: input.responsavelFechamento?.trim() || input.responsavel.trim(),
      reconhecimentoRisco: input.reconhecimentoRisco ?? false,
      origemDivergencia: input.origemDivergencia ?? null,
    });

    return {
      status: 'concluido_com_divergencia',
      pendenciaResidual: divergenciasResiduais.reduce((s, l) => s + l.diferenca, 0),
      fechado: true,
    };
  }

  // Diagnóstico pré-encerramento. Útil para a UI mostrar avisos no modal
  // e para o próprio `encerrarComPendencia` revalidar antes de aceitar
  // a baixa. Nenhuma mutação — puramente leitura.
  //
  // Critérios de risco (thresholds em REGRAS_DIVERGENCIA):
  //   - Lote com pendência e nenhum contato registrado (nunca cobrado)
  //   - Promessa de retorno vencida e ainda não cumprida
  //   - Valor pendente ≥ VALOR_CRITICO_BRL
  //   - Dias desde envio ≥ DIAS_CRITICO
  async avaliarRiscoEncerramento(
    loteId: LoteId,
    agoraMs?: number,
  ): Promise<RiscoEncerramento> {
    const agora = agoraMs ?? new Date(this.clock.agoraISO()).getTime();
    const divergencia = await this.divergencias.porLoteId(loteId, agora);
    if (!divergencia) throw new NotFoundError('Lote', loteId);
    const estatistica = await this.contatos.estatisticaLote(loteId, {
      agoraMs: agora,
      temPendencia: divergencia.pendenciaEfetiva > 0,
    });

    const nuncaCobrado =
      estatistica.nuncaCobrado && divergencia.pendenciaEfetiva > 0;
    const promessaVencida = estatistica.promessaVencida;
    const diasAtrasoPromessa = estatistica.diasAtrasoPromessa;
    const valorPendente = divergencia.valorPendente;
    const valorPendenteAlto = valorPendente >= REGRAS_DIVERGENCIA.VALOR_CRITICO_BRL;
    const diasDesdeEnvio = divergencia.diasDesdeEnvio;
    const pendenciaAntiga = diasDesdeEnvio >= REGRAS_DIVERGENCIA.DIAS_CRITICO;

    const motivos: string[] = [];
    if (nuncaCobrado) motivos.push('lote nunca cobrado da lavanderia');
    if (promessaVencida) {
      motivos.push(`promessa vencida há ${diasAtrasoPromessa ?? 0} dia(s)`);
    }
    if (valorPendenteAlto) {
      motivos.push(`valor pendente alto (R$ ${valorPendente.toFixed(2)})`);
    }
    if (pendenciaAntiga) {
      motivos.push(`pendência aberta há ${diasDesdeEnvio} dia(s)`);
    }

    return {
      temRisco: motivos.length > 0,
      nuncaCobrado,
      promessaVencida,
      diasAtrasoPromessa,
      valorPendenteAlto,
      valorPendente,
      pendenciaAntiga,
      diasDesdeEnvio,
      motivos,
    };
  }

  // Encerra um lote com pendência: registra UM ajuste por item pendente
  // (origem=lavanderia, destino=null) reduzindo o saldo da lavanderia,
  // e atualiza o cabeçalho do lote com data/motivo/responsável.
  //
  // Invariantes:
  //  - Não apaga nem altera movimentações anteriores. A baixa é SEMPRE
  //    um novo lançamento no log (tipo 'ajuste').
  //  - Se falhar no meio do registro dos ajustes, o lote continua aberto
  //    e os ajustes já registrados reduzem a pendência efetiva. Próxima
  //    tentativa baixa só o que ainda sobra — auto-convergente.
  //  - Rejeita lote já encerrado e lote sem pendência efetiva.
  async encerrarComPendencia(input: EncerrarLoteInput): Promise<void> {
    if (!(MOTIVOS_FECHAMENTO as readonly string[]).includes(input.motivo)) {
      throw new ValidationError('Motivo de encerramento inválido');
    }
    if (!input.responsavel?.trim()) {
      throw new ValidationError('Responsável é obrigatório');
    }
    const descricao = input.motivoDescricao?.trim() ?? '';
    if (input.motivo === 'outros' && !descricao) {
      throw new ValidationError('Descrição é obrigatória quando o motivo é "outros"');
    }
    // origemDivergencia é opcional aqui (caminho admin direto pode omitir),
    // mas se vier, tem que ser um valor válido — schema CHECK rejeitaria.
    if (
      input.origemDivergencia != null &&
      !(ORIGENS_DIVERGENCIA as readonly string[]).includes(input.origemDivergencia)
    ) {
      throw new ValidationError(
        `Origem da divergência inválida: "${input.origemDivergencia}".`,
      );
    }

    const lote = await this.lotes.porId(input.loteId);
    if (!lote) throw new NotFoundError('Lote', input.loteId);
    if (lote.encerradoEm) {
      throw new ValidationError('Lote já foi encerrado anteriormente');
    }

    const detalheAtual = await this.detalhe(input.loteId);
    if (!detalheAtual) throw new NotFoundError('Lote', input.loteId);
    const itensComPendencia = detalheAtual.itens.filter((i) => i.pendenciaEfetiva > 0);
    if (itensComPendencia.length === 0) {
      throw new ValidationError('Lote não possui pendência efetiva a baixar');
    }

    // Avaliação de risco: se há motivos fortes (nunca cobrado, promessa
    // vencida, valor alto, pendência antiga), exige confirmação explícita
    // do gestor. Valida no server — não confia no front.
    const risco = await this.avaliarRiscoEncerramento(input.loteId);
    if (risco.temRisco && !input.reconhecimentoRisco) {
      throw new ValidationError(
        `Encerramento exige confirmação de risco. Motivos: ${risco.motivos.join('; ')}.`,
      );
    }

    const agora = this.clock.agoraISO();
    // Enriquece a descrição quando houve ciência de risco — fica gravado
    // no cabeçalho do lote e na observação do ajuste para auditoria.
    const descFinal = risco.temRisco
      ? `${descricao ? descricao + ' ' : ''}[encerrado com ciência de risco: ${risco.motivos.join('; ')}]`
      : descricao || null;
    const observacaoAjuste = descFinal
      ? `Encerramento lote ${lote.codigo}: ${input.motivo} — ${descFinal}`
      : `Encerramento lote ${lote.codigo}: ${input.motivo}`;

    // Registra um ajuste por item pendente. Se algum falhar, os já
    // registrados ficam no log — o lote continua aberto, a pendência
    // efetiva foi reduzida, e uma nova chamada cobre o que resta.
    for (const linha of itensComPendencia) {
      await this.movService.registrar({
        itemId: linha.itemId,
        quantidade: linha.pendenciaEfetiva,
        tipo: 'ajuste',
        origemId: lote.destinoId, // lavanderia
        destinoId: null,
        responsavel: input.responsavel,
        dataHora: agora,
        loteId: input.loteId,
        observacao: observacaoAjuste,
      });
    }

    const loteAtualizado: Lote = {
      ...lote,
      encerradoEm: agora,
      encerradoPor: input.responsavel,
      motivoFechamento: input.motivo,
      motivoDescricao: descFinal,
      origemDivergencia: input.origemDivergencia ?? null,
    };
    await this.lotes.atualizar(loteAtualizado);
  }

  async detalhe(loteId: LoteId): Promise<LoteDetalhe | null> {
    const lote = await this.lotes.porId(loteId);
    if (!lote) return null;

    const [movs, todosItens, origem, destino] = await Promise.all([
      this.movimentacoes.listar({ loteId }),
      this.itens.listar(),
      this.locais.porId(lote.origemId),
      this.locais.porId(lote.destinoId),
    ]);

    const itensPorId = new Map(todosItens.map((i) => [i.id, i]));
    const itensDetalhe = this.projetarItens(movs, itensPorId);
    const totais = this.somarTotais(itensDetalhe);
    const status = this.calcularStatus(lote, itensDetalhe, totais.totalEnviado, totais.totalRetornado);

    return {
      lote,
      status,
      encerrado: lote.encerradoEm != null,
      totalEnviado: totais.totalEnviado,
      totalRetornado: totais.totalRetornado,
      totalAjustado: totais.totalAjustado,
      pendenciaTotal: totais.totalEnviado - totais.totalRetornado,
      pendenciaEfetiva: Math.max(0, totais.totalEnviado - totais.totalRetornado - totais.totalAjustado),
      possuiDivergencia: itensDetalhe.some((i) => i.totalRetornado > i.totalEnviado),
      itensDistintos: itensDetalhe.length,
      itens: itensDetalhe,
      origemNome: origem?.nome ?? lote.origemId,
      destinoNome: destino?.nome ?? lote.destinoId,
      movimentacoes: movs.slice().sort((a, b) => a.dataHora.localeCompare(b.dataHora)),
    };
  }

  async listar(filtro?: { apenasAbertos?: boolean }): Promise<LoteResumo[]> {
    const [lotes, todosMovs, todosItens] = await Promise.all([
      this.lotes.listar(),
      this.movimentacoes.listar(),
      this.itens.listar(),
    ]);

    const itensPorId = new Map(todosItens.map((i) => [i.id, i]));
    const movsPorLote = new Map<LoteId, Movimentacao[]>();
    for (const m of todosMovs) {
      if (!m.loteId) continue;
      const arr = movsPorLote.get(m.loteId);
      if (arr) arr.push(m);
      else movsPorLote.set(m.loteId, [m]);
    }

    const resumos: LoteResumo[] = lotes.map((lote) => {
      const movs = movsPorLote.get(lote.id) ?? [];
      const itensDetalhe = this.projetarItens(movs, itensPorId);
      const totais = this.somarTotais(itensDetalhe);
      const status = this.calcularStatus(lote, itensDetalhe, totais.totalEnviado, totais.totalRetornado);
      return {
        lote,
        status,
        encerrado: lote.encerradoEm != null,
        totalEnviado: totais.totalEnviado,
        totalRetornado: totais.totalRetornado,
        totalAjustado: totais.totalAjustado,
        pendenciaTotal: totais.totalEnviado - totais.totalRetornado,
        pendenciaEfetiva: Math.max(0, totais.totalEnviado - totais.totalRetornado - totais.totalAjustado),
        possuiDivergencia: itensDetalhe.some((i) => i.totalRetornado > i.totalEnviado),
        itensDistintos: itensDetalhe.length,
      };
    });

    resumos.sort((a, b) => b.lote.dataEnvio.localeCompare(a.lote.dataEnvio));

    if (filtro?.apenasAbertos) {
      // Lote encerrado sai do fluxo "aberto" — status derivado já não é
      // aberto/parcial/divergencia, mas filtramos explicitamente também.
      return resumos.filter(
        (r) =>
          !r.encerrado &&
          (r.status === 'aberto' || r.status === 'retorno_parcial' || r.status === 'com_divergencia'),
      );
    }
    return resumos;
  }

  private projetarItens(
    movs: readonly Movimentacao[],
    itensPorId: ReadonlyMap<ItemId, { nome: string; unidade: string }>,
  ): LoteItemDetalhe[] {
    const enviados = new Map<ItemId, number>();
    const retornados = new Map<ItemId, number>();
    const ajustados = new Map<ItemId, number>();

    for (const m of movs) {
      if (m.tipo === 'envio_lavanderia') {
        enviados.set(m.itemId, (enviados.get(m.itemId) ?? 0) + m.quantidade);
      } else if (m.tipo === 'retorno_lavanderia') {
        retornados.set(m.itemId, (retornados.get(m.itemId) ?? 0) + m.quantidade);
      } else if (m.tipo === 'ajuste') {
        // Ajustes vinculados ao lote representam baixa de pendência: a
        // quantidade é removida do saldo da lavanderia (origem=lavanderia,
        // destino=null). Acumulamos pelo itemId independente de polaridade.
        ajustados.set(m.itemId, (ajustados.get(m.itemId) ?? 0) + m.quantidade);
      }
    }

    const ids = new Set<ItemId>([
      ...enviados.keys(),
      ...retornados.keys(),
      ...ajustados.keys(),
    ]);
    const resultado: LoteItemDetalhe[] = [];
    for (const itemId of ids) {
      const meta = itensPorId.get(itemId);
      const te = enviados.get(itemId) ?? 0;
      const tr = retornados.get(itemId) ?? 0;
      const ta = ajustados.get(itemId) ?? 0;
      const pendencia = te - tr;
      resultado.push({
        itemId,
        nomeItem: meta?.nome ?? String(itemId),
        unidade: meta?.unidade ?? 'un',
        totalEnviado: te,
        totalRetornado: tr,
        pendencia,
        baixadoPorAjuste: ta,
        // Nunca negativa: se ajuste excede pendência (cenário patológico),
        // o restante é sinal de divergência, não de pendência remanescente.
        pendenciaEfetiva: Math.max(0, pendencia - ta),
      });
    }
    resultado.sort((a, b) => a.nomeItem.localeCompare(b.nomeItem, 'pt-BR'));
    return resultado;
  }

  private somarTotais(itens: readonly LoteItemDetalhe[]): {
    totalEnviado: number;
    totalRetornado: number;
    totalAjustado: number;
  } {
    let totalEnviado = 0;
    let totalRetornado = 0;
    let totalAjustado = 0;
    for (const i of itens) {
      totalEnviado += i.totalEnviado;
      totalRetornado += i.totalRetornado;
      totalAjustado += i.baixadoPorAjuste;
    }
    return { totalEnviado, totalRetornado, totalAjustado };
  }

  private calcularStatus(
    lote: Lote,
    itens: readonly LoteItemDetalhe[],
    totalEnviado: number,
    totalRetornado: number,
  ): LoteStatus {
    // Encerramento administrativo prevalece sobre derivação — registra a
    // decisão explícita do gestor. Um lote encerrado nunca volta a ser
    // "parcial" mesmo que novos movimentos aparecessem (não deveriam).
    if (lote.encerradoEm) return 'encerrado_com_pendencia';
    if (itens.some((i) => i.totalRetornado > i.totalEnviado)) return 'com_divergencia';
    if (totalEnviado === 0) return 'aberto';
    if (totalRetornado === 0) return 'aberto';
    if (totalEnviado === totalRetornado) return 'concluido';
    return 'retorno_parcial';
  }

  private async proximoCodigo(dataRef: string): Promise<string> {
    const ano = dataRef.slice(0, 4);
    const existentes = await this.lotes.listar();
    const mesmoAno = existentes.filter((l) => l.dataEnvio.startsWith(ano));
    const n = mesmoAno.length + 1;
    return `L-${ano}-${String(n).padStart(3, '0')}`;
  }
}
