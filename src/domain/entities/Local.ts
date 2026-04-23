import type { LocalId } from '../types/ids';
import type { LocalTipo } from '../types/enums';

export interface Local {
  readonly id: LocalId;
  readonly nome: string;
  readonly tipo: LocalTipo;
  readonly ativo: boolean;
  readonly criadoEm: string;
}
