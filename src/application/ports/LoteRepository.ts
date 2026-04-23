import type { Lote } from '@/domain/entities/Lote';
import type { LocalId, LoteId } from '@/domain/types/ids';

export interface LoteFiltro {
  readonly destinoId?: LocalId;
  readonly desdeDataEnvio?: string;
  readonly ateDataEnvio?: string;
}

export interface LoteRepository {
  criar(lote: Lote): Promise<void>;
  // Substitui o registro por um novo valor — usado para marcar encerramento.
  // O Lote é "cabeçalho" com estado mutável; o histórico de fato continua
  // vivendo no log de movimentações (imutável).
  atualizar(lote: Lote): Promise<void>;
  porId(id: LoteId): Promise<Lote | null>;
  porCodigo(codigo: string): Promise<Lote | null>;
  listar(filtro?: LoteFiltro): Promise<Lote[]>;
}
