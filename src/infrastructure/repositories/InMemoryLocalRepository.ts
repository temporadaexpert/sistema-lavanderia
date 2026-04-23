import type { Local } from '@/domain/entities/Local';
import type { LocalId } from '@/domain/types/ids';
import type { LocalTipo } from '@/domain/types/enums';
import type { LocalRepository } from '@/application/ports/LocalRepository';

export class InMemoryLocalRepository implements LocalRepository {
  private readonly store = new Map<LocalId, Local>();

  async criar(local: Local): Promise<void> {
    this.store.set(local.id, local);
  }

  async atualizar(local: Local): Promise<void> {
    if (!this.store.has(local.id)) {
      throw new Error(`Local não encontrado para atualizar: ${local.id}`);
    }
    this.store.set(local.id, local);
  }

  async porId(id: LocalId): Promise<Local | null> {
    return this.store.get(id) ?? null;
  }

  async listar(opts?: { tipo?: LocalTipo; apenasAtivos?: boolean }): Promise<Local[]> {
    let out = Array.from(this.store.values());
    if (opts?.tipo) out = out.filter((l) => l.tipo === opts.tipo);
    if (opts?.apenasAtivos) out = out.filter((l) => l.ativo);
    return out;
  }
}
