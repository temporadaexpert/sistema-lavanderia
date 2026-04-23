import type { Item } from '@/domain/entities/Item';
import type { ItemId } from '@/domain/types/ids';

export interface ItemRepository {
  criar(item: Item): Promise<void>;
  // Substitui o registro existente. Itens são entidades com estado
  // mutável (ao contrário do log de movimentações, que é append-only).
  atualizar(item: Item): Promise<void>;
  porId(id: ItemId): Promise<Item | null>;
  listar(opts?: { apenasAtivos?: boolean }): Promise<Item[]>;
}
