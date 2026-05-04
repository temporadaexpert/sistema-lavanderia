import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { MovimentacaoId } from '@/domain/types/ids';
import type {
  CancelamentoPatch,
  MovimentacaoFiltro,
  MovimentacaoRepository,
} from '@/application/ports/MovimentacaoRepository';

export class InMemoryMovimentacaoRepository implements MovimentacaoRepository {
  private log: Movimentacao[] = [];

  async registrar(mov: Movimentacao): Promise<void> {
    this.log.push(mov);
  }

  async porId(id: MovimentacaoId): Promise<Movimentacao | null> {
    return this.log.find((m) => m.id === id) ?? null;
  }

  async listar(filtro?: MovimentacaoFiltro): Promise<Movimentacao[]> {
    const base = filtro?.incluirCanceladas ? this.log : this.log.filter((m) => !m.cancelada);
    if (!filtro) return base.slice();
    return base.filter((m) => {
      if (filtro.itemId && m.itemId !== filtro.itemId) return false;
      if (filtro.tipo && m.tipo !== filtro.tipo) return false;
      if (filtro.localId && m.origemId !== filtro.localId && m.destinoId !== filtro.localId) return false;
      if (filtro.ateDataHora && m.dataHora > filtro.ateDataHora) return false;
      if (filtro.desdeDataHora && m.dataHora < filtro.desdeDataHora) return false;
      if (filtro.loteId && m.loteId !== filtro.loteId) return false;
      return true;
    });
  }

  async marcarCancelada(id: MovimentacaoId, patch: CancelamentoPatch): Promise<void> {
    const idx = this.log.findIndex((m) => m.id === id);
    if (idx === -1) {
      throw new Error(`Movimentação não encontrada para cancelar: ${id}`);
    }
    const atual = this.log[idx]!;
    if (atual.cancelada) {
      throw new Error(`Movimentação já cancelada: ${id}`);
    }
    // Replace-in-place preservando todos os campos originais.
    this.log[idx] = {
      ...atual,
      cancelada: true,
      canceladoEm: patch.canceladoEm,
      canceladoPor: patch.canceladoPor,
      motivoCancelamento: patch.motivoCancelamento,
    };
  }

  async limpar(): Promise<void> {
    this.log = [];
  }
}
