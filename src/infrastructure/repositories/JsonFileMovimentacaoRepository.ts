import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { MovimentacaoId } from '@/domain/types/ids';
import type {
  CancelamentoPatch,
  MovimentacaoFiltro,
  MovimentacaoRepository,
} from '@/application/ports/MovimentacaoRepository';
import { criarJsonStore, type JsonStore } from '../persistence/jsonStore';

// Persistência em disco do log de movimentações. Antes era in-memory e
// qualquer restart do processo (HMR do dev, deploy, crash) apagava tudo —
// o que fazia o dashboard admin reagir como se nada tivesse sido lançado.
//
// O log continua append-only para registrar(), mas marcarCancelada()
// substitui o registro in-place (mutação controlada de 4 campos de
// auditoria, sem alterar tipo/quantidade/etc.).
export class JsonFileMovimentacaoRepository implements MovimentacaoRepository {
  private readonly json: JsonStore<Movimentacao>;
  // Estrutura carregada: array linear (ordenação natural de registro) +
  // cache de indexação por id construído lazy. Cardinalidade esperada é
  // baixa (≪ 10k movs pra um ano), cabe em memória sem issues.
  private storePromise: Promise<Movimentacao[]> | null = null;

  constructor(nomeArquivo = 'movimentacoes.json') {
    this.json = criarJsonStore<Movimentacao>(nomeArquivo);
  }

  private async garantirCarregado(): Promise<Movimentacao[]> {
    if (this.storePromise) return this.storePromise;
    this.storePromise = (async () => {
      const registros = await this.json.carregar();
      // Normalização de dados legacy: arquivos JSON antigos podem faltar
      // campos adicionados depois (cancelada, canceladoEm, etc.).
      return registros.map(
        (m) =>
          ({
            ...m,
            cancelada: (m as { cancelada?: boolean }).cancelada ?? false,
            canceladoEm:
              (m as { canceladoEm?: string | null }).canceladoEm ?? null,
            canceladoPor:
              (m as { canceladoPor?: string | null }).canceladoPor ?? null,
            motivoCancelamento:
              (m as { motivoCancelamento?: string | null }).motivoCancelamento ?? null,
            precoUnitarioSnapshot:
              (m as { precoUnitarioSnapshot?: number | null }).precoUnitarioSnapshot ??
              null,
            conciliado: (m as { conciliado?: boolean }).conciliado ?? true,
          }) as Movimentacao,
      );
    })();
    return this.storePromise;
  }

  private async flush(): Promise<void> {
    if (!this.storePromise) return;
    const log = await this.storePromise;
    await this.json.salvar(log);
  }

  async registrar(mov: Movimentacao): Promise<void> {
    const log = await this.garantirCarregado();
    log.push(mov);
    await this.flush();
  }

  async porId(id: MovimentacaoId): Promise<Movimentacao | null> {
    const log = await this.garantirCarregado();
    return log.find((m) => m.id === id) ?? null;
  }

  async listar(filtro?: MovimentacaoFiltro): Promise<Movimentacao[]> {
    const log = await this.garantirCarregado();
    const base = filtro?.incluirCanceladas ? log : log.filter((m) => !m.cancelada);
    if (!filtro) return base.slice();
    return base.filter((m) => {
      if (filtro.itemId && m.itemId !== filtro.itemId) return false;
      if (filtro.tipo && m.tipo !== filtro.tipo) return false;
      if (
        filtro.localId &&
        m.origemId !== filtro.localId &&
        m.destinoId !== filtro.localId
      ) {
        return false;
      }
      if (filtro.ateDataHora && m.dataHora > filtro.ateDataHora) return false;
      if (filtro.desdeDataHora && m.dataHora < filtro.desdeDataHora) return false;
      if (filtro.loteId && m.loteId !== filtro.loteId) return false;
      return true;
    });
  }

  async marcarCancelada(id: MovimentacaoId, patch: CancelamentoPatch): Promise<void> {
    const log = await this.garantirCarregado();
    const idx = log.findIndex((m) => m.id === id);
    if (idx === -1) {
      throw new Error(`Movimentação não encontrada para cancelar: ${id}`);
    }
    const atual = log[idx]!;
    if (atual.cancelada) {
      throw new Error(`Movimentação já cancelada: ${id}`);
    }
    log[idx] = {
      ...atual,
      cancelada: true,
      canceladoEm: patch.canceladoEm,
      canceladoPor: patch.canceladoPor,
      motivoCancelamento: patch.motivoCancelamento,
    };
    await this.flush();
  }

  async limpar(): Promise<void> {
    const log = await this.garantirCarregado();
    log.length = 0;
    await this.json.limpar();
  }
}
