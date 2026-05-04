import type { Lote } from '@/domain/entities/Lote';
import type { LoteId } from '@/domain/types/ids';
import type { LoteFiltro, LoteRepository } from '@/application/ports/LoteRepository';

export class InMemoryLoteRepository implements LoteRepository {
  private readonly store = new Map<LoteId, Lote>();

  async criar(lote: Lote): Promise<void> {
    this.store.set(lote.id, lote);
  }

  async atualizar(lote: Lote): Promise<void> {
    if (!this.store.has(lote.id)) {
      // Protege contra "atualizar" um lote que nunca foi criado — seria
      // sinal de bug na camada de service.
      throw new Error(`Lote não encontrado para atualizar: ${lote.id}`);
    }
    this.store.set(lote.id, lote);
  }

  async porId(id: LoteId): Promise<Lote | null> {
    return this.store.get(id) ?? null;
  }

  async porCodigo(codigo: string): Promise<Lote | null> {
    for (const l of this.store.values()) {
      if (l.codigo === codigo) return l;
    }
    return null;
  }

  async listar(filtro?: LoteFiltro): Promise<Lote[]> {
    let out = Array.from(this.store.values());
    if (filtro?.destinoId) out = out.filter((l) => l.destinoId === filtro.destinoId);
    if (filtro?.desdeDataEnvio) out = out.filter((l) => l.dataEnvio >= filtro.desdeDataEnvio!);
    if (filtro?.ateDataEnvio) out = out.filter((l) => l.dataEnvio <= filtro.ateDataEnvio!);
    return out;
  }

  async limpar(): Promise<void> {
    this.store.clear();
  }
}
