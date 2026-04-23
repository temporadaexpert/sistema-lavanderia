import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type {
  MovimentacaoFiltro,
  MovimentacaoRepository,
} from '@/application/ports/MovimentacaoRepository';

export class InMemoryMovimentacaoRepository implements MovimentacaoRepository {
  private readonly log: Movimentacao[] = [];

  async registrar(mov: Movimentacao): Promise<void> {
    this.log.push(mov);
  }

  async listar(filtro?: MovimentacaoFiltro): Promise<Movimentacao[]> {
    if (!filtro) return this.log.slice();
    return this.log.filter((m) => {
      if (filtro.itemId && m.itemId !== filtro.itemId) return false;
      if (filtro.tipo && m.tipo !== filtro.tipo) return false;
      if (filtro.localId && m.origemId !== filtro.localId && m.destinoId !== filtro.localId) return false;
      if (filtro.ateDataHora && m.dataHora > filtro.ateDataHora) return false;
      if (filtro.desdeDataHora && m.dataHora < filtro.desdeDataHora) return false;
      if (filtro.loteId && m.loteId !== filtro.loteId) return false;
      return true;
    });
  }
}
