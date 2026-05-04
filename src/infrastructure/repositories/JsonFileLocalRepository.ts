import type { Local } from '@/domain/entities/Local';
import type { LocalId } from '@/domain/types/ids';
import type { LocalTipo } from '@/domain/types/enums';
import type { LocalRepository } from '@/application/ports/LocalRepository';
import { criarJsonStore, type JsonStore } from '../persistence/jsonStore';

// Mesma estratégia de concorrência do JsonFileItemRepository: memoiza a
// promise do Map pra que chamadas paralelas compartilhem a mesma instância.
export class JsonFileLocalRepository implements LocalRepository {
  private readonly json: JsonStore<Local>;
  private storePromise: Promise<Map<LocalId, Local>> | null = null;

  constructor(nomeArquivo = 'locais.json') {
    this.json = criarJsonStore<Local>(nomeArquivo);
  }

  private async garantirCarregado(): Promise<Map<LocalId, Local>> {
    if (this.storePromise) return this.storePromise;
    this.storePromise = (async () => {
      const registros = await this.json.carregar();
      return new Map(registros.map((l) => [l.id, l]));
    })();
    return this.storePromise;
  }

  private async flush(): Promise<void> {
    if (!this.storePromise) return;
    const store = await this.storePromise;
    await this.json.salvar(Array.from(store.values()));
  }

  async criar(local: Local): Promise<void> {
    const store = await this.garantirCarregado();
    store.set(local.id, local);
    await this.flush();
  }

  async atualizar(local: Local): Promise<void> {
    const store = await this.garantirCarregado();
    if (!store.has(local.id)) {
      throw new Error(`Local não encontrado para atualizar: ${local.id}`);
    }
    store.set(local.id, local);
    await this.flush();
  }

  async porId(id: LocalId): Promise<Local | null> {
    const store = await this.garantirCarregado();
    return store.get(id) ?? null;
  }

  async listar(opts?: { tipo?: LocalTipo; apenasAtivos?: boolean }): Promise<Local[]> {
    const store = await this.garantirCarregado();
    let out = Array.from(store.values());
    if (opts?.tipo) out = out.filter((l) => l.tipo === opts.tipo);
    if (opts?.apenasAtivos) out = out.filter((l) => l.ativo);
    return out;
  }
}
