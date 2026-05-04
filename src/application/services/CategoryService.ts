import type { Category } from '@/domain/entities/Category';
import { CategoryId } from '@/domain/types/ids';
import { NotFoundError, ValidationError } from '@/domain/errors/DomainErrors';
import type { CategoryRepository } from '../ports/CategoryRepository';
import type { Clock, IdGenerator } from './MovimentacaoService';

export interface CriarCategoriaInput {
  readonly nome: string;
  readonly ativo?: boolean;
}

export interface AtualizarCategoriaInput {
  readonly nome: string;
  readonly ativo: boolean;
}

// Normaliza nome pra comparação de unicidade: trim + lowercase. Dois nomes
// que só diferem em caixa ou espaços na ponta são considerados iguais.
function normalizar(nome: string): string {
  return nome.trim().toLowerCase();
}

export class CategoryService {
  constructor(
    private readonly categorias: CategoryRepository,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async criar(input: CriarCategoriaInput): Promise<Category> {
    const nome = this.validarNome(input.nome);
    const existente = await this.acharPorNomeNormalizado(nome);
    if (existente) {
      throw new ValidationError(`Já existe uma categoria com o nome "${nome}"`);
    }
    const category: Category = {
      id: CategoryId(this.idGen.gerar()),
      nome,
      ativo: input.ativo ?? true,
      criadoEm: this.clock.agoraISO(),
    };
    await this.categorias.criar(category);
    return category;
  }

  async atualizar(id: CategoryId, input: AtualizarCategoriaInput): Promise<Category> {
    const existente = await this.categorias.porId(id);
    if (!existente) throw new NotFoundError('Categoria', id);
    const nome = this.validarNome(input.nome);
    const colidente = await this.acharPorNomeNormalizado(nome);
    if (colidente && colidente.id !== id) {
      throw new ValidationError(`Já existe outra categoria com o nome "${nome}"`);
    }
    const atualizada: Category = {
      ...existente,
      nome,
      ativo: input.ativo,
    };
    await this.categorias.atualizar(atualizada);
    return atualizada;
  }

  async alternarAtivo(id: CategoryId): Promise<Category> {
    const existente = await this.categorias.porId(id);
    if (!existente) throw new NotFoundError('Categoria', id);
    const atualizada: Category = { ...existente, ativo: !existente.ativo };
    await this.categorias.atualizar(atualizada);
    return atualizada;
  }

  // Garante-se-ou-cria por nome — ponto de entrada usado tanto pela UI
  // (botão "+ Nova categoria") quanto pela migração de dados legacy.
  // Idempotente: chamar N vezes com o mesmo nome devolve a mesma categoria.
  async obterOuCriarPorNome(nome: string): Promise<Category> {
    const normalizado = normalizar(nome);
    if (!normalizado) throw new ValidationError('Nome da categoria é obrigatório');
    const existente = await this.acharPorNomeNormalizado(normalizado);
    if (existente) return existente;
    return this.criar({ nome });
  }

  private validarNome(nomeRaw: string): string {
    const nome = nomeRaw?.trim() ?? '';
    if (!nome) throw new ValidationError('Nome da categoria é obrigatório');
    if (nome.length > 60) throw new ValidationError('Nome da categoria deve ter até 60 caracteres');
    return nome;
  }

  private async acharPorNomeNormalizado(nome: string): Promise<Category | null> {
    const chave = normalizar(nome);
    const todas = await this.categorias.listar();
    return todas.find((c) => normalizar(c.nome) === chave) ?? null;
  }
}
