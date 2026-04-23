import type { ItemId, LocalId, LoteId } from '@/domain/types/ids';
import type { MovimentacaoTipo } from '@/domain/types/enums';

export interface RegistrarMovimentacaoInput {
  readonly itemId: ItemId;
  readonly quantidade: number;
  readonly tipo: MovimentacaoTipo;
  readonly origemId: LocalId | null;
  readonly destinoId: LocalId | null;
  readonly responsavel: string;
  readonly observacao?: string | null;
  readonly dataHora?: string;
  readonly loteId?: LoteId | null;
}
