import type { Local } from '@/domain/entities/Local';
import { LocalId } from '@/domain/types/ids';
import { LOCAL_TIPOS, type LocalTipo } from '@/domain/types/enums';
import { NotFoundError, ValidationError } from '@/domain/errors/DomainErrors';
import type { LocalRepository } from '../ports/LocalRepository';
import type { Clock, IdGenerator } from './MovimentacaoService';

export interface CriarLocalInput {
  readonly nome: string;
  readonly tipo: LocalTipo;
  readonly ativo?: boolean;
}

export interface AtualizarLocalInput {
  readonly nome: string;
  readonly tipo: LocalTipo;
  readonly ativo: boolean;
}

// Casos de uso do cadastro de locais. Mesmo padrão do ItemService: valida
// entrada, garante unicidade de nome (case-insensitive) e preserva criadoEm
// ao atualizar. Não apaga locais — inativar é o fluxo, mantendo o histórico
// íntegro.
export class LocalService {
  constructor(
    private readonly locais: LocalRepository,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async criar(input: CriarLocalInput): Promise<Local> {
    const sanitized = this.sanitizar(input);
    const colidente = await this.acharPorNomeNormalizado(sanitized.nome);
    if (colidente) {
      throw new ValidationError(`Já existe um local com o nome "${sanitized.nome}"`);
    }
    const local: Local = {
      id: LocalId(this.idGen.gerar()),
      nome: sanitized.nome,
      tipo: sanitized.tipo,
      ativo: input.ativo ?? true,
      criadoEm: this.clock.agoraISO(),
    };
    await this.locais.criar(local);
    return local;
  }

  async atualizar(id: LocalId, input: AtualizarLocalInput): Promise<Local> {
    const existente = await this.locais.porId(id);
    if (!existente) throw new NotFoundError('Local', id);
    const sanitized = this.sanitizar(input);
    const colidente = await this.acharPorNomeNormalizado(sanitized.nome);
    if (colidente && colidente.id !== id) {
      throw new ValidationError(`Já existe outro local com o nome "${sanitized.nome}"`);
    }
    const atualizado: Local = {
      id: existente.id,
      nome: sanitized.nome,
      tipo: sanitized.tipo,
      ativo: input.ativo,
      // criadoEm é imutável — preserva a data original do cadastro.
      criadoEm: existente.criadoEm,
    };
    await this.locais.atualizar(atualizado);
    return atualizado;
  }

  async alternarAtivo(id: LocalId): Promise<Local> {
    const existente = await this.locais.porId(id);
    if (!existente) throw new NotFoundError('Local', id);
    const atualizado: Local = { ...existente, ativo: !existente.ativo };
    await this.locais.atualizar(atualizado);
    return atualizado;
  }

  private sanitizar(input: { nome: string; tipo: string }): {
    nome: string;
    tipo: LocalTipo;
  } {
    const nome = input.nome?.trim() ?? '';
    if (!nome) throw new ValidationError('Nome é obrigatório');
    if (nome.length > 120) throw new ValidationError('Nome deve ter até 120 caracteres');

    if (!input.tipo) throw new ValidationError('Tipo é obrigatório');
    if (!(LOCAL_TIPOS as readonly string[]).includes(input.tipo)) {
      throw new ValidationError(
        `Tipo inválido. Valores aceitos: ${LOCAL_TIPOS.join(', ')}`,
      );
    }
    return { nome, tipo: input.tipo as LocalTipo };
  }

  private async acharPorNomeNormalizado(nome: string): Promise<Local | null> {
    const normalizado = nome.trim().toLowerCase();
    const todos = await this.locais.listar();
    return todos.find((l) => l.nome.trim().toLowerCase() === normalizado) ?? null;
  }
}
