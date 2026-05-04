import type { Item } from '@/domain/entities/Item';
import { CategoryId, ItemId } from '@/domain/types/ids';
import { NotFoundError, ValidationError } from '@/domain/errors/DomainErrors';
import type { ItemRepository } from '../ports/ItemRepository';
import type { CategoryRepository } from '../ports/CategoryRepository';
import type { Clock, IdGenerator } from './MovimentacaoService';

export interface CriarItemInput {
  readonly nome: string;
  readonly categoriaId: CategoryId;
  readonly unidade: string;
  readonly valorUnitario: number | null;
  readonly estoqueMinimo: number | null;
  readonly estoqueTotal?: number | null;
  readonly ativo?: boolean;
}

export interface AtualizarItemInput {
  readonly nome: string;
  readonly categoriaId: CategoryId;
  readonly unidade: string;
  readonly valorUnitario: number | null;
  readonly estoqueMinimo: number | null;
  readonly estoqueTotal: number | null;
  readonly ativo: boolean;
}

// Casos de uso de cadastro de materiais. Valida entrada, mantém unicidade
// de nome, resolve a categoria a partir do `categoriaId` e denormaliza
// `categoria.nome` pra cache de exibição. Não apaga itens.
export class ItemService {
  constructor(
    private readonly itens: ItemRepository,
    private readonly categorias: CategoryRepository,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async criar(input: CriarItemInput): Promise<Item> {
    const sanitized = this.sanitizar(input);
    const categoria = await this.resolverCategoria(input.categoriaId);
    const colidente = await this.acharPorNomeNormalizado(sanitized.nome);
    if (colidente) {
      throw new ValidationError(`Já existe um material com o nome "${sanitized.nome}"`);
    }
    const item: Item = {
      id: ItemId(this.idGen.gerar()),
      nome: sanitized.nome,
      categoriaId: categoria.id,
      categoria: categoria.nome,
      unidade: sanitized.unidade,
      valorUnitario: sanitized.valorUnitario,
      estoqueMinimo: sanitized.estoqueMinimo,
      estoqueTotal: sanitized.estoqueTotal,
      ativo: input.ativo ?? true,
      criadoEm: this.clock.agoraISO(),
    };
    await this.itens.criar(item);
    return item;
  }

  async atualizar(id: ItemId, input: AtualizarItemInput): Promise<Item> {
    const existente = await this.itens.porId(id);
    if (!existente) throw new NotFoundError('Item', id);
    const sanitized = this.sanitizar(input);
    const categoria = await this.resolverCategoria(input.categoriaId);
    const colidente = await this.acharPorNomeNormalizado(sanitized.nome);
    if (colidente && colidente.id !== id) {
      throw new ValidationError(`Já existe outro material com o nome "${sanitized.nome}"`);
    }
    const atualizado: Item = {
      id: existente.id,
      nome: sanitized.nome,
      categoriaId: categoria.id,
      categoria: categoria.nome,
      unidade: sanitized.unidade,
      valorUnitario: sanitized.valorUnitario,
      estoqueMinimo: sanitized.estoqueMinimo,
      estoqueTotal: sanitized.estoqueTotal,
      ativo: input.ativo,
      // criadoEm é imutável — preserva a data original do cadastro.
      criadoEm: existente.criadoEm,
    };
    await this.itens.atualizar(atualizado);
    return atualizado;
  }

  async alternarAtivo(id: ItemId): Promise<Item> {
    const existente = await this.itens.porId(id);
    if (!existente) throw new NotFoundError('Item', id);
    const atualizado: Item = { ...existente, ativo: !existente.ativo };
    await this.itens.atualizar(atualizado);
    return atualizado;
  }

  private async resolverCategoria(categoriaId: CategoryId | string | undefined) {
    if (typeof categoriaId !== 'string' || !categoriaId) {
      throw new ValidationError('Categoria é obrigatória');
    }
    const categoria = await this.categorias.porId(CategoryId(categoriaId));
    if (!categoria) {
      throw new NotFoundError('Categoria', String(categoriaId));
    }
    if (!categoria.ativo) {
      throw new ValidationError(`Categoria "${categoria.nome}" está inativa`);
    }
    return categoria;
  }

  private sanitizar(input: {
    nome: string;
    unidade: string;
    valorUnitario: number | null;
    estoqueMinimo: number | null;
    estoqueTotal?: number | null;
  }): {
    nome: string;
    unidade: string;
    valorUnitario: number | null;
    estoqueMinimo: number | null;
    estoqueTotal: number | null;
  } {
    const nome = input.nome?.trim() ?? '';
    if (!nome) throw new ValidationError('Nome é obrigatório');
    if (nome.length > 120) throw new ValidationError('Nome deve ter até 120 caracteres');

    const unidade = input.unidade?.trim() ?? '';
    if (!unidade) throw new ValidationError('Unidade é obrigatória');

    if (input.valorUnitario != null) {
      if (!Number.isFinite(input.valorUnitario) || input.valorUnitario < 0) {
        throw new ValidationError('Valor unitário não pode ser negativo');
      }
    }
    if (input.estoqueMinimo != null) {
      if (!Number.isFinite(input.estoqueMinimo) || input.estoqueMinimo < 0) {
        throw new ValidationError('Estoque mínimo não pode ser negativo');
      }
      if (!Number.isInteger(input.estoqueMinimo)) {
        throw new ValidationError('Estoque mínimo deve ser um número inteiro');
      }
    }
    if (input.estoqueTotal != null) {
      if (!Number.isFinite(input.estoqueTotal) || input.estoqueTotal < 0) {
        throw new ValidationError('Estoque total não pode ser negativo');
      }
      if (!Number.isInteger(input.estoqueTotal)) {
        throw new ValidationError('Estoque total deve ser um número inteiro');
      }
    }

    return {
      nome,
      unidade,
      valorUnitario: input.valorUnitario,
      estoqueMinimo: input.estoqueMinimo,
      estoqueTotal: input.estoqueTotal ?? null,
    };
  }

  private async acharPorNomeNormalizado(nome: string) {
    const normalizado = nome.trim().toLowerCase();
    const todos = await this.itens.listar();
    return todos.find((i) => i.nome.trim().toLowerCase() === normalizado) ?? null;
  }
}
