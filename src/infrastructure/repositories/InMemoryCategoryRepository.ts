import type { Category } from '@/domain/entities/Category';
import type { CategoryId } from '@/domain/types/ids';
import type { CategoryRepository } from '@/application/ports/CategoryRepository';

export class InMemoryCategoryRepository implements CategoryRepository {
  private readonly store = new Map<CategoryId, Category>();

  async criar(category: Category): Promise<void> {
    this.store.set(category.id, category);
  }

  async atualizar(category: Category): Promise<void> {
    if (!this.store.has(category.id)) {
      throw new Error(`Categoria não encontrada para atualizar: ${category.id}`);
    }
    this.store.set(category.id, category);
  }

  async porId(id: CategoryId): Promise<Category | null> {
    return this.store.get(id) ?? null;
  }

  async listar(opts?: { apenasAtivos?: boolean }): Promise<Category[]> {
    const todas = Array.from(this.store.values());
    const filtradas = opts?.apenasAtivos ? todas.filter((c) => c.ativo) : todas;
    return filtradas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  async limpar(): Promise<void> {
    this.store.clear();
  }
}
