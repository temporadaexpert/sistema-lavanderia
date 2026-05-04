import type { Category } from '@/domain/entities/Category';
import type { CategoryId } from '@/domain/types/ids';
import type { CategoryRepository } from '@/application/ports/CategoryRepository';
import { criarJsonStore, type JsonStore } from '../persistence/jsonStore';

export class JsonFileCategoryRepository implements CategoryRepository {
  private readonly json: JsonStore<Category>;
  private storePromise: Promise<Map<CategoryId, Category>> | null = null;

  constructor(nomeArquivo = 'categorias.json') {
    this.json = criarJsonStore<Category>(nomeArquivo);
  }

  private async garantirCarregado(): Promise<Map<CategoryId, Category>> {
    if (this.storePromise) return this.storePromise;
    this.storePromise = (async () => {
      const registros = await this.json.carregar();
      return new Map(registros.map((c) => [c.id, c]));
    })();
    return this.storePromise;
  }

  private async flush(): Promise<void> {
    if (!this.storePromise) return;
    const store = await this.storePromise;
    await this.json.salvar(Array.from(store.values()));
  }

  async criar(category: Category): Promise<void> {
    const store = await this.garantirCarregado();
    store.set(category.id, category);
    await this.flush();
  }

  async atualizar(category: Category): Promise<void> {
    const store = await this.garantirCarregado();
    if (!store.has(category.id)) {
      throw new Error(`Categoria não encontrada para atualizar: ${category.id}`);
    }
    store.set(category.id, category);
    await this.flush();
  }

  async porId(id: CategoryId): Promise<Category | null> {
    const store = await this.garantirCarregado();
    return store.get(id) ?? null;
  }

  async listar(opts?: { apenasAtivos?: boolean }): Promise<Category[]> {
    const store = await this.garantirCarregado();
    const todas = Array.from(store.values());
    const filtradas = opts?.apenasAtivos ? todas.filter((c) => c.ativo) : todas;
    return filtradas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  async limpar(): Promise<void> {
    const store = await this.garantirCarregado();
    store.clear();
    await this.json.limpar();
  }
}
