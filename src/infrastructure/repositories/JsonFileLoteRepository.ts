import type { Lote } from '@/domain/entities/Lote';
import type { LoteId } from '@/domain/types/ids';
import type { LoteFiltro, LoteRepository } from '@/application/ports/LoteRepository';
import { criarJsonStore, type JsonStore } from '../persistence/jsonStore';

export class JsonFileLoteRepository implements LoteRepository {
  private readonly json: JsonStore<Lote>;
  private storePromise: Promise<Map<LoteId, Lote>> | null = null;

  constructor(nomeArquivo = 'lotes.json') {
    this.json = criarJsonStore<Lote>(nomeArquivo);
  }

  private async garantirCarregado(): Promise<Map<LoteId, Lote>> {
    if (this.storePromise) return this.storePromise;
    this.storePromise = (async () => {
      const registros = await this.json.carregar();
      // Normaliza campos adicionados por migração — lotes gravados antes
      // de `origemDivergencia` existir vêm com a chave undefined no JSON.
      // Coerce pra null pra preservar a forma do tipo Lote.
      return new Map(
        registros.map((l) => [
          l.id,
          {
            ...l,
            origemDivergencia:
              (l as { origemDivergencia?: Lote['origemDivergencia'] })
                .origemDivergencia ?? null,
          } as Lote,
        ]),
      );
    })();
    return this.storePromise;
  }

  private async flush(): Promise<void> {
    if (!this.storePromise) return;
    const store = await this.storePromise;
    await this.json.salvar(Array.from(store.values()));
  }

  async criar(lote: Lote): Promise<void> {
    const store = await this.garantirCarregado();
    store.set(lote.id, lote);
    await this.flush();
  }

  async atualizar(lote: Lote): Promise<void> {
    const store = await this.garantirCarregado();
    if (!store.has(lote.id)) {
      throw new Error(`Lote não encontrado para atualizar: ${lote.id}`);
    }
    store.set(lote.id, lote);
    await this.flush();
  }

  async porId(id: LoteId): Promise<Lote | null> {
    const store = await this.garantirCarregado();
    return store.get(id) ?? null;
  }

  async porCodigo(codigo: string): Promise<Lote | null> {
    const store = await this.garantirCarregado();
    for (const l of store.values()) {
      if (l.codigo === codigo) return l;
    }
    return null;
  }

  async listar(filtro?: LoteFiltro): Promise<Lote[]> {
    const store = await this.garantirCarregado();
    let out = Array.from(store.values());
    if (filtro?.destinoId) out = out.filter((l) => l.destinoId === filtro.destinoId);
    if (filtro?.desdeDataEnvio)
      out = out.filter((l) => l.dataEnvio >= filtro.desdeDataEnvio!);
    if (filtro?.ateDataEnvio)
      out = out.filter((l) => l.dataEnvio <= filtro.ateDataEnvio!);
    return out;
  }

  async limpar(): Promise<void> {
    const store = await this.garantirCarregado();
    store.clear();
    await this.json.limpar();
  }
}
