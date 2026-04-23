import type { Local } from '@/domain/entities/Local';
import type { LocalId } from '@/domain/types/ids';
import type { LocalTipo } from '@/domain/types/enums';

export interface LocalRepository {
  criar(local: Local): Promise<void>;
  // Substitui o registro existente. Locais são entidades com estado
  // mutável (ativo/inativo, nome, tipo). O histórico de movimentações e
  // lotes continua referenciando pelo id, não quebra quando um local é
  // renomeado ou desativado.
  atualizar(local: Local): Promise<void>;
  porId(id: LocalId): Promise<Local | null>;
  listar(opts?: { tipo?: LocalTipo; apenasAtivos?: boolean }): Promise<Local[]>;
}
