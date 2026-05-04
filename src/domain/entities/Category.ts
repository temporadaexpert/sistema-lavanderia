import type { CategoryId } from '../types/ids';

// Categoria de material. Substituição estruturada do antigo campo livre
// `categoria: string` que existia no Item. Agora:
//   - gestão centralizada (admin cria/inativa),
//   - nome único (case-insensitive, sem duplicatas por erro de digitação),
//   - Item referencia via categoriaId — renomear categoria reflete em
//     todo o catálogo automaticamente.
//
// Não tem delete por design: o fluxo profissional é ativar/inativar, pra
// preservar referência histórica de materiais já cadastrados.
export interface Category {
  readonly id: CategoryId;
  readonly nome: string;
  readonly ativo: boolean;
  readonly criadoEm: string;
}
