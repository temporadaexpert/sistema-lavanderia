import type { Item } from '@/domain/entities/Item';
import type { Lote } from '@/domain/entities/Lote';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { ItemId, LoteId } from '@/domain/types/ids';
import { REGRAS_DIVERGENCIA } from '@/domain/rules/divergenciaRules';
import type { ItemRepository } from '../ports/ItemRepository';
import type { LoteRepository } from '../ports/LoteRepository';
import type { MovimentacaoRepository } from '../ports/MovimentacaoRepository';

export type PrioridadeDivergencia =
  | 'ok'
  | 'aguardando'
  | 'atencao'
  | 'critica'
  | 'excesso'
  | 'encerrado_baixado';

export type RecomendacaoAcao =
  | 'nenhuma'
  | 'aguardar_retorno'
  | 'cobrar_lavanderia'
  | 'encerrar_com_baixa'
  | 'verificar_lancamento';

export interface DivergenciaItem {
  readonly itemId: ItemId;
  readonly nomeItem: string;
  readonly enviado: number;
  readonly retornado: number;
  readonly baixado: number;
  readonly pendenciaEfetiva: number;
  readonly excesso: number; // retornado − enviado quando > 0
  readonly precoEfetivo: number | null;
  readonly valorPendente: number | null;
}

export interface DivergenciaLote {
  readonly lote: Lote;
  readonly prioridade: PrioridadeDivergencia;
  readonly recomendacao: RecomendacaoAcao;
  readonly diasDesdeEnvio: number;
  readonly pendenciaEfetiva: number;
  readonly excessoTotal: number;
  readonly valorPendente: number;
  readonly custoParcial: boolean;
  readonly itens: readonly DivergenciaItem[];
}

export interface ResumoDivergencias {
  readonly criticas: number;
  readonly atencao: number;
  readonly aguardando: number;
  readonly excesso: number;
  readonly encerradosBaixados: number;
  readonly valorPendenteTotal: number;
  readonly pendenciaTotalPecas: number;
  readonly custoParcial: boolean;
  readonly maiorPendenteItem: {
    readonly itemId: ItemId;
    readonly nomeItem: string;
    readonly pecas: number;
  } | null;
  readonly loteMaisAntigo: {
    readonly loteId: LoteId;
    readonly codigo: string;
    readonly diasDesdeEnvio: number;
  } | null;
}

// Ordem numérica usada para ordenação desc (maior número = prioridade maior).
const PRIORIDADE_PESO: Record<PrioridadeDivergencia, number> = {
  critica: 5,
  excesso: 4,
  atencao: 3,
  aguardando: 2,
  encerrado_baixado: 1,
  ok: 0,
};

// Camada de inteligência operacional sobre lotes: classifica cada lote por
// prioridade, calcula valor pendente (snapshot → atual → null) e recomenda
// ação para o gestor. Não muta nada — é pura projeção sobre o log de movs
// + metadados do Lote. Mesmo invariante do SaldoService.
export class DivergenciaService {
  constructor(
    private readonly lotes: LoteRepository,
    private readonly itens: ItemRepository,
    private readonly movs: MovimentacaoRepository,
  ) {}

  async listar(agoraMs: number = Date.now()): Promise<DivergenciaLote[]> {
    const [todosLotes, todasMovs, todosItens] = await Promise.all([
      this.lotes.listar(),
      this.movs.listar(),
      this.itens.listar(),
    ]);
    const itemPorId = new Map(todosItens.map((i) => [i.id, i]));

    const movsPorLote = new Map<LoteId, Movimentacao[]>();
    for (const m of todasMovs) {
      if (!m.loteId) continue;
      const arr = movsPorLote.get(m.loteId);
      if (arr) arr.push(m);
      else movsPorLote.set(m.loteId, [m]);
    }

    const divergencias: DivergenciaLote[] = [];
    for (const lote of todosLotes) {
      const movs = movsPorLote.get(lote.id) ?? [];
      const itens = this.projetarItens(movs, itemPorId);
      const diag = this.classificar(lote, itens, agoraMs);
      divergencias.push({ lote, ...diag, itens });
    }

    // Prioridade desc, depois mais antigas primeiro.
    divergencias.sort((a, b) => {
      const delta = PRIORIDADE_PESO[b.prioridade] - PRIORIDADE_PESO[a.prioridade];
      if (delta !== 0) return delta;
      return b.diasDesdeEnvio - a.diasDesdeEnvio;
    });

    return divergencias;
  }

  async porLoteId(loteId: LoteId, agoraMs: number = Date.now()): Promise<DivergenciaLote | null> {
    const lote = await this.lotes.porId(loteId);
    if (!lote) return null;
    const [movs, todosItens] = await Promise.all([
      this.movs.listar({ loteId }),
      this.itens.listar(),
    ]);
    const itemPorId = new Map(todosItens.map((i) => [i.id, i]));
    const itens = this.projetarItens(movs, itemPorId);
    const diag = this.classificar(lote, itens, agoraMs);
    return { lote, ...diag, itens };
  }

  async resumoAlertas(agoraMs: number = Date.now()): Promise<ResumoDivergencias> {
    const divergencias = await this.listar(agoraMs);

    let criticas = 0,
      atencao = 0,
      aguardando = 0,
      excesso = 0,
      encerradosBaixados = 0;
    let valorPendenteTotal = 0;
    let pendenciaTotalPecas = 0;
    let custoParcial = false;
    let loteMaisAntigo: ResumoDivergencias['loteMaisAntigo'] = null;
    const pendentePorItem = new Map<ItemId, { nome: string; pecas: number }>();

    for (const d of divergencias) {
      if (d.prioridade === 'critica') criticas++;
      else if (d.prioridade === 'atencao') atencao++;
      else if (d.prioridade === 'aguardando') aguardando++;
      else if (d.prioridade === 'excesso') excesso++;
      else if (d.prioridade === 'encerrado_baixado') encerradosBaixados++;

      const ativo =
        d.prioridade === 'critica' ||
        d.prioridade === 'atencao' ||
        d.prioridade === 'aguardando' ||
        d.prioridade === 'excesso';

      if (ativo) {
        valorPendenteTotal += d.valorPendente;
        pendenciaTotalPecas += d.pendenciaEfetiva;
        if (d.custoParcial) custoParcial = true;
        for (const i of d.itens) {
          if (i.pendenciaEfetiva > 0) {
            const atual = pendentePorItem.get(i.itemId) ?? { nome: i.nomeItem, pecas: 0 };
            pendentePorItem.set(i.itemId, {
              nome: atual.nome,
              pecas: atual.pecas + i.pendenciaEfetiva,
            });
          }
        }
        if (!loteMaisAntigo || d.diasDesdeEnvio > loteMaisAntigo.diasDesdeEnvio) {
          loteMaisAntigo = {
            loteId: d.lote.id,
            codigo: d.lote.codigo,
            diasDesdeEnvio: d.diasDesdeEnvio,
          };
        }
      }
    }

    let maiorPendenteItem: ResumoDivergencias['maiorPendenteItem'] = null;
    for (const [itemId, info] of pendentePorItem) {
      if (!maiorPendenteItem || info.pecas > maiorPendenteItem.pecas) {
        maiorPendenteItem = { itemId, nomeItem: info.nome, pecas: info.pecas };
      }
    }

    return {
      criticas,
      atencao,
      aguardando,
      excesso,
      encerradosBaixados,
      valorPendenteTotal,
      pendenciaTotalPecas,
      custoParcial,
      maiorPendenteItem,
      loteMaisAntigo,
    };
  }

  // Preço efetivo por item = primeiro snapshot visto nos envios, com
  // fallback para o preço atual do cadastro. Simples e estável na
  // maioria dos casos reais (lote tem 1 envio por item). Quando houver
  // múltiplos envios do mesmo item com preços diferentes, o primeiro
  // vira referência — limitação aceitável para o propósito (conservador).
  private projetarItens(
    movs: readonly Movimentacao[],
    itemPorId: ReadonlyMap<ItemId, Item>,
  ): DivergenciaItem[] {
    const enviados = new Map<ItemId, number>();
    const retornados = new Map<ItemId, number>();
    const ajustados = new Map<ItemId, number>();
    const primeiroSnapshot = new Map<ItemId, number>();

    for (const m of movs) {
      if (m.tipo === 'envio_lavanderia') {
        enviados.set(m.itemId, (enviados.get(m.itemId) ?? 0) + m.quantidade);
        if (m.precoUnitarioSnapshot != null && !primeiroSnapshot.has(m.itemId)) {
          primeiroSnapshot.set(m.itemId, m.precoUnitarioSnapshot);
        }
      } else if (m.tipo === 'retorno_lavanderia') {
        retornados.set(m.itemId, (retornados.get(m.itemId) ?? 0) + m.quantidade);
      } else if (m.tipo === 'ajuste') {
        ajustados.set(m.itemId, (ajustados.get(m.itemId) ?? 0) + m.quantidade);
      }
    }

    const ids = new Set<ItemId>([
      ...enviados.keys(),
      ...retornados.keys(),
      ...ajustados.keys(),
    ]);
    const resultado: DivergenciaItem[] = [];
    for (const itemId of ids) {
      const item = itemPorId.get(itemId);
      const te = enviados.get(itemId) ?? 0;
      const tr = retornados.get(itemId) ?? 0;
      const ta = ajustados.get(itemId) ?? 0;
      const pendenciaEfetiva = Math.max(0, te - tr - ta);
      const excesso = Math.max(0, tr - te);
      const precoEfetivo = primeiroSnapshot.get(itemId) ?? item?.valorUnitario ?? null;
      const valorPendente =
        precoEfetivo != null && pendenciaEfetiva > 0 ? pendenciaEfetiva * precoEfetivo : null;

      resultado.push({
        itemId,
        nomeItem: item?.nome ?? String(itemId),
        enviado: te,
        retornado: tr,
        baixado: ta,
        pendenciaEfetiva,
        excesso,
        precoEfetivo,
        valorPendente,
      });
    }
    resultado.sort((a, b) => a.nomeItem.localeCompare(b.nomeItem, 'pt-BR'));
    return resultado;
  }

  private classificar(
    lote: Lote,
    itens: readonly DivergenciaItem[],
    agoraMs: number,
  ): {
    prioridade: PrioridadeDivergencia;
    recomendacao: RecomendacaoAcao;
    diasDesdeEnvio: number;
    pendenciaEfetiva: number;
    excessoTotal: number;
    valorPendente: number;
    custoParcial: boolean;
  } {
    const pendenciaEfetiva = itens.reduce((s, i) => s + i.pendenciaEfetiva, 0);
    const excessoTotal = itens.reduce((s, i) => s + i.excesso, 0);

    let valorPendente = 0;
    let custoParcial = false;
    for (const i of itens) {
      if (i.pendenciaEfetiva === 0) continue;
      if (i.valorPendente != null) valorPendente += i.valorPendente;
      else custoParcial = true;
    }

    const dataEnvioMs = new Date(lote.dataEnvio).getTime();
    const diasDesdeEnvio = Math.max(
      0,
      Math.floor((agoraMs - dataEnvioMs) / (1000 * 60 * 60 * 24)),
    );

    // Ordem de decisão importa: encerrado domina (decisão admin tomada),
    // depois excesso (anomalia de dados), depois ok (sem pendência).
    // Só então o gradiente por tempo/valor.
    if (lote.encerradoEm != null) {
      return {
        prioridade: 'encerrado_baixado',
        recomendacao: 'nenhuma',
        diasDesdeEnvio,
        pendenciaEfetiva,
        excessoTotal,
        valorPendente,
        custoParcial,
      };
    }
    if (excessoTotal > 0) {
      return {
        prioridade: 'excesso',
        recomendacao: 'verificar_lancamento',
        diasDesdeEnvio,
        pendenciaEfetiva,
        excessoTotal,
        valorPendente,
        custoParcial,
      };
    }
    if (pendenciaEfetiva === 0) {
      return {
        prioridade: 'ok',
        recomendacao: 'nenhuma',
        diasDesdeEnvio,
        pendenciaEfetiva,
        excessoTotal,
        valorPendente,
        custoParcial,
      };
    }

    const { DIAS_ATENCAO, DIAS_CRITICO, VALOR_ATENCAO_BRL, VALOR_CRITICO_BRL } =
      REGRAS_DIVERGENCIA;

    if (diasDesdeEnvio >= DIAS_CRITICO) {
      return {
        prioridade: 'critica',
        recomendacao: 'encerrar_com_baixa',
        diasDesdeEnvio,
        pendenciaEfetiva,
        excessoTotal,
        valorPendente,
        custoParcial,
      };
    }
    if (valorPendente >= VALOR_CRITICO_BRL) {
      return {
        prioridade: 'critica',
        recomendacao: 'cobrar_lavanderia',
        diasDesdeEnvio,
        pendenciaEfetiva,
        excessoTotal,
        valorPendente,
        custoParcial,
      };
    }
    if (diasDesdeEnvio >= DIAS_ATENCAO || valorPendente >= VALOR_ATENCAO_BRL) {
      return {
        prioridade: 'atencao',
        recomendacao: 'cobrar_lavanderia',
        diasDesdeEnvio,
        pendenciaEfetiva,
        excessoTotal,
        valorPendente,
        custoParcial,
      };
    }
    return {
      prioridade: 'aguardando',
      recomendacao: 'aguardar_retorno',
      diasDesdeEnvio,
      pendenciaEfetiva,
      excessoTotal,
      valorPendente,
      custoParcial,
    };
  }
}
