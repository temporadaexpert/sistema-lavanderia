import type { MovimentacaoTipo } from '@/domain/types/enums';
import type { ItemRepository } from '../ports/ItemRepository';
import type { LocalRepository } from '../ports/LocalRepository';
import type { LoteRepository } from '../ports/LoteRepository';
import type { MovimentacaoRepository } from '../ports/MovimentacaoRepository';
import type { LoteLavanderiaService } from './LoteLavanderiaService';
import type { RelatorioLavanderiaService } from './RelatorioLavanderiaService';
import type { RelatorioPerdaService } from './RelatorioPerdaService';
import type { SaldoService } from './SaldoService';

export interface UltimoLancamento {
  readonly id: string;
  readonly dataHora: string;
  readonly tipo: MovimentacaoTipo;
  readonly quantidade: number;
  readonly nomeItem: string;
  readonly nomeOrigem: string | null;
  readonly nomeDestino: string | null;
  readonly responsavel: string;
  readonly codigoLote: string | null;
}

export interface AlertaEstoqueBaixo {
  readonly itemId: string;
  readonly nome: string;
  readonly unidade: string;
  readonly saldoAtual: number;
  readonly estoqueMinimo: number;
  readonly razao: number; // saldoAtual / estoqueMinimo — ordena pior primeiro
}

export interface AlertaLotePendente {
  readonly loteId: string;
  readonly codigo: string;
  readonly dataEnvio: string;
  readonly pendenciaEfetiva: number;
  readonly responsavel: string;
  readonly status: 'aberto' | 'retorno_parcial' | 'com_divergencia';
}

export interface DashboardSnapshot {
  readonly agora: string;
  readonly inicioDia: string;
  readonly inicioMes: string;
  readonly depositoPrincipalNome: string | null;

  readonly lavanderia: {
    readonly valorHoje: number;
    readonly valorMes: number;
    readonly pecasHoje: number;
    readonly pecasMes: number;
    readonly custoParcialHoje: boolean;
    readonly custoParcialMes: boolean;
  };

  readonly perdas: {
    readonly pecasMes: number;
    readonly valorMes: number;
    readonly lotesEncerradosMes: number;
    readonly custoParcial: boolean;
  };

  readonly pendencia: {
    readonly totalLotes: number;
    readonly pecasPendentes: number;
  };

  readonly materiais: {
    readonly total: number;
    readonly ativos: number;
  };

  readonly locais: {
    readonly total: number;
    readonly ativos: number;
  };

  readonly alertasEstoque: readonly AlertaEstoqueBaixo[];
  readonly alertasLotes: readonly AlertaLotePendente[];
  readonly ultimasMovimentacoes: readonly UltimoLancamento[];
}

// Serviço de composição: agrega resultados de vários services já existentes
// em um único "snapshot" consumível pela página de dashboard. Não calcula
// nada novo — apenas orquestra chamadas, define janelas de tempo (hoje/mês)
// e faz lookups auxiliares (nomes de item/local/código de lote) para que
// o server component renderize sem precisar de outras queries.
export class DashboardAdminService {
  constructor(
    private readonly itens: ItemRepository,
    private readonly locais: LocalRepository,
    private readonly movs: MovimentacaoRepository,
    private readonly loteRepo: LoteRepository,
    private readonly saldos: SaldoService,
    private readonly loteService: LoteLavanderiaService,
    private readonly relLavanderia: RelatorioLavanderiaService,
    private readonly relPerda: RelatorioPerdaService,
  ) {}

  async snapshot(agora: Date = new Date()): Promise<DashboardSnapshot> {
    const inicioDia = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate(),
      0,
      0,
      0,
      0,
    );
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
    const filtroHoje = { desde: inicioDia.toISOString(), ate: agora.toISOString() };
    const filtroMes = { desde: inicioMes.toISOString(), ate: agora.toISOString() };

    const [
      resumoLavHoje,
      resumoLavMes,
      resumoPerdasMes,
      lotesAbertosResumos,
      todosItens,
      todosLocais,
      todosLotes,
      todasMovs,
    ] = await Promise.all([
      this.relLavanderia.resumo(filtroHoje),
      this.relLavanderia.resumo(filtroMes),
      this.relPerda.resumo(filtroMes),
      this.loteService.listar({ apenasAbertos: true }),
      // Carrega TODOS (ativos+inativos) para poder resolver nomes de itens
      // inativos em movimentações históricas. Alertas de estoque e contagem
      // de ativos vêm de filtros posteriores sobre essa lista.
      this.itens.listar(),
      // Mesmo princípio para locais: resolve nome em movs históricas
      // mesmo quando o local está inativo. Depósito principal vem do
      // subconjunto de ativos abaixo.
      this.locais.listar(),
      this.loteRepo.listar(),
      this.movs.listar(),
    ]);

    const itensAtivos = todosItens.filter((i) => i.ativo);
    const locaisAtivos = todosLocais.filter((l) => l.ativo);
    const depositoPrincipal = locaisAtivos.find((l) => l.tipo === 'deposito') ?? null;

    // Alertas de estoque: apenas itens ATIVOS com estoqueMinimo definido
    // cujo saldo no depósito principal está abaixo da meta. Ordena por
    // "razão" para que os mais críticos (mais próximos de zero) apareçam
    // primeiro.
    const alertasEstoque: AlertaEstoqueBaixo[] = [];
    if (depositoPrincipal) {
      const saldosDep = await this.saldos.saldoPorItemNoLocal(depositoPrincipal.id);
      const saldosMap = new Map(saldosDep.map((s) => [s.itemId, s.quantidade]));
      for (const i of itensAtivos) {
        const minimo = i.estoqueMinimo;
        if (minimo == null || minimo <= 0) continue;
        const saldoAtual = saldosMap.get(i.id) ?? 0;
        if (saldoAtual >= minimo) continue;
        alertasEstoque.push({
          itemId: i.id,
          nome: i.nome,
          unidade: i.unidade,
          saldoAtual,
          estoqueMinimo: minimo,
          razao: saldoAtual / minimo,
        });
      }
      alertasEstoque.sort((a, b) => a.razao - b.razao);
    }

    const alertasLotes: AlertaLotePendente[] = lotesAbertosResumos
      .filter(
        (r) =>
          r.status === 'aberto' ||
          r.status === 'retorno_parcial' ||
          r.status === 'com_divergencia',
      )
      .sort(
        (a, b) =>
          b.pendenciaEfetiva - a.pendenciaEfetiva ||
          b.lote.dataEnvio.localeCompare(a.lote.dataEnvio),
      )
      .slice(0, 8)
      .map((r) => ({
        loteId: r.lote.id,
        codigo: r.lote.codigo,
        dataEnvio: r.lote.dataEnvio,
        pendenciaEfetiva: r.pendenciaEfetiva,
        responsavel: r.lote.responsavel,
        status: r.status as AlertaLotePendente['status'],
      }));

    // Últimas movimentações enriquecidas: resolve nome de item/local/lote
    // aqui para que a página fique puramente de apresentação.
    const nomeItem = new Map(todosItens.map((i) => [i.id, i.nome]));
    const nomeLocal = new Map(todosLocais.map((l) => [l.id, l.nome]));
    const codigoLote = new Map(todosLotes.map((l) => [l.id, l.codigo]));

    const ultimasMovimentacoes: UltimoLancamento[] = todasMovs
      .slice()
      .sort((a, b) => b.dataHora.localeCompare(a.dataHora))
      .slice(0, 8)
      .map((m) => ({
        id: m.id,
        dataHora: m.dataHora,
        tipo: m.tipo,
        quantidade: m.quantidade,
        nomeItem: nomeItem.get(m.itemId) ?? String(m.itemId),
        nomeOrigem: m.origemId ? (nomeLocal.get(m.origemId) ?? null) : null,
        nomeDestino: m.destinoId ? (nomeLocal.get(m.destinoId) ?? null) : null,
        responsavel: m.responsavel,
        codigoLote: m.loteId ? (codigoLote.get(m.loteId) ?? null) : null,
      }));

    return {
      agora: agora.toISOString(),
      inicioDia: inicioDia.toISOString(),
      inicioMes: inicioMes.toISOString(),
      depositoPrincipalNome: depositoPrincipal?.nome ?? null,
      lavanderia: {
        valorHoje: resumoLavHoje.custoEnviado,
        valorMes: resumoLavMes.custoEnviado,
        pecasHoje: resumoLavHoje.totalEnviado,
        pecasMes: resumoLavMes.totalEnviado,
        custoParcialHoje: resumoLavHoje.custoParcial,
        custoParcialMes: resumoLavMes.custoParcial,
      },
      perdas: {
        pecasMes: resumoPerdasMes.totalPecas,
        valorMes: resumoPerdasMes.valorEstimado,
        lotesEncerradosMes: resumoPerdasMes.lotesEncerrados,
        custoParcial: resumoPerdasMes.custoParcial,
      },
      pendencia: {
        totalLotes: lotesAbertosResumos.length,
        pecasPendentes: lotesAbertosResumos.reduce(
          (s, r) => s + Math.max(r.pendenciaEfetiva, 0),
          0,
        ),
      },
      materiais: {
        total: todosItens.length,
        ativos: itensAtivos.length,
      },
      locais: {
        total: todosLocais.length,
        ativos: locaisAtivos.length,
      },
      alertasEstoque,
      alertasLotes,
      ultimasMovimentacoes,
    };
  }
}
