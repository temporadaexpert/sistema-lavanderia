import type {
  ControleDiarioEnxoval,
  ControleDiarioStatus,
  LinhaEnviada,
  LinhaRetornada,
} from '@/domain/entities/ControleDiarioEnxoval';
import { ControleDiarioId, type ItemId } from '@/domain/types/ids';
import { NotFoundError, ValidationError } from '@/domain/errors/DomainErrors';
import type { ControleDiarioRepository } from '../ports/ControleDiarioRepository';
import type { ItemRepository } from '../ports/ItemRepository';
import type { Clock, IdGenerator } from './MovimentacaoService';

// Status "terminais" do dia — qualquer um deles impede novos lançamentos.
function estaFechado(status: ControleDiarioStatus): boolean {
  return status === 'fechado' || status === 'fechado_com_divergencia';
}

// Classificação por item no fechamento do dia:
//   - ok:         enviado == sujo + limpo
//   - faltando:   enviado >  sujo + limpo   (sumiu no caminho)
//   - excedente:  enviado <  sujo + limpo   (voltou mais — erro de contagem
//                  no envio ou mistura com outro dia)
// Alerta imediato para o gestor do depósito investigar no mesmo dia.
export type DivergenciaClasse = 'ok' | 'faltando' | 'excedente';

export interface LinhaDivergencia {
  readonly itemId: ItemId;
  readonly enviado: number;
  readonly recebidoSujo: number;
  readonly recebidoLimpo: number;
  readonly totalRetornado: number;
  readonly divergencia: number; // enviado - totalRetornado (positivo = falta)
  readonly classe: DivergenciaClasse;
}

export interface DivergenciaDiaria {
  readonly data: string;
  readonly linhas: readonly LinhaDivergencia[];
  readonly totalEnviado: number;
  readonly totalSujo: number;
  readonly totalLimpo: number;
  readonly totalRetornado: number;
  readonly totalFaltante: number;
  readonly totalExcedente: number;
  readonly temDivergencia: boolean;
  // True quando há envio mas o retorno ainda não foi registrado. Nesse
  // estado, NÃO há base pra calcular divergência: peças "faltantes"
  // seriam falso-positivo (retorno=0 sempre = envio inteiro como falta).
  // UI usa essa flag pra mostrar aviso neutro "Retorno ainda não
  // registrado" em vez do alerta vermelho.
  readonly aguardandoRetorno: boolean;
}

export interface ResumoDashboardControle {
  readonly dataReferencia: string; // dia mais recente com registro
  readonly totalEnviado: number;
  readonly totalRetornado: number;
  readonly totalLimpoReaproveitado: number;
  readonly totalFaltante: number;
  readonly temControleHoje: boolean;
  readonly temDivergenciaHoje: boolean;
}

// Linha do painel de divergências diárias (admin): agrega um dia fechado
// com divergência, com valor estimado usando o preço unitário atual do item.
export interface LinhaDivergenciaDiaria {
  readonly data: string;
  readonly status: ControleDiarioStatus;
  readonly totalFaltante: number;
  readonly totalExcedente: number;
  readonly valorEstimado: number; // R$ — soma dos faltantes × preço unitário atual
  readonly custoParcial: boolean; // true se algum item faltante não tem preço
  readonly itens: readonly {
    readonly itemId: ItemId;
    readonly nomeItem: string;
    readonly faltante: number;
    readonly excedente: number;
    readonly valorFaltante: number | null; // null = item sem preço
  }[];
  readonly responsavelFechamento: string | null;
  readonly motivoDivergencia: string | null;
  readonly fechadoEm: string | null;
}

export interface RegistrarEnvioInput {
  readonly data: string; // YYYY-MM-DD
  readonly responsavel: string;
  readonly itens: readonly LinhaEnviada[];
}

export interface RegistrarRetornoInput {
  readonly data: string; // YYYY-MM-DD
  readonly responsavel: string;
  readonly itens: readonly LinhaRetornada[];
  // Quando true, marca status='fechado' (sem diverge) ou
  // 'fechado_com_divergencia' (com diverge + motivo obrigatório).
  readonly fecharDia?: boolean;
  // Responsável pela decisão de FECHAR o dia. Quando ausente, o serviço
  // usa `responsavel`. Tipicamente diferente em cenário com divergência:
  // a funcionária conta o retorno, mas o gestor autoriza fechamento com perda.
  readonly responsavelFechamento?: string;
  // Obrigatório quando fecharDia=true E há divergência. Explicação do
  // que aconteceu (ex.: "1 toalha rasgou", "esqueceram no imóvel 302").
  readonly motivoDivergencia?: string;
}

// Aceita YYYY-MM-DD ou ISO datetime e normaliza para YYYY-MM-DD.
function normalizarData(data: string): string {
  const trim = data.trim();
  if (!trim) throw new ValidationError('Data é obrigatória');
  const ymd = trim.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || Number.isNaN(Date.parse(ymd))) {
    throw new ValidationError('Data inválida (esperado YYYY-MM-DD)');
  }
  return ymd;
}

// Linhas vindas do front podem ter quantidade=0 (usuário subiu e desceu
// o contador) — limpamos antes de gravar pra não poluir o registro.
function sanitizarEnvio(linhas: readonly LinhaEnviada[]): LinhaEnviada[] {
  const mapa = new Map<ItemId, number>();
  for (const l of linhas) {
    if (!Number.isInteger(l.quantidade) || l.quantidade < 0) {
      throw new ValidationError('Quantidade de envio deve ser inteiro ≥ 0');
    }
    if (l.quantidade === 0) continue;
    mapa.set(l.itemId, (mapa.get(l.itemId) ?? 0) + l.quantidade);
  }
  return Array.from(mapa, ([itemId, quantidade]) => ({ itemId, quantidade }));
}

function sanitizarRetorno(linhas: readonly LinhaRetornada[]): LinhaRetornada[] {
  const mapa = new Map<ItemId, { sujo: number; limpo: number }>();
  for (const l of linhas) {
    if (!Number.isInteger(l.recebidoSujo) || l.recebidoSujo < 0) {
      throw new ValidationError('Recebido sujo deve ser inteiro ≥ 0');
    }
    if (!Number.isInteger(l.recebidoLimpo) || l.recebidoLimpo < 0) {
      throw new ValidationError('Recebido limpo deve ser inteiro ≥ 0');
    }
    if (l.recebidoSujo === 0 && l.recebidoLimpo === 0) continue;
    const atual = mapa.get(l.itemId) ?? { sujo: 0, limpo: 0 };
    mapa.set(l.itemId, {
      sujo: atual.sujo + l.recebidoSujo,
      limpo: atual.limpo + l.recebidoLimpo,
    });
  }
  return Array.from(mapa, ([itemId, v]) => ({
    itemId,
    recebidoSujo: v.sujo,
    recebidoLimpo: v.limpo,
  }));
}

export class ControleDiarioService {
  constructor(
    private readonly repo: ControleDiarioRepository,
    private readonly itens: ItemRepository,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
  ) {}

  // Guard contra operação cruzada com dia anterior em aberto. Se houver
  // qualquer controle diário anterior com status='aberto' e conteúdo,
  // o operador precisa fechá-lo antes de começar (ou continuar) outro.
  // Mensagem inclui a data pra que a UI saiba pra onde navegar.
  private async garantirNenhumDiaAnteriorAberto(dataReferencia: string): Promise<void> {
    const abertos = await this.listarDiasAbertosAnteriores(dataReferencia);
    if (abertos.length === 0) return;
    const maisAntigo = abertos[0]!;
    const [ano, mes, dia] = maisAntigo.data.split('-');
    const formatada = `${dia}/${mes}/${ano}`;
    throw new ValidationError(
      `Existe um controle diário anterior em aberto. Feche o dia ${formatada} antes de iniciar novas movimentações.`,
    );
  }

  // Cria ou atualiza a parte "envio" do controle do dia. Idempotente:
  // chamar duas vezes sobrescreve o envio anterior (operador corrigiu a
  // contagem antes de ir pra rua). Não mexe no retorno já registrado.
  async registrarEnvio(input: RegistrarEnvioInput): Promise<ControleDiarioEnxoval> {
    const data = normalizarData(input.data);
    if (!input.responsavel?.trim()) {
      throw new ValidationError('Responsável é obrigatório');
    }
    await this.validarItens(input.itens.map((l) => l.itemId));
    // Bloqueio por regra de fluxo: dia anterior aberto impede operação
    // em qualquer dia posterior. Se o operador está justamente
    // registrando no dia pendente (input.data === data do aberto), o
    // filtro `c.data < ref` do helper devolve vazio — então essa chamada
    // sempre passa pro dia pendente.
    await this.garantirNenhumDiaAnteriorAberto(data);

    const itens = sanitizarEnvio(input.itens);
    const existente = await this.repo.porData(data);
    const agora = this.clock.agoraISO();

    if (existente && estaFechado(existente.status)) {
      throw new ValidationError('Dia já fechado — não é possível alterar o envio');
    }

    const controle: ControleDiarioEnxoval = existente
      ? {
          ...existente,
          enviado: itens,
          responsavelEnvio: input.responsavel.trim(),
        }
      : {
          id: ControleDiarioId(this.idGen.gerar()),
          data,
          enviado: itens,
          retorno: [],
          status: 'aberto',
          abertoEm: agora,
          fechadoEm: null,
          responsavelEnvio: input.responsavel.trim(),
          responsavelRetorno: null,
          responsavelFechamento: null,
          motivoDivergencia: null,
        };
    await this.repo.salvar(controle);
    return controle;
  }

  // Cria ou atualiza a parte "retorno". Se fecharDia=true, marca como
  // 'fechado' (mas só a partir de existir envio OU retorno — dia vazio
  // não é fechamento significativo).
  async registrarRetorno(input: RegistrarRetornoInput): Promise<ControleDiarioEnxoval> {
    const data = normalizarData(input.data);
    if (!input.responsavel?.trim()) {
      throw new ValidationError('Responsável é obrigatório');
    }
    await this.validarItens(
      input.itens.flatMap((l) => [l.itemId]),
    );
    // Mesmo guard do registrarEnvio: se há dia anterior aberto, o
    // operador precisa fechá-lo antes. Retorno do próprio dia pendente
    // (input.data === data do aberto) passa naturalmente porque o
    // helper filtra apenas `c.data < ref`.
    await this.garantirNenhumDiaAnteriorAberto(data);

    const retorno = sanitizarRetorno(input.itens);
    const existente = await this.repo.porData(data);
    const agora = this.clock.agoraISO();

    if (existente && estaFechado(existente.status)) {
      throw new ValidationError('Dia já fechado — não é possível alterar o retorno');
    }

    const base: ControleDiarioEnxoval = existente ?? {
      id: ControleDiarioId(this.idGen.gerar()),
      data,
      enviado: [],
      retorno: [],
      status: 'aberto',
      abertoEm: agora,
      fechadoEm: null,
      responsavelEnvio: null,
      responsavelRetorno: null,
      responsavelFechamento: null,
      motivoDivergencia: null,
    };

    const fechar = input.fecharDia === true;
    if (fechar && base.enviado.length === 0 && retorno.length === 0) {
      throw new ValidationError('Não é possível fechar um dia sem envio nem retorno');
    }

    // Quando fecha o dia, avalia se há divergência a partir do snapshot
    // (envio base do dia + retorno atual). Se há, exige motivo + responsável
    // do fechamento — o gestor precisa reconhecer explicitamente a perda.
    let novoStatus = base.status;
    let novoResponsavelFechamento = base.responsavelFechamento;
    let novoMotivoDivergencia = base.motivoDivergencia;

    if (fechar) {
      const snapshotFechamento: ControleDiarioEnxoval = { ...base, retorno };
      const divergencia = this.projetarDivergencia(snapshotFechamento);
      if (divergencia.temDivergencia) {
        const motivo = input.motivoDivergencia?.trim();
        if (!motivo) {
          throw new ValidationError(
            'Existem peças faltantes ou em excesso. Informe o motivo do fechamento.',
          );
        }
        const responsavelFechamento =
          input.responsavelFechamento?.trim() || input.responsavel.trim();
        novoStatus = 'fechado_com_divergencia';
        novoResponsavelFechamento = responsavelFechamento;
        novoMotivoDivergencia = motivo;
      } else {
        novoStatus = 'fechado';
        novoResponsavelFechamento =
          input.responsavelFechamento?.trim() || input.responsavel.trim();
        novoMotivoDivergencia = null;
      }
    }

    const atualizado: ControleDiarioEnxoval = {
      ...base,
      retorno,
      responsavelRetorno: input.responsavel.trim(),
      status: novoStatus,
      fechadoEm: fechar ? agora : base.fechadoEm,
      responsavelFechamento: novoResponsavelFechamento,
      motivoDivergencia: novoMotivoDivergencia,
    };
    await this.repo.salvar(atualizado);
    return atualizado;
  }

  async obterPorData(data: string): Promise<ControleDiarioEnxoval | null> {
    return this.repo.porData(normalizarData(data));
  }

  async listar(): Promise<ControleDiarioEnxoval[]> {
    const todos = await this.repo.listar();
    return todos.slice().sort((a, b) => b.data.localeCompare(a.data));
  }

  // Dias ESTRITAMENTE anteriores a `dataReferencia` (YYYY-MM-DD) que ainda
  // não foram fechados e têm conteúdo (envio e/ou retorno). Ordenados do
  // mais antigo para o mais recente — o primeiro é o que o operador
  // precisa fechar prioritariamente.
  //
  // "Aberto" aqui = status === 'aberto'. Os terminais
  // ('fechado', 'fechado_com_divergencia') não retornam.
  async listarDiasAbertosAnteriores(
    dataReferencia: string,
  ): Promise<ControleDiarioEnxoval[]> {
    const ref = normalizarData(dataReferencia);
    const todos = await this.repo.listar();
    return todos
      .filter((c) => c.data < ref)
      .filter((c) => c.status === 'aberto')
      .filter((c) => c.enviado.length > 0 || c.retorno.length > 0)
      .sort((a, b) => a.data.localeCompare(b.data));
  }

  // Projeção derivada: nunca é armazenada no registro (evita decalage
  // quando o envio/retorno é corrigido). Consumida pelas telas de resumo
  // e de alerta imediato.
  async calcularDivergencia(data: string): Promise<DivergenciaDiaria | null> {
    const controle = await this.obterPorData(data);
    if (!controle) return null;
    return this.projetarDivergencia(controle);
  }

  private projetarDivergencia(controle: ControleDiarioEnxoval): DivergenciaDiaria {
    // Estado "aguardando retorno": só tem envio. Antes esse estado
    // disparava falso-positivo (todo enviado virava "faltando" porque
    // retorno=0). Agora curto-circuitamos: divergência só faz sentido
    // depois que o operador disse o que voltou.
    const aguardandoRetorno =
      controle.enviado.length > 0 && controle.retorno.length === 0;
    if (aguardandoRetorno) {
      const totalEnviado = controle.enviado.reduce((s, e) => s + e.quantidade, 0);
      return {
        data: controle.data,
        linhas: [],
        totalEnviado,
        totalSujo: 0,
        totalLimpo: 0,
        totalRetornado: 0,
        totalFaltante: 0,
        totalExcedente: 0,
        temDivergencia: false,
        aguardandoRetorno: true,
      };
    }

    const porItem = new Map<
      ItemId,
      { enviado: number; sujo: number; limpo: number }
    >();
    for (const e of controle.enviado) {
      const atual = porItem.get(e.itemId) ?? { enviado: 0, sujo: 0, limpo: 0 };
      atual.enviado += e.quantidade;
      porItem.set(e.itemId, atual);
    }
    for (const r of controle.retorno) {
      const atual = porItem.get(r.itemId) ?? { enviado: 0, sujo: 0, limpo: 0 };
      atual.sujo += r.recebidoSujo;
      atual.limpo += r.recebidoLimpo;
      porItem.set(r.itemId, atual);
    }

    const linhas: LinhaDivergencia[] = [];
    let totalEnviado = 0;
    let totalSujo = 0;
    let totalLimpo = 0;
    let totalFaltante = 0;
    let totalExcedente = 0;
    for (const [itemId, v] of porItem) {
      const totalRetornado = v.sujo + v.limpo;
      const divergencia = v.enviado - totalRetornado;
      const classe: DivergenciaClasse =
        divergencia === 0 ? 'ok' : divergencia > 0 ? 'faltando' : 'excedente';
      if (classe === 'faltando') totalFaltante += divergencia;
      if (classe === 'excedente') totalExcedente += -divergencia;
      totalEnviado += v.enviado;
      totalSujo += v.sujo;
      totalLimpo += v.limpo;
      linhas.push({
        itemId,
        enviado: v.enviado,
        recebidoSujo: v.sujo,
        recebidoLimpo: v.limpo,
        totalRetornado,
        divergencia,
        classe,
      });
    }
    linhas.sort((a, b) => {
      // Faltantes e excedentes primeiro; depois por nome (itemId).
      const peso = (c: DivergenciaClasse) =>
        c === 'faltando' ? 0 : c === 'excedente' ? 1 : 2;
      const dif = peso(a.classe) - peso(b.classe);
      return dif !== 0 ? dif : a.itemId.localeCompare(b.itemId);
    });
    return {
      data: controle.data,
      linhas,
      totalEnviado,
      totalSujo,
      totalLimpo,
      totalRetornado: totalSujo + totalLimpo,
      totalFaltante,
      totalExcedente,
      temDivergencia: totalFaltante > 0 || totalExcedente > 0,
      aguardandoRetorno: false,
    };
  }

  // Resumo consumido pelo dashboard admin. Usa o dia mais recente com
  // registro (envio OU retorno). Hoje = data-base do clock em ISO curto.
  async resumoDashboard(): Promise<ResumoDashboardControle | null> {
    const todos = await this.repo.listar();
    if (todos.length === 0) return null;
    const ordenados = todos.slice().sort((a, b) => b.data.localeCompare(a.data));
    const maisRecente = ordenados[0]!;
    const hoje = this.clock.agoraISO().slice(0, 10);
    const divergencia = this.projetarDivergencia(maisRecente);
    return {
      dataReferencia: maisRecente.data,
      totalEnviado: divergencia.totalEnviado,
      totalRetornado: divergencia.totalRetornado,
      totalLimpoReaproveitado: divergencia.totalLimpo,
      totalFaltante: divergencia.totalFaltante,
      temControleHoje: maisRecente.data === hoje,
      temDivergenciaHoje:
        maisRecente.data === hoje && divergencia.temDivergencia,
    };
  }

  // Listagem para o painel admin de divergências diárias. Retorna todos os
  // dias com divergência (tanto status 'fechado_com_divergencia' quanto
  // dias abertos que já apresentam divergência projetada — útil para
  // acompanhar em tempo real). Inclui valor estimado calculado com o
  // preço unitário ATUAL do item; itens sem preço marcam custoParcial=true.
  async listarDivergencias(opts?: {
    apenasFechados?: boolean;
  }): Promise<LinhaDivergenciaDiaria[]> {
    const [todosControles, todosItens] = await Promise.all([
      this.repo.listar(),
      this.itens.listar(),
    ]);
    const itemPorId = new Map(todosItens.map((i) => [i.id, i]));

    const resultado: LinhaDivergenciaDiaria[] = [];
    for (const controle of todosControles) {
      const projetada = this.projetarDivergencia(controle);
      if (!projetada.temDivergencia) continue;
      if (opts?.apenasFechados && !estaFechado(controle.status)) continue;

      let valorEstimado = 0;
      let custoParcial = false;
      const itensDetalhe: LinhaDivergenciaDiaria['itens'][number][] = [];
      for (const linha of projetada.linhas) {
        if (linha.classe === 'ok') continue;
        const item = itemPorId.get(linha.itemId);
        const faltante = linha.classe === 'faltando' ? linha.divergencia : 0;
        const excedente = linha.classe === 'excedente' ? -linha.divergencia : 0;
        let valorFaltante: number | null = null;
        if (faltante > 0) {
          if (item?.valorUnitario != null) {
            valorFaltante = faltante * item.valorUnitario;
            valorEstimado += valorFaltante;
          } else {
            custoParcial = true;
          }
        }
        itensDetalhe.push({
          itemId: linha.itemId,
          nomeItem: item?.nome ?? String(linha.itemId),
          faltante,
          excedente,
          valorFaltante,
        });
      }

      resultado.push({
        data: controle.data,
        status: controle.status,
        totalFaltante: projetada.totalFaltante,
        totalExcedente: projetada.totalExcedente,
        valorEstimado,
        custoParcial,
        itens: itensDetalhe,
        responsavelFechamento: controle.responsavelFechamento,
        motivoDivergencia: controle.motivoDivergencia,
        fechadoEm: controle.fechadoEm,
      });
    }
    // Mais recentes primeiro
    return resultado.sort((a, b) => b.data.localeCompare(a.data));
  }

  // Preparo para integração com lavanderia: retorna só o sujo,
  // agrupado por item, pronto pra virar payload de envio de lote.
  // Não cria o lote aqui (UI dispara a ação explícita).
  async enxovalSujoParaLavanderia(
    data: string,
  ): Promise<readonly { itemId: ItemId; quantidade: number }[]> {
    const controle = await this.obterPorData(data);
    if (!controle) throw new NotFoundError('ControleDiario', data);
    const mapa = new Map<ItemId, number>();
    for (const r of controle.retorno) {
      if (r.recebidoSujo <= 0) continue;
      mapa.set(r.itemId, (mapa.get(r.itemId) ?? 0) + r.recebidoSujo);
    }
    return Array.from(mapa, ([itemId, quantidade]) => ({ itemId, quantidade }));
  }

  private async validarItens(ids: readonly ItemId[]): Promise<void> {
    const unicos = Array.from(new Set(ids));
    for (const id of unicos) {
      const item = await this.itens.porId(id);
      if (!item) throw new NotFoundError('Item', id);
    }
  }
}
