import type { Lote } from '@/domain/entities/Lote';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { ItemId, LocalId, LoteId } from '@/domain/types/ids';
import { LoteId as LoteIdCtor } from '@/domain/types/ids';
import {
  MOTIVOS_FECHAMENTO,
  type LoteStatus,
  type MotivoFechamento,
} from '@/domain/types/enums';
import { NotFoundError, ValidationError } from '@/domain/errors/DomainErrors';
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
