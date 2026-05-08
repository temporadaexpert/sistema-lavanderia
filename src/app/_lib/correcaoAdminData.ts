import { getContainer } from '@/infrastructure/singleton';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { Lote } from '@/domain/entities/Lote';
import type { ItemId, LoteId, MovimentacaoId } from '@/domain/types/ids';
import type { CorrecaoAdmin } from '@/domain/entities/CorrecaoAdmin';

// Janela diária em horário São Paulo. Recebe `ymd` (YYYY-MM-DD); devolve
// limites ISO inclusivos cobrindo o dia inteiro em SP. Replica o padrão
// usado em outros módulos pra evitar drift de timezone na UI.
export function janelaDiariaSP(ymd: string): { desde: string; ate: string } {
  // Meia-noite SP é 03:00 UTC (sem horário de verão). Pra robustez,
  // usamos o início e fim do dia em UTC com offset -03 (SP padrão).
  return {
    desde: `${ymd}T03:00:00.000Z`,
    ate: `${ymd}T26:59:59.999Z`,
  };
}

export interface ItemEnvioParaCorrecao {
  readonly itemId: string;
  readonly nomeItem: string;
  readonly quantidade: number;
  readonly movId: string;
}

export interface OperacaoEnvioLote {
  readonly operacaoId: string | null;
  readonly loteId: string;
  readonly loteCodigo: string;
  readonly dataEnvio: string;
  readonly responsavel: string;
  readonly encerrado: boolean;
  readonly itens: readonly ItemEnvioParaCorrecao[];
}

export interface ItemRetornoParaCorrecao {
  readonly itemId: string;
  readonly nomeItem: string;
  readonly quantidadeTotal: number;
  // Quebra por destino contábil — só informativa para a UI ("25 atual + 2 anterior")
  readonly quebraPorLote: ReadonlyArray<{
    readonly loteId: string | null;
    readonly loteCodigo: string | null;
    readonly quantidade: number;
    readonly conciliado: boolean;
  }>;
}

export interface OperacaoRetornoLote {
  readonly operacaoId: string;
  readonly loteAtualId: string | null;
  readonly loteAtualCodigo: string | null;
  readonly dataRetorno: string;
  readonly responsavel: string;
  readonly itens: readonly ItemRetornoParaCorrecao[];
}

export interface MovImovelParaCorrecao {
  readonly movId: string;
  readonly tipo: 'saida_imovel' | 'retorno_imovel';
  readonly dataHora: string;
  readonly responsavel: string;
  readonly itemId: string;
  readonly nomeItem: string;
  readonly quantidade: number;
  readonly imovelId: string;
  readonly imovelNome: string;
}

export interface DadosCorrecaoAdmin {
  readonly enviosLavanderia: readonly OperacaoEnvioLote[];
  readonly retornosLavanderia: readonly OperacaoRetornoLote[];
  readonly movsImovel: readonly MovImovelParaCorrecao[];
  readonly historicoCorrecoes: readonly CorrecaoAdmin[];
}

// Carrega os 4 conjuntos de operações editáveis pelo admin para uma data
// específica + histórico das últimas correções. Tudo paralelo.
export async function carregarDadosCorrecao(ymd: string): Promise<DadosCorrecaoAdmin> {
  const c = await getContainer();
  const { desde, ate } = janelaDiariaSP(ymd);

  const [envios, retornos, saidas, retornosImovel, lotes, itens, locais, historico] =
    await Promise.all([
      c.movimentacoes.listar({
        tipo: 'envio_lavanderia',
        desdeDataHora: desde,
        ateDataHora: ate,
      }),
      c.movimentacoes.listar({
        tipo: 'retorno_lavanderia',
        desdeDataHora: desde,
        ateDataHora: ate,
      }),
      c.movimentacoes.listar({
        tipo: 'saida_imovel',
        desdeDataHora: desde,
        ateDataHora: ate,
      }),
      c.movimentacoes.listar({
        tipo: 'retorno_imovel',
        desdeDataHora: desde,
        ateDataHora: ate,
      }),
      c.lotes.listar(),
      c.itens.listar(),
      c.locais.listar(),
      c.correcaoAdmin.listarCorrecoes({ desde, ate }),
    ]);

  const lotesPorId = new Map<string, Lote>(lotes.map((l) => [l.id, l]));
  const nomeItem = new Map<string, string>(itens.map((i) => [i.id, i.nome]));
  const nomeLocal = new Map<string, string>(locais.map((l) => [l.id, l.nome]));

  const enviosLavanderia = agruparEnvioPorLote(envios, lotesPorId, nomeItem);
  const retornosLavanderia = agruparRetornoPorOperacao(
    retornos,
    lotesPorId,
    nomeItem,
  );
  const movsImovel = mapearMovsImovel([...saidas, ...retornosImovel], nomeItem, nomeLocal);

  return {
    enviosLavanderia,
    retornosLavanderia,
    movsImovel,
    historicoCorrecoes: historico,
  };
}

function agruparEnvioPorLote(
  movs: readonly Movimentacao[],
  lotes: ReadonlyMap<string, Lote>,
  nomeItem: ReadonlyMap<string, string>,
): OperacaoEnvioLote[] {
  const porLote = new Map<string, Movimentacao[]>();
  for (const m of movs) {
    if (!m.loteId) continue;
    const arr = porLote.get(m.loteId);
    if (arr) arr.push(m);
    else porLote.set(m.loteId, [m]);
  }
  const resultado: OperacaoEnvioLote[] = [];
  for (const [loteId, list] of porLote) {
    const lote = lotes.get(loteId);
    if (!lote) continue;
    resultado.push({
      operacaoId: list[0]?.operacaoId ?? null,
      loteId,
      loteCodigo: lote.codigo,
      dataEnvio: lote.dataEnvio,
      responsavel: lote.responsavel,
      encerrado: lote.encerradoEm != null,
      itens: list.map((m) => ({
        itemId: m.itemId,
        nomeItem: nomeItem.get(m.itemId) ?? String(m.itemId),
        quantidade: m.quantidade,
        movId: m.id,
      })),
    });
  }
  resultado.sort((a, b) => b.dataEnvio.localeCompare(a.dataEnvio));
  return resultado;
}

function agruparRetornoPorOperacao(
  movs: readonly Movimentacao[],
  lotes: ReadonlyMap<string, Lote>,
  nomeItem: ReadonlyMap<string, string>,
): OperacaoRetornoLote[] {
  const porOperacao = new Map<string, Movimentacao[]>();
  for (const m of movs) {
    // Movs antigas (pré-0006) sem operacao_id ficam fora desta listagem;
    // admin pode corrigi-las pelo fluxo "mov simples" como cancela/registrar.
    // Aqui só agrupamos as que têm correlação clara.
    if (!m.operacaoId) continue;
    const arr = porOperacao.get(m.operacaoId);
    if (arr) arr.push(m);
    else porOperacao.set(m.operacaoId, [m]);
  }
  const resultado: OperacaoRetornoLote[] = [];
  for (const [operacaoId, list] of porOperacao) {
    // Lote "atual" da operação = loteId mais frequente entre as movs
    // não-excedente. Mesmo critério do CorrecaoAdminService.
    const cont = new Map<string, number>();
    for (const m of list) {
      if (!m.loteId) continue;
      cont.set(m.loteId, (cont.get(m.loteId) ?? 0) + 1);
    }
    let loteAtualId: string | null = null;
    let max = 0;
    for (const [id, n] of cont) {
      if (n > max) {
        max = n;
        loteAtualId = id;
      }
    }
    const loteAtual = loteAtualId ? lotes.get(loteAtualId) : null;

    // Agrega por item
    const porItem = new Map<string, Movimentacao[]>();
    for (const m of list) {
      const arr = porItem.get(m.itemId);
      if (arr) arr.push(m);
      else porItem.set(m.itemId, [m]);
    }
    const itens: ItemRetornoParaCorrecao[] = [];
    for (const [itemId, ms] of porItem) {
      const total = ms.reduce((s, m) => s + m.quantidade, 0);
      itens.push({
        itemId,
        nomeItem: nomeItem.get(itemId) ?? String(itemId),
        quantidadeTotal: total,
        quebraPorLote: ms.map((m) => ({
          loteId: m.loteId,
          loteCodigo: m.loteId ? lotes.get(m.loteId)?.codigo ?? null : null,
          quantidade: m.quantidade,
          conciliado: m.conciliado,
        })),
      });
    }
    const dataRetorno =
      list
        .slice()
        .sort((a, b) => a.dataHora.localeCompare(b.dataHora))[0]?.dataHora ?? '';
    resultado.push({
      operacaoId,
      loteAtualId,
      loteAtualCodigo: loteAtual?.codigo ?? null,
      dataRetorno,
      responsavel: list[0]?.responsavel ?? '',
      itens,
    });
  }
  resultado.sort((a, b) => b.dataRetorno.localeCompare(a.dataRetorno));
  return resultado;
}

function mapearMovsImovel(
  movs: readonly Movimentacao[],
  nomeItem: ReadonlyMap<string, string>,
  nomeLocal: ReadonlyMap<string, string>,
): MovImovelParaCorrecao[] {
  const resultado: MovImovelParaCorrecao[] = [];
  for (const m of movs) {
    if (m.tipo !== 'saida_imovel' && m.tipo !== 'retorno_imovel') continue;
    const imovelId = m.tipo === 'saida_imovel' ? m.destinoId : m.origemId;
    if (!imovelId) continue;
    resultado.push({
      movId: m.id,
      tipo: m.tipo,
      dataHora: m.dataHora,
      responsavel: m.responsavel,
      itemId: m.itemId,
      nomeItem: nomeItem.get(m.itemId) ?? String(m.itemId),
      quantidade: m.quantidade,
      imovelId,
      imovelNome: nomeLocal.get(imovelId) ?? imovelId,
    });
  }
  resultado.sort((a, b) => b.dataHora.localeCompare(a.dataHora));
  return resultado;
}

// Helper que a UI usa pra calcular YMD em SP a partir de uma Date.
export function ymdSP(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

// Re-export typings que as Server Actions e a página querem para o ItemId.
export type { ItemId, LoteId, MovimentacaoId };
