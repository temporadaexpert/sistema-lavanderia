import type { Item } from '@/domain/entities/Item';
import { ItemId } from '@/domain/types/ids';
import { NotFoundError, ValidationError } from '@/domain/errors/DomainErrors';
import type { ItemRepository } from '../ports/ItemRepository';
import type { Clock, IdGenerator } from './MovimentacaoService';

export interface CriarItemInput {
  readonly nome: string;
  readonly categoria: string;
  readonly unidade: string;
  readonly valorUnitario: number | null;
  readonly estoqueMinimo: number | null;
  readonly ativo?: boolean;
}

export interface AtualizarItemInput {
  readonly nome: string;
  readonly categoria: string;
  readonly unidade: string;
  readonly valorUnitario: number | null;
  readonly estoqueMinimo: number | null;
  readonly ativo: boolean;
}

// Casos de uso de cadastro de materiais (itens do catálogo). Valida
// entrada, mantém unicidade de nome e preserva criadoEm ao atualizar.
// Não apaga itens: o fluxo profissional é ativar/inativar — movimentações
// históricas continuam referenciando o item por id mesmo quando inativo.
export class ItemService {
  constructor(
    private readonly itens: ItemRepository,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async criar(input: CriarItemInput): Promise<Item> {
    const sanitized = this.sanitizar(input);
    const colidente = await this.acharPorNomeNormalizado(sanitized.nome);
    if (colidente) {
      throw new ValidationError(`Já existe um material com o nome "${sanitized.nome}"`);
    }
    const item: Item = {
      id: ItemId(this.idGen.gerar()),
      nome: sanitized.nome,
      categoria: sanitized.categoria,
      unidade: sanitized.unidade,
      valorUnitario: sanitized.valorUnitario,
      estoqueMinimo: sanitized.estoqueMinimo,
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
    const colidente = await this.acharPorNomeNormalizado(sanitized.nome);
    if (colidente && colidente.id !== id) {
      throw new ValidationError(`Já existe outro material com o nome "${sanitized.nome}"`);
    }
    const atualizado: Item = {
      id: existente.id,
      nome: sanitized.nome,
      categoria: sanitized.categoria,
      unidade: sanitized.unidade,
      valorUnitario: sanitized.valorUnitario,
      estoqueMinimo: sanitized.estoqueMinimo,
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

  private sanitizar(input: {
    nome: string;
    categoria: string;
    unidade: string;
    valorUnitario: number | null;
    estoqueMinimo: number | null;
  }): {
    nome: string;
    categoria: string;
    unidade: string;
    valorUnitario: number | null;
    estoqueMinimo: number | null;
  } {
    const nome = input.nome?.trim() ?? '';
    if (!nome) throw new ValidationError('Nome é obrigatório');
    if (nome.length > 120) throw new ValidationError('Nome deve ter até 120 caracteres');

    const categoria = input.categoria?.trim() ?? '';
    if (!categoria) throw new ValidationError('Categoria é obrigatória');

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

    return {
      nome,
      categoria,
      unidade,
      valorUnitario: input.valorUnitario,
      estoqueMinimo: input.estoqueMinimo,
    };
  }

  private async acharPorNomeNormalizado(nome: string): Promise<Item | null> {
    const normalizado = nome.trim().toLowerCase();
    const todos = await this.itens.listar();
    return todos.find((i) => i.nome.trim().toLowerCase() === normalizado) ?? null;
  }
}
