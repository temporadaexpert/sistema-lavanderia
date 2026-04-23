import type { Item } from '@/domain/entities/Item';
import type { ItemId } from '@/domain/types/ids';
import type { ItemRepository } from '@/application/ports/ItemRepository';

export class InMemoryItemRepository implements ItemRepository {
  private readonly store = new Map<ItemId, Item>();

  async criar(item: Item): Promise<void> {
    this.store.set(item.id, item);
  }

  async atualizar(item: Item): Promise<void> {
    if (!this.store.has(item.id)) {
      throw new Error(`Item não encontrado para atualizar: ${item.id}`);
    }
    this.store.set(item.id, item);
  }

  async porId(id: ItemId): Promise<Item | null> {
    return this.store.get(id) ?? null;
  }

  async listar(opts?: { apenasAtivos?: boolean }): Promise<Item[]> {
    const todos = Array.from(this.store.values());
    return opts?.apenasAtivos ? todos.filter((i) => i.ativo) : todos;
  }
}
