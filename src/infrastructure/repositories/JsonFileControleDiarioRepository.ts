import type { ControleDiarioEnxoval } from '@/domain/entities/ControleDiarioEnxoval';
import type { ControleDiarioRepository } from '@/application/ports/ControleDiarioRepository';
import { criarJsonStore, type JsonStore } from '../persistence/jsonStore';

// Mesma estratégia de concorrência dos demais adapters JsonFile: memoiza
// a promise do Map pra que chamadas paralelas compartilhem a instância.
// Fila serializada de writes vive dentro do jsonStore.
export class JsonFileControleDiarioRepository implements ControleDiarioRepository {
  private readonly json: JsonStore<ControleDiarioEnxoval>;
  private storePromise: Promise<Map<string, ControleDiarioEnxoval>> | null = null;

  constructor(nomeArquivo = 'controles-diarios.json') {
    this.json = criarJsonStore<ControleDiarioEnxoval>(nomeArquivo);
  }

  private async garantirCarregado(): Promise<Map<string, ControleDiarioEnxoval>> {
    if (this.storePromise) return this.storePromise;
    this.storePromise = (async () => {
      const registros = await this.json.carregar();
      // Dados antigos (gravados antes do reset de tipo) podem não ter os
      // novos campos de divergência. Normalizamos aqui pra evitar `undefined`
      // circulando em runtime.
      return new Map(
        registros.map((r) => [r.data, normalizar(r)] as const),
      );
    })();
    return this.storePromise;
  }

  private async flush(): Promise<void> {
    if (!this.storePromise) return;
    const store = await this.storePromise;
    await this.json.salvar(Array.from(store.values()));
  }

  async porData(data: string): Promise<ControleDiarioEnxoval | null> {
    const store = await this.garantirCarregado();
    return store.get(data) ?? null;
  }

  async salvar(controle: ControleDiarioEnxoval): Promise<void> {
    const store = await this.garantirCarregado();
    store.set(controle.data, controle);
    await this.flush();
  }

  async listar(): Promise<ControleDiarioEnxoval[]> {
    const store = await this.garantirCarregado();
    return Array.from(store.values());
  }

  async limpar(): Promise<void> {
    const store = await this.garantirCarregado();
    store.clear();
    await this.json.limpar();
  }
}

function normalizar(r: ControleDiarioEnxoval): ControleDiarioEnxoval {
  // Preenche campos novos caso venha de JSON gravado em versão anterior.
  return {
    ...r,
    responsavelFechamento:
      (r as { responsavelFechamento?: string | null }).responsavelFechamento ?? null,
    motivoDivergencia:
      (r as { motivoDivergencia?: string | null }).motivoDivergencia ?? null,
  };
}
