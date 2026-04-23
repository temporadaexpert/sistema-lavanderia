import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { ItemId, LocalId, LoteId } from '@/domain/types/ids';
import type { MovimentacaoTipo } from '@/domain/types/enums';

export interface MovimentacaoFiltro {
  readonly itemId?: ItemId;
  readonly localId?: LocalId;
  readonly tipo?: MovimentacaoTipo;
  readonly ateDataHora?: string;
  readonly desdeDataHora?: string;
  readonly loteId?: LoteId;
}

export interface MovimentacaoRepository {
  registrar(mov: Movimentacao): Promise<void>;
  listar(filtro?: MovimentacaoFiltro): Promise<Movimentacao[]>;
}
