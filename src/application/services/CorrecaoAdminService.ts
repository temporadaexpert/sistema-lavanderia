import type {
  CorrecaoAdmin,
  TipoBlocoCorrecao,
} from '@/domain/entities/CorrecaoAdmin';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { ItemId, LocalId, LoteId, MovimentacaoId } from '@/domain/types/ids';
import {
  NotFoundError,
  ValidationError,
} from '@/domain/errors/DomainErrors';
import type {
  CorrecaoAdminFiltro,
  CorrecaoAdminRepository,
} from '../ports/CorrecaoAdminRepository';
import type { ItemRepository } from '../ports/ItemRepository';
import type { LoteRepository } from '../ports/LoteRepository';
import type { MovimentacaoRepository } from '../ports/MovimentacaoRepository';
import type {
  Clock,
  IdGenerator,
  MovimentacaoService,
} from './MovimentacaoService';
import type { LoteLavanderiaService } from './LoteLavanderiaService';

// Linha de correção dentro de uma operação multi-item (envio/retorno
// lavanderia). Caller passa N dessas; service decide individualmente
// se precisa cancelar+registrar.
export interface LinhaCorrecaoItem {
  readonly itemId: ItemId;
  readonly quantidadeNova: number;
}

export interface CorrigirEnvioLavanderiaInput {
  readonly loteId: LoteId;
  readonly itensCorrigidos: readonly LinhaCorrecaoItem[];
  readonly motivo: string;
  readonly adminResponsavel: string;
  // Confirmação consciente quando alguma diferença é "grande" (regra:
  // |diff| >= max(10, qtdAnterior * 0.3)). Sem isso o service rejeita e
  // a UI abre confirmação adicional.
  readonly confirmacaoCorrecaoGrande?: boolean;
}

export interface CorrigirRetornoLavanderiaInput {
  readonly operacaoId: string;
  readonly itensCorrigidos: readonly LinhaCorrecaoItem[];
  readonly motivo: string;
  readonly adminResponsavel: string;
  readonly confirmacaoCorrecaoGrande?: boolean;
}

export interface CorrigirMovimentacaoSimplesInput {
  readonly movId: MovimentacaoId;
  readonly quantidadeNova: number;
  readonly motivo: string;
  readonly adminResponsavel: string;
  readonly confirmacaoCorrecaoGrande?: boolean;
}

// Resultado de uma correção. Agregado por operação — `itensCorrigidos`
// reflete cada linha que efetivamente teve diferença.
export interface ResultadoCorrecao {
  readonly correcoesRegistradas: readonly CorrecaoAdmin[];
}

const MOTIVO_MIN_CHARS = 5;

// Orquestra correção administrativa dos 4 fluxos suportados. Estratégia
// uniforme: cancelar mov original (preserva log e snapshot de preço)
// + registrar mov nova com a quantidade correta, herdando contexto
// (loteId, origem/destino, snapshot_preco). Cada item corrigido vira
// uma linha em `correcoes_admin` com snapshot anterior/novo, motivo,
// admin e ids das movs envolvidas.
//
// O que NÃO faz:
//   - não cria mov de tipo 'ajuste' compensatória (quebraria totalEnviado
//     do lote);
//   - não usa UPDATE destrutivo na quantidade (movs são imutáveis);
//   - não recaptura preço atual (preserva contexto financeiro histórico);
//   - não permite editar lote ENCERRADO (admin que precisar disso usa
//     cancelarLoteDuplicado, fora desta tela).
export class CorrecaoAdminService {
  constructor(
    private readonly correcoes: CorrecaoAdminRepository,
    private readonly movs: MovimentacaoRepository,
    private readonly lotes: LoteRepository,
    private readonly itens: ItemRepository,
    private readonly movService: MovimentacaoService,
    private readonly loteLavanderia: LoteLavanderiaService,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
  ) {}

  // -------------------------------------------------------------------------
  // Fluxo 1: ENVIO PARA LAVANDERIA
  //
  // Cancela cada mov envio_lavanderia do lote para os itens listados e
  // registra novas movs com mesmo loteId/origem/destino, herdando o
  // snapshot_preco original. Lote header NÃO muda.
  // -------------------------------------------------------------------------
  async corrigirEnvioLavanderia(
    input: CorrigirEnvioLavanderiaInput,
  ): Promise<ResultadoCorrecao> {
    this.validarMotivoEResponsavel(input.motivo, input.adminResponsavel);

    const lote = await this.lotes.porId(input.loteId);
    if (!lote) throw new NotFoundError('Lote', input.loteId);
    if (lote.encerradoEm) {
      throw new ValidationError(
        'Lote já encerrado não pode ser corrigido por esta tela. ' +
          'Para reverter um lote encerrado, use a função de cancelamento por duplicação.',
      );
    }

    const movsLote = await this.movs.listar({ loteId: input.loteId });
    const enviosAtivos = movsLote.filter((m) => m.tipo === 'envio_lavanderia');

    const correcoes: CorrecaoAdmin[] = [];
    for (const linha of input.itensCorrigidos) {
      this.validarQuantidadeNova(linha.quantidadeNova);
      const movOriginal = enviosAtivos.find((m) => m.itemId === linha.itemId);
      if (!movOriginal) {
        throw new NotFoundError(
          `Movimentação envio_lavanderia (item ${linha.itemId}) no lote ${lote.codigo}`,
          String(linha.itemId),
        );
      }
      if (movOriginal.quantidade === linha.quantidadeNova) continue;
      this.validarCorrecaoGrande(
        movOriginal.quantidade,
        linha.quantidadeNova,
        input.confirmacaoCorrecaoGrande,
      );

      const correcao = await this.aplicarCancelarRegistrarItem({
        tipoBloco: 'envio_lavanderia',
        operacaoId: movOriginal.operacaoId,
        movOriginal,
        loteId: input.loteId,
        localId: null,
        quantidadeNova: linha.quantidadeNova,
        motivo: input.motivo,
        adminResponsavel: input.adminResponsavel,
        observacaoNova: movOriginal.observacao,
        contextoTexto: `lote ${lote.codigo}`,
      });
      correcoes.push(correcao);
    }

    return { correcoesRegistradas: correcoes };
  }

  // -------------------------------------------------------------------------
  // Fluxo 2: RETORNO DE LAVANDERIA (com cross-lote)
  //
  // Cancela TODAS as movs retorno_lavanderia da operação (atual + anteriores
  // + excedente não conciliado) e re-executa registrarRetornoEFinalizar com
  // as novas quantidades — re-aplica anomaly check, FIFO, excedente.
  // Pendências dos lotes anteriores são restauradas automaticamente pelo
  // cancelamento (movs canceladas saem da projeção). Os snapshots de
  // preço das movs novas DEVEM herdar dos cancelados — o LoteLavanderiaService
  // não tem esse caminho hoje, então passamos por uma re-execução manual.
  // -------------------------------------------------------------------------
  async corrigirRetornoLavanderia(
    input: CorrigirRetornoLavanderiaInput,
  ): Promise<ResultadoCorrecao> {
    this.validarMotivoEResponsavel(input.motivo, input.adminResponsavel);

    const movsOperacao = await this.movs.listar({ operacaoId: input.operacaoId });
    const retornosAtivos = movsOperacao.filter(
      (m) => m.tipo === 'retorno_lavanderia',
    );
    if (retornosAtivos.length === 0) {
      throw new NotFoundError('Operação de retorno', input.operacaoId);
    }

    // Identifica o lote "atual" da operação (loteId mais frequente entre
    // os retornos da operação que NÃO sejam excedente). Não dá pra usar
    // só o primeiro: a ordem de inserção pode ter o anterior antes do
    // atual em cenários de race.
    const contagemPorLote = new Map<string, number>();
    for (const m of retornosAtivos) {
      if (!m.loteId) continue;
      contagemPorLote.set(m.loteId, (contagemPorLote.get(m.loteId) ?? 0) + 1);
    }
    let loteAtualId: LoteId | null = null;
    let maiorContagem = 0;
    for (const [id, n] of contagemPorLote) {
      if (n > maiorContagem) {
        maiorContagem = n;
        loteAtualId = id as LoteId;
      }
    }
    // Fallback raro: operação só com excedente avulso. Não há lote
    // "atual" — admin deve corrigir via fluxo simples (mov a mov).
    if (!loteAtualId) {
      throw new ValidationError(
        'Operação de retorno sem lote-âncora identificável. Corrija mov a mov pelo fluxo simples.',
      );
    }

    const loteAtual = await this.lotes.porId(loteAtualId);
    if (!loteAtual) throw new NotFoundError('Lote', loteAtualId);
    if (loteAtual.encerradoEm) {
      throw new ValidationError(
        'Lote já encerrado não pode ser corrigido por esta tela.',
      );
    }

    // Quantidades originais SOMADAS por item (antes da correção). Inclui
    // current + anteriores + excedente — porque o que o operador devolveu
    // foi a soma; o split entre lotes era responsabilidade do sistema.
    const qtdOriginalPorItem = new Map<ItemId, number>();
    for (const m of retornosAtivos) {
      qtdOriginalPorItem.set(
        m.itemId,
        (qtdOriginalPorItem.get(m.itemId) ?? 0) + m.quantidade,
      );
    }

    // Valida itens propostos. Bloqueia correções zeradas (sem mudança).
    let algumaMudanca = false;
    for (const linha of input.itensCorrigidos) {
      this.validarQuantidadeNova(linha.quantidadeNova);
      const original = qtdOriginalPorItem.get(linha.itemId) ?? 0;
      if (original !== linha.quantidadeNova) {
        algumaMudanca = true;
        this.validarCorrecaoGrande(
          original,
          linha.quantidadeNova,
          input.confirmacaoCorrecaoGrande,
        );
      }
    }
    if (!algumaMudanca) {
      throw new ValidationError(
        'Nenhuma quantidade nova diverge da original. Nada a corrigir.',
      );
    }

    // Snapshot de preço por item — o que vamos herdar nas movs novas.
    // Tomamos o snapshot da PRIMEIRA mov ativa do item na operação;
    // todas deveriam ter o mesmo preço de qualquer forma (mesma data
    // de registro, mesmo item).
    const snapshotPorItem = new Map<ItemId, number | null>();
    for (const m of retornosAtivos) {
      if (!snapshotPorItem.has(m.itemId)) {
        snapshotPorItem.set(m.itemId, m.precoUnitarioSnapshot);
      }
    }

    // Cancela TODAS as movs ativas da operação. Inclui retornos pra
    // anteriores (restaurando pendência) e excedente não conciliado.
    const agora = this.clock.agoraISO();
    const motivoCancel = `Correção administrativa de retorno (operação ${input.operacaoId}): ${input.motivo}`;
    const movsCanceladasIds: MovimentacaoId[] = [];
    for (const m of retornosAtivos) {
      await this.movs.marcarCancelada(m.id, {
        canceladoEm: agora,
        canceladoPor: input.adminResponsavel,
        motivoCancelamento: motivoCancel,
      });
      movsCanceladasIds.push(m.id);
    }

    // Re-executa registrarRetornoEFinalizar com a NOVA quantidade total.
    // O caller (operacao_id) é mantido pra que a operação corrigida
    // continue identificável como uma única coisa pelo sistema. Mas:
    // como o snapshot de preço é por mov (não por operação), passamos
    // o caminho "manual" de gravação por aqui pra herdar o snapshot do
    // original em vez do preço atual.
    //
    // O fluxo do registrarRetornoEFinalizar não aceita override de
    // snapshot — então reproduzimos o algoritmo essencial dele aqui:
    // confiar na re-execução pra distribuir é o ideal, mas isso
    // recapturaria preço atual. Solução: usar movService.registrar
    // diretamente pra cada item, com loteId=loteAtual e snapshot
    // herdado. Isso simplifica: apenas o lote atual recebe a nova mov;
    // se houver excedente vs anteriores, fica como excedente avulso
    // (operacao_id mantido).
    //
    // Trade-off conhecido: a correção de retorno NÃO refaz a redistribuição
    // FIFO cross-lote. Em vez disso, devolve tudo pro lote atual.
    // Justificativa: re-distribuir teria que invalidar/restaurar
    // múltiplos lotes anteriores em transação — operação muito mais
    // complexa. A admin tem visibilidade pra também corrigir retornos
    // dos anteriores se necessário (lista por operacao_id).
    const itemNomePorId = new Map<ItemId, string>();
    for (const m of retornosAtivos) {
      if (!itemNomePorId.has(m.itemId)) {
        const it = await this.itens.porId(m.itemId);
        itemNomePorId.set(m.itemId, it?.nome ?? String(m.itemId));
      }
    }

    const movsNovasPorItem = new Map<ItemId, MovimentacaoId>();
    for (const linha of input.itensCorrigidos) {
      const original = qtdOriginalPorItem.get(linha.itemId) ?? 0;
      if (original === linha.quantidadeNova) continue;
      if (linha.quantidadeNova === 0) continue; // quantidade nova zero = sem nova mov

      const snapshot = snapshotPorItem.get(linha.itemId) ?? null;
      const movNova = await this.movService.registrar({
        itemId: linha.itemId,
        quantidade: linha.quantidadeNova,
        tipo: 'retorno_lavanderia',
        origemId: loteAtual.destinoId, // lavanderia
        destinoId: loteAtual.origemId, // depósito
        responsavel: input.adminResponsavel,
        dataHora: agora,
        loteId: loteAtual.id,
        observacao:
          `[Correção admin] Retorno corrigido (operação ${input.operacaoId}, lote ${loteAtual.codigo}): ` +
          `${original} → ${linha.quantidadeNova}. Motivo: ${input.motivo}`,
        conciliado: true,
        operacaoId: input.operacaoId,
        precoUnitarioSnapshotOverride: snapshot,
      });
      movsNovasPorItem.set(linha.itemId, movNova.id);
    }

    // Registra UMA linha de correção por item alterado.
    const correcoes: CorrecaoAdmin[] = [];
    for (const linha of input.itensCorrigidos) {
      const original = qtdOriginalPorItem.get(linha.itemId) ?? 0;
      if (original === linha.quantidadeNova) continue;
      const correcao = this.criarCorrecao({
        tipoBloco: 'retorno_lavanderia',
        operacaoId: input.operacaoId,
        itemId: linha.itemId,
        nomeItem: itemNomePorId.get(linha.itemId) ?? String(linha.itemId),
        loteId: loteAtual.id,
        localId: null,
        quantidadeAnterior: original,
        quantidadeNova: linha.quantidadeNova,
        motivo: input.motivo,
        adminResponsavel: input.adminResponsavel,
        movsCanceladasIds,
        movsNovasIds: movsNovasPorItem.has(linha.itemId)
          ? [movsNovasPorItem.get(linha.itemId)!]
          : [],
        observacaoAutomatica:
          `Correção retorno_lavanderia operação=${input.operacaoId} ` +
          `lote=${loteAtual.codigo} item=${itemNomePorId.get(linha.itemId)} ` +
          `${original}→${linha.quantidadeNova}. ` +
          `Movs canceladas: ${movsCanceladasIds.length}. ` +
          `Movs novas: ${movsNovasPorItem.has(linha.itemId) ? 1 : 0}.`,
      });
      await this.correcoes.registrar(correcao);
      correcoes.push(correcao);
    }
    return { correcoesRegistradas: correcoes };
  }

  // -------------------------------------------------------------------------
  // Fluxos 3/4: SAÍDA / RETORNO DE IMÓVEL (1 mov = 1 operação)
  //
  // Caminho mais simples: cancela a mov original e registra uma nova com
  // mesmos campos + nova quantidade.
  // -------------------------------------------------------------------------
  async corrigirMovimentacaoSimples(
    input: CorrigirMovimentacaoSimplesInput,
  ): Promise<ResultadoCorrecao> {
    this.validarMotivoEResponsavel(input.motivo, input.adminResponsavel);
    this.validarQuantidadeNova(input.quantidadeNova);

    const movOriginal = await this.movs.porId(input.movId);
    if (!movOriginal) throw new NotFoundError('Movimentação', input.movId);
    if (movOriginal.cancelada) {
      throw new ValidationError('Movimentação já cancelada — não há o que corrigir.');
    }
    if (
      movOriginal.tipo !== 'saida_imovel' &&
      movOriginal.tipo !== 'retorno_imovel'
    ) {
      throw new ValidationError(
        `Esta tela corrige apenas saída/retorno de imóvel. Tipo recebido: ${movOriginal.tipo}.`,
      );
    }
    if (movOriginal.quantidade === input.quantidadeNova) {
      throw new ValidationError('Quantidade nova é igual à original. Nada a corrigir.');
    }
    this.validarCorrecaoGrande(
      movOriginal.quantidade,
      input.quantidadeNova,
      input.confirmacaoCorrecaoGrande,
    );

    const item = await this.itens.porId(movOriginal.itemId);
    const correcao = await this.aplicarCancelarRegistrarItem({
      tipoBloco: movOriginal.tipo,
      operacaoId: movOriginal.operacaoId,
      movOriginal,
      loteId: null,
      // Para imóvel, o "local" relevante é a origem (saida_imovel sai
      // do depósito → destinoId é o imóvel; retorno_imovel sai do imóvel
      // → origemId é o imóvel). Pegamos o local de tipo imóvel.
      localId:
        movOriginal.tipo === 'saida_imovel'
          ? movOriginal.destinoId
          : movOriginal.origemId,
      quantidadeNova: input.quantidadeNova,
      motivo: input.motivo,
      adminResponsavel: input.adminResponsavel,
      observacaoNova: movOriginal.observacao,
      contextoTexto: `mov ${movOriginal.id}`,
      nomeItemOverride: item?.nome,
    });
    return { correcoesRegistradas: [correcao] };
  }

  // -------------------------------------------------------------------------
  // LISTAGEM (relatório §L)
  // -------------------------------------------------------------------------
  async listarCorrecoes(filtro?: CorrecaoAdminFiltro): Promise<CorrecaoAdmin[]> {
    return this.correcoes.listar(filtro);
  }

  // =========================================================================
  // Helpers privados
  // =========================================================================

  private validarMotivoEResponsavel(motivo: string, adminResponsavel: string): void {
    if (!motivo || motivo.trim().length < MOTIVO_MIN_CHARS) {
      throw new ValidationError(
        `Motivo da correção é obrigatório (mínimo ${MOTIVO_MIN_CHARS} caracteres).`,
      );
    }
    if (!adminResponsavel?.trim()) {
      throw new ValidationError('Admin responsável é obrigatório.');
    }
  }

  private validarQuantidadeNova(qtd: number): void {
    if (!Number.isInteger(qtd)) {
      throw new ValidationError('Quantidade nova deve ser um inteiro.');
    }
    if (qtd < 0) {
      throw new ValidationError('Quantidade nova não pode ser negativa.');
    }
  }

  // Regra "correção grande" combinada: |diff| >= max(10, qtdAnterior * 0.3).
  // Cobre tanto erro absoluto pequeno (pendência baixa) quanto percentual
  // grande (pendência alta). Mesma forma usada em RetornoAnormalDetectadoError.
  private validarCorrecaoGrande(
    anterior: number,
    nova: number,
    confirmou: boolean | undefined,
  ): void {
    const diff = Math.abs(nova - anterior);
    const limite = Math.max(10, Math.floor(anterior * 0.3));
    if (diff >= limite && !confirmou) {
      throw new ValidationError(
        `Diferença grande (${diff} unidade(s), limite ${limite}). Confirme explicitamente.`,
      );
    }
  }

  // Cancela a mov original (campos de auditoria preenchidos) e registra
  // uma nova com mesmos atributos exceto quantidade. Snapshot de preço
  // herda do original — chave pra preservação financeira histórica.
  private async aplicarCancelarRegistrarItem(args: {
    tipoBloco: TipoBlocoCorrecao;
    operacaoId: string | null;
    movOriginal: Movimentacao;
    loteId: LoteId | null;
    localId: LocalId | null;
    quantidadeNova: number;
    motivo: string;
    adminResponsavel: string;
    observacaoNova: string | null;
    contextoTexto: string;
    nomeItemOverride?: string;
  }): Promise<CorrecaoAdmin> {
    const agora = this.clock.agoraISO();
    const motivoCancel =
      `Correção administrativa (${args.tipoBloco}) em ${args.contextoTexto}: ${args.motivo}`;

    // 1. Cancela original
    await this.movs.marcarCancelada(args.movOriginal.id, {
      canceladoEm: agora,
      canceladoPor: args.adminResponsavel,
      motivoCancelamento: motivoCancel,
    });

    // 2. Registra nova com mesmos atributos + nova quantidade. Quando
    //    nova quantidade é 0, NÃO registra mov nova (efeito = só cancelar).
    let movNovaId: MovimentacaoId | null = null;
    if (args.quantidadeNova > 0) {
      const novaObs =
        `[Correção admin] ${args.movOriginal.quantidade} → ${args.quantidadeNova}. ` +
        `Motivo: ${args.motivo}` +
        (args.observacaoNova ? `. Obs original: ${args.observacaoNova}` : '');
      const movNova = await this.movService.registrar({
        itemId: args.movOriginal.itemId,
        quantidade: args.quantidadeNova,
        tipo: args.movOriginal.tipo,
        origemId: args.movOriginal.origemId,
        destinoId: args.movOriginal.destinoId,
        responsavel: args.adminResponsavel,
        dataHora: args.movOriginal.dataHora,
        loteId: args.movOriginal.loteId,
        observacao: novaObs,
        conciliado: args.movOriginal.conciliado,
        operacaoId: args.movOriginal.operacaoId,
        // Herança CRÍTICA do snapshot — preserva impostômetro/custo histórico.
        precoUnitarioSnapshotOverride: args.movOriginal.precoUnitarioSnapshot,
      });
      movNovaId = movNova.id;
    }

    // 3. Cria entrada de auditoria
    const item =
      args.nomeItemOverride ??
      (await this.itens.porId(args.movOriginal.itemId))?.nome ??
      String(args.movOriginal.itemId);
    const correcao = this.criarCorrecao({
      tipoBloco: args.tipoBloco,
      operacaoId: args.operacaoId,
      itemId: args.movOriginal.itemId,
      nomeItem: item,
      loteId: args.loteId,
      localId: args.localId,
      quantidadeAnterior: args.movOriginal.quantidade,
      quantidadeNova: args.quantidadeNova,
      motivo: args.motivo,
      adminResponsavel: args.adminResponsavel,
      movsCanceladasIds: [args.movOriginal.id],
      movsNovasIds: movNovaId ? [movNovaId] : [],
      observacaoAutomatica:
        `Correção ${args.tipoBloco} em ${args.contextoTexto}: ` +
        `${args.movOriginal.quantidade}→${args.quantidadeNova}.` +
        (movNovaId ? ' Mov nova registrada com snapshot herdado.' : ' Sem mov nova (qtd nova = 0).'),
    });
    await this.correcoes.registrar(correcao);
    return correcao;
  }

  private criarCorrecao(args: {
    tipoBloco: TipoBlocoCorrecao;
    operacaoId: string | null;
    itemId: ItemId;
    nomeItem: string;
    loteId: LoteId | null;
    localId: LocalId | null;
    quantidadeAnterior: number;
    quantidadeNova: number;
    motivo: string;
    adminResponsavel: string;
    movsCanceladasIds: readonly MovimentacaoId[];
    movsNovasIds: readonly MovimentacaoId[];
    observacaoAutomatica: string | null;
  }): CorrecaoAdmin {
    return {
      id: this.idGen.gerar(),
      tipoBloco: args.tipoBloco,
      operacaoId: args.operacaoId,
      itemId: args.itemId,
      nomeItemSnapshot: args.nomeItem,
      loteId: args.loteId,
      localId: args.localId,
      quantidadeAnterior: args.quantidadeAnterior,
      quantidadeNova: args.quantidadeNova,
      diferenca: args.quantidadeNova - args.quantidadeAnterior,
      motivo: args.motivo.trim(),
      adminResponsavel: args.adminResponsavel.trim(),
      corrigidoEm: this.clock.agoraISO(),
      movsCanceladasIds: args.movsCanceladasIds.slice(),
      movsNovasIds: args.movsNovasIds.slice(),
      observacaoAutomatica: args.observacaoAutomatica,
    };
  }
}
