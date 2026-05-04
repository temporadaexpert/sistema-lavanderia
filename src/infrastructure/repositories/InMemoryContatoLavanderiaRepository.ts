import type { ContatoLavanderia } from '@/domain/entities/ContatoLavanderia';
import type { LoteId } from '@/domain/types/ids';
import type { ContatoLavanderiaRepository } from '@/application/ports/ContatoLavanderiaRepository';

export class InMemoryContatoLavanderiaRepository implements ContatoLavanderiaRepository {
  private log: ContatoLavanderia[] = [];

  async registrar(contato: ContatoLavanderia): Promise<void> {
    this.log.push(contato);
  }

  async listarPorLote(loteId: LoteId): Promise<ContatoLavanderia[]> {
    return this.log.filter((c) => c.loteId === loteId);
  }

  async listar(): Promise<ContatoLavanderia[]> {
    return this.log.slice();
  }

  async limpar(): Promise<void> {
    this.log = [];
  }
}
