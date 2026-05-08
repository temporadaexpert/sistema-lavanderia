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
  type LinhaRetornoAnormal,
  NotFoundError,
  RetornoAnormalDetectadoError,
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
  // Confirmação explícita de que o operador conferiu o número anormalmente
  // alto. Sem isso, o service recusa um proposto acima do limite
  // (ver RetornoAnormalDetectadoError) — bloqueia erro de digitação tipo
  // "250" em vez de "25". UI re-submete com true após o operador confirmar
  // no modal âmbar.
  readonly confirmacaoAnormalidade?: boolean;
}

// Alocação de uma fatia do retorno em um destino contábil (lote específico
// ou retorno avulso). Operador devolve N peças → o service descobre como
// distribuir entre o lote escolhido, lotes anteriores ainda pendentes do
// MESMO item, e o canal "excedente" (loteId=null) quando sobrar.
export interface AlocacaoRetorno {
  readonly loteId: LoteId | null;
  readonly loteCodigo: string | null; // null quando excedente avulso
  readonly quantidade: number;
}

// Distribuição calculada para um item dentro do retorno. Carrega o
// resumo numérico (quitado/abatido/excedente) que a UI usa no aviso e
// a lista crua de alocações que viraram movs gravadas.
export interface DistribuicaoItemRetorno {
  readonly itemId: ItemId;
  readonly nomeItem: string;
  readonly quantidadeRetornada: number;
  readonly quitadoLoteAtual: number;
  readonly abatidoEmAnteriores: number;
  readonly excedente: number;
  readonly alocacoes: readonly AlocacaoRetorno[];
}

export interface ResultadoRetornoFinalizado {
  readonly status: 'registrado_sem_pendencia' | 'registrado_parcial' | 'concluido_com_divergencia';
  readonly pendenciaResidual: number;
  readonly fechado: boolean;
  // Quebra de para-onde-foi cada peça retornada — carrega a história
  // legível pra UI montar o aviso "X quitaram este envio, Y compensaram
  // pendência anterior do lote L-..., Z entraram como excedente operacional".
  readonly distribuicao: readonly DistribuicaoItemRetorno[];
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

    // Soma efetiva proposta. Vazio (tudo zero) é tratado como "não há
    // retorno a registrar" — bloqueia. A camada de action já filtra qtd<=0,
    // mas defendemos no service também (chamadas diretas em testes/outros).
    const totalProposto = Array.from(propostaPorItem.values()).reduce(
      (s, n) => s + n,
      0,
    );
    if (totalProposto <= 0) {
      throw new ValidationError(
        'Informe a quantidade retornada de pelo menos 1 item (valor maior que zero).',
      );
    }

    // Itens "conhecidos" do lote atual (com envio prévio) — base do cálculo
    // de quitação. Itens propostos que NÃO existem neste lote ainda têm que
    // ser distribuídos (ou via lotes anteriores, ou como excedente).
    const pendenciaPorItemAtual = new Map<ItemId, number>();
    const nomePorItem = new Map<ItemId, string>();
    for (const it of detalheAtual.itens) {
      pendenciaPorItemAtual.set(it.itemId, it.pendenciaEfetiva);
      nomePorItem.set(it.itemId, it.nomeItem);
    }

    // Pendência aberta nos lotes ANTERIORES por item — usada (a) pelo
    // alocador FIFO, (b) pelo detector de anomalia (para somar com a
    // pendência atual e formar a "pendenciaTotal" usada na regra). Lemos
    // uma vez antes do loop de itens e reaproveitamos.
    const pendenciaAnteriorPorItem = await this.somarPendenciaAnterioresPorItem(
      input.loteId,
    );

    // Detector de anomalia (regra absoluta+percentual): proposto >
    // pendenciaTotal + max(10, pendenciaTotal * 0.3). A regra absoluta
    // (10) cobre escalas pequenas (pendência 2 → limite 12, 4 passa); a
    // percentual cobre escalas grandes (pendência 100 → limite 130, 200
    // dispara). Apenas linhas que CRUZAM o limite viram anomalia.
    const anomalias: LinhaRetornoAnormal[] = [];
    for (const [itemId, qtd] of propostaPorItem) {
      if (qtd <= 0) continue;
      const pendAtual = pendenciaPorItemAtual.get(itemId) ?? 0;
      const pendAnt = pendenciaAnteriorPorItem.get(itemId) ?? 0;
      const pendenciaTotal = pendAtual + pendAnt;
      const limite = pendenciaTotal + Math.max(10, Math.floor(pendenciaTotal * 0.3));
      if (qtd > limite) {
        let nomeItem = nomePorItem.get(itemId);
        if (!nomeItem) {
          const meta = await this.itens.porId(itemId);
          nomeItem = meta?.nome ?? String(itemId);
        }
        anomalias.push({
          itemId,
          nomeItem,
          proposto: qtd,
          pendenciaTotal,
          limiteAceitavel: limite,
          excedenteProjetado: qtd - pendenciaTotal,
        });
      }
    }
    if (anomalias.length > 0 && !input.confirmacaoAnormalidade) {
      throw new RetornoAnormalDetectadoError(anomalias);
    }

    // Distribui cada item proposto entre: (1) lote atual, (2) lotes
    // anteriores AINDA abertos com pendência do mesmo item (FIFO por
    // dataEnvio), (3) excedente avulso (loteId=null). O movService valida
    // saldo de lavanderia no momento de gravar — se fisicamente não couber,
    // a falha cai com EstoqueInsuficienteError com mensagem amigável.
    const distribuicao: DistribuicaoItemRetorno[] = [];
    for (const [itemId, qtd] of propostaPorItem) {
      if (qtd <= 0) continue;
      const pendenciaAtual = pendenciaPorItemAtual.get(itemId) ?? 0;
      const alocacoes = await this.planejarDistribuicaoItem(
        itemId,
        qtd,
        input.loteId,
        detalheAtual.lote.codigo,
        pendenciaAtual,
      );
      const quitadoLoteAtual = Math.min(qtd, pendenciaAtual);
      let abatidoEmAnteriores = 0;
      let excedente = 0;
      for (const a of alocacoes) {
        if (a.loteId == null) excedente += a.quantidade;
        else if (a.loteId !== input.loteId) abatidoEmAnteriores += a.quantidade;
      }
      // Se o item nem aparece no lote atual, "quitadoLoteAtual" fica 0
      // mas o alocador já mandou tudo pra anteriores/excedente. Resolve
      // o nome via repositório de itens só quando precisar (não está em
      // detalheAtual.itens).
      let nomeItem = nomePorItem.get(itemId);
      if (!nomeItem) {
        const meta = await this.itens.porId(itemId);
        nomeItem = meta?.nome ?? String(itemId);
      }
      distribuicao.push({
        itemId,
        nomeItem,
        quantidadeRetornada: qtd,
        quitadoLoteAtual,
        abatidoEmAnteriores,
        excedente,
        alocacoes,
      });
    }

    // Linhas com pendência residual (após propor) APENAS no lote atual.
    // Excesso vai pra anteriores/excedente sem virar divergência aqui.
    const divergenciasResiduais: LinhaDivergencia[] = [];
    for (const item of detalheAtual.itens) {
      const proposto = propostaPorItem.get(item.itemId) ?? 0;
      const aplicadoNoAtual = Math.min(proposto, item.pendenciaEfetiva);
      const residual = item.pendenciaEfetiva - aplicadoNoAtual;
      if (residual > 0) {
        divergenciasResiduais.push({
          itemId: item.itemId,
          nomeItem: item.nomeItem,
          enviado: item.totalEnviado,
          retornado: item.totalRetornado + aplicadoNoAtual,
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

    // Caminho 1: grava as movs conforme a distribuição calculada. Cada
    // alocação vira um retorno_lavanderia separado, com loteId apontando
    // pro lote-destino contábil (ou null pra excedente avulso). O
    // movService aplica saldo lavanderia em sequência — se sobra física
    // não cobrir, falha amigável.
    //
    // Concorrência: re-lemos a pendência do lote-anterior IMEDIATAMENTE
    // antes de gravar cada alocação. Se outro recebimento concorrente
    // quitou aquela pendência entre o pré-cálculo e este ponto, a sobra
    // dessa alocação é redirecionada pra excedente (não conciliado) em
    // vez de duplicar a baixa.
    //
    // ATENÇÃO TÉCNICA: esse re-read REDUZ o risco mas NÃO substitui
    // transação real ou advisory lock — uma race entre o re-read e o
    // movService.registrar ainda existe (janela menor, mas existe). Se
    // futuramente houver concorrência relevante, a forma correta é mover
    // este caminho pra uma RPC do Postgres com BEGIN/COMMIT (ou advisory
    // lock por (item_id, lote_id)) — ver MovimentacaoRepository.
    const dataRetorno = input.dataRetorno ?? this.clock.agoraISO();
    for (const item of distribuicao) {
      // `excedenteAdicional` capta a sobra que VEIO de uma alocação anterior
      // que perdeu pendência entre pré-cálculo e gravação. Vai virar uma
      // mov extra com loteId=null e conciliado=false ao final do item.
      let excedenteAdicional = 0;
      for (const alocacao of item.alocacoes) {
        if (alocacao.quantidade <= 0) continue;

        let qtdAGravar = alocacao.quantidade;
        let loteAlvo = alocacao.loteId;
        let codigoAlvo = alocacao.loteCodigo;

        // Re-leitura defensiva apenas para alocações em lote ANTERIOR
        // (não pro atual — esse já foi lido nesta requisição; e não pro
        // excedente — não tem pendência a checar).
        if (loteAlvo != null && loteAlvo !== input.loteId) {
          const detAnt = await this.detalhe(loteAlvo);
          if (detAnt) {
            const linhaAnt = detAnt.itens.find((i) => i.itemId === item.itemId);
            const pendAtualAnt = linhaAnt?.pendenciaEfetiva ?? 0;
            if (pendAtualAnt < qtdAGravar) {
              const sobra = qtdAGravar - pendAtualAnt;
              qtdAGravar = pendAtualAnt;
              excedenteAdicional += sobra;
            }
          }
        }

        if (qtdAGravar > 0) {
          const obs =
            loteAlvo == null
              ? `Retorno avulso (excedente operacional não conciliado) — recebimento de ${detalheAtual.lote.codigo}` +
                (input.observacao?.trim() ? ` — obs: ${input.observacao.trim()}` : '')
              : loteAlvo !== input.loteId
                ? `Retorno aplicado a pendência anterior do lote ${codigoAlvo ?? loteAlvo} (recebido junto a ${detalheAtual.lote.codigo})`
                : (input.observacao ?? null);
          await this.movService.registrar({
            itemId: item.itemId,
            quantidade: qtdAGravar,
            tipo: 'retorno_lavanderia',
            origemId: detalheAtual.lote.destinoId,
            destinoId: detalheAtual.lote.origemId,
            responsavel: input.responsavel,
            dataHora: dataRetorno,
            loteId: loteAlvo,
            observacao: obs,
            // Apenas o canal excedente (loteId=null) é não conciliado.
            conciliado: loteAlvo != null,
          });
        }
      }

      // Sobra acumulada por race nas alocações anteriores → vira excedente
      // adicional (não conciliado), com a mesma rastreabilidade.
      if (excedenteAdicional > 0) {
        const obs =
          `Retorno avulso (excedente operacional não conciliado, redistribuído por race) — recebimento de ${detalheAtual.lote.codigo}` +
          (input.observacao?.trim() ? ` — obs: ${input.observacao.trim()}` : '');
        await this.movService.registrar({
          itemId: item.itemId,
          quantidade: excedenteAdicional,
          tipo: 'retorno_lavanderia',
          origemId: detalheAtual.lote.destinoId,
          destinoId: detalheAtual.lote.origemId,
          responsavel: input.responsavel,
          dataHora: dataRetorno,
          loteId: null,
          observacao: obs,
          conciliado: false,
        });
      }

      // Reflete o ajuste por race na própria estrutura `distribuicao` que
      // a UI consome — caso contrário o banner falaria "0 excedente"
      // mesmo tendo gerado uma mov não conciliada.
      const excedenteFinal = item.excedente + excedenteAdicional;
      const abatidoFinal = item.abatidoEmAnteriores - excedenteAdicional;
      (item as {
        excedente: number;
        abatidoEmAnteriores: number;
      }).excedente = excedenteFinal;
      (item as {
        excedente: number;
        abatidoEmAnteriores: number;
      }).abatidoEmAnteriores = abatidoFinal < 0 ? 0 : abatidoFinal;

      // Log estruturado para auditoria nos primeiros dias após deploy.
      // Aparece em Logs → Functions da Vercel — admin consegue grep por
      // "EXCEDENTE_OPERACIONAL_NAO_CONCILIADO" e revisar todos os casos
      // sem precisar consultar o banco.
      if (excedenteFinal > 0) {
        const pendAtualLog = pendenciaPorItemAtual.get(item.itemId) ?? 0;
        const pendAntLog = pendenciaAnteriorPorItem.get(item.itemId) ?? 0;
        console.warn('EXCEDENTE_OPERACIONAL_NAO_CONCILIADO', {
          tag: 'EXCEDENTE_OPERACIONAL_NAO_CONCILIADO',
          itemId: item.itemId,
          nomeItem: item.nomeItem,
          quantidadeRetornada: item.quantidadeRetornada,
          quitadoLoteAtual: item.quitadoLoteAtual,
          abatidoEmAnteriores: item.abatidoEmAnteriores,
          excedenteNaoConciliado: excedenteFinal,
          pendenciaTotalEncontrada: pendAtualLog + pendAntLog,
          responsavel: input.responsavel,
          loteAtualId: input.loteId,
          loteAtualCodigo: detalheAtual.lote.codigo,
          observacaoOperador: input.observacao ?? null,
          timestamp: dataRetorno,
        });
      }
    }

    // Caminho 2: sem divergência ou retorno parcial → não fecha. Done.
    if (!haDivergencia) {
      return {
        status: 'registrado_sem_pendencia',
        pendenciaResidual: 0,
        fechado: false,
        distribuicao,
      };
    }
    if (input.classificacao === 'retorno_parcial') {
      return {
        status: 'registrado_parcial',
        pendenciaResidual: divergenciasResiduais.reduce((s, l) => s + l.diferenca, 0),
        fechado: false,
        distribuicao,
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
      distribuicao,
    };
  }

  // Soma a pendência efetiva por item considerando TODOS os lotes abertos
  // (exceto o lote atual), agrupando por itemId. Usado pelo detector de
  // anomalia pra estabelecer o "limite aceitável" do retorno proposto e
  // pelo planejador FIFO. Lê uma vez antes do loop pra evitar O(N²).
  private async somarPendenciaAnterioresPorItem(
    loteAtualId: LoteId,
  ): Promise<Map<ItemId, number>> {
    const acc = new Map<ItemId, number>();
    const abertos = await this.listar({ apenasAbertos: true });
    const candidatos = abertos.filter(
      (r) => r.lote.id !== loteAtualId && !r.encerrado,
    );
    for (const cand of candidatos) {
      const det = await this.detalhe(cand.lote.id);
      if (!det) continue;
      for (const linha of det.itens) {
        if (linha.pendenciaEfetiva <= 0) continue;
        acc.set(
          linha.itemId,
          (acc.get(linha.itemId) ?? 0) + linha.pendenciaEfetiva,
        );
      }
    }
    return acc;
  }

  // Calcula a distribuição de uma quantidade retornada de UM item entre:
  //   1. Lote atual (até a pendência efetiva dele)
  //   2. Lotes ainda abertos com pendência do mesmo item (FIFO por dataEnvio)
  //   3. Excedente avulso (loteId=null) — só sobra quando não há mais
  //      pendência aberta em qualquer lote
  //
  // Retorna o array ordenado de alocações. Apenas alocações com
  // quantidade>0 entram no resultado. O caller é responsável por traduzir
  // cada alocação em uma movimentação (retorno_lavanderia).
  private async planejarDistribuicaoItem(
    itemId: ItemId,
    qtdTotal: number,
    loteAtualId: LoteId,
    loteAtualCodigo: string,
    pendenciaEfetivaAtual: number,
  ): Promise<AlocacaoRetorno[]> {
    if (qtdTotal <= 0) return [];
    const alocacoes: AlocacaoRetorno[] = [];
    let restante = qtdTotal;

    const noAtual = Math.min(restante, Math.max(0, pendenciaEfetivaAtual));
    if (noAtual > 0) {
      alocacoes.push({
        loteId: loteAtualId,
        loteCodigo: loteAtualCodigo,
        quantidade: noAtual,
      });
      restante -= noAtual;
    }

    if (restante <= 0) return alocacoes;

    // Coleta lotes anteriores AINDA abertos (não encerrados) com pendência
    // do mesmo item. FIFO por dataEnvio resolve "sobra mais antiga primeiro" —
    // pareando com a intuição contábil de quitar dívida mais velha primeiro.
    const abertos = await this.listar({ apenasAbertos: true });
    const candidatos = abertos
      .filter((r) => r.lote.id !== loteAtualId && !r.encerrado)
      .slice()
      .sort((a, b) => a.lote.dataEnvio.localeCompare(b.lote.dataEnvio));

    for (const candidato of candidatos) {
      if (restante <= 0) break;
      const det = await this.detalhe(candidato.lote.id);
      if (!det) continue;
      const linha = det.itens.find((i) => i.itemId === itemId);
      if (!linha || linha.pendenciaEfetiva <= 0) continue;
      const aAlocar = Math.min(restante, linha.pendenciaEfetiva);
      alocacoes.push({
        loteId: candidato.lote.id,
        loteCodigo: candidato.lote.codigo,
        quantidade: aAlocar,
      });
      restante -= aAlocar;
    }

    if (restante > 0) {
      alocacoes.push({
        loteId: null,
        loteCodigo: null,
        quantidade: restante,
      });
    }
    return alocacoes;
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

  // Cancelamento de lote por DUPLICAÇÃO ou erro grave de registro.
  // Semanticamente diferente de `encerrarComPendencia`:
  //
  //   encerrarComPendencia  → "lote real, mas algumas peças não voltaram"
  //                            cria ajustes (baixa saldo) + conta como perda
  //
  //   cancelarLoteDuplicado → "este lote nunca deveria ter sido criado"
  //                            cancela TODAS as movs do lote + NÃO conta
  //                            como perda (RelatorioPerdaService filtra)
  //
  // Funciona em qualquer estado do lote:
  //   - Aberto: cancela só os envio_lavanderia
  //   - Encerrado anteriormente como perda: cancela envios E ajustes que
  //     o encerrarComPendencia havia criado — reverte completamente o
  //     impacto contábil
  //
  // Após o cancelamento, o lote some de TODOS os agregados (peças hoje,
  // valor hoje, saldo de lavanderia, perdas), porque `marcarCancelada`
  // remove a mov de toda projeção que filtra por incluirCanceladas=false
  // (default).
  async cancelarLoteDuplicado(input: {
    loteId: LoteId;
    motivo: string;
    responsavel: string;
  }): Promise<void> {
    if (!input.motivo?.trim()) {
      throw new ValidationError(
        'Motivo do cancelamento é obrigatório (ex.: "duplicação do lote L-002").',
      );
    }
    if (!input.responsavel?.trim()) {
      throw new ValidationError('Responsável é obrigatório');
    }

    const lote = await this.lotes.porId(input.loteId);
    if (!lote) throw new NotFoundError('Lote', input.loteId);

    // Idempotência: se já foi cancelado como duplicado, no-op silencioso.
    if (lote.motivoFechamento === 'duplicado') return;

    const agora = this.clock.agoraISO();
    const motivoTrim = input.motivo.trim();
    const responsavelTrim = input.responsavel.trim();

    // Cancela TODAS as movs ativas vinculadas ao lote — envios e
    // eventuais ajustes criados por encerrarComPendencia anterior.
    // `marcarCancelada` é idempotente por mov (rejeita se já cancelada),
    // então filtramos por não-canceladas pra evitar throw indesejado.
    const movs = await this.movimentacoes.listar({
      loteId: input.loteId,
      incluirCanceladas: false,
    });
    const observacaoCancelamento = `Lote cancelado (duplicado): ${motivoTrim}`;
    for (const mov of movs) {
      await this.movimentacoes.marcarCancelada(mov.id, {
        canceladoEm: agora,
        canceladoPor: responsavelTrim,
        motivoCancelamento: observacaoCancelamento,
      });
    }

    // Atualiza header com motivo='duplicado'. Funciona se o lote já
    // estava encerrado (substitui o motivo anterior, ex.: 'erro_operacional')
    // ou se estava aberto (preenche encerradoEm pela primeira vez).
    // CHECK lotes_encerramento_consistente é satisfeito (3 campos preenchidos).
    const loteAtualizado: Lote = {
      ...lote,
      encerradoEm: lote.encerradoEm ?? agora,
      encerradoPor: responsavelTrim,
      motivoFechamento: 'duplicado',
      motivoDescricao: motivoTrim,
      // Origem da divergência não se aplica a duplicação — limpa pra
      // não confundir relatórios futuros que cruzem por origem.
      origemDivergencia: null,
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
