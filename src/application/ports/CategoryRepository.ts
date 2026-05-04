import type { Category } from '@/domain/entities/Category';
import type { CategoryId } from '@/domain/types/ids';

export interface CategoryRepository {
  criar(category: Category): Promise<void>;
  // Não há delete — ativar/inativar preserva integridade referencial
  // com os itens que referenciam a categoria.
  atualizar(category: Category): Promise<void>;
  porId(id: CategoryId): Promise<Category | null>;
  listar(opts?: { apenasAtivos?: boolean }): Promise<Category[]>;
  // Administrativo: zera todas as categorias. Pra reset de dados de teste.
  limpar(): Promise<void>;
}
