import type { Item } from '@/domain/entities/Item';
import { CategoryId, type ItemId } from '@/domain/types/ids';
import type { ItemRepository } from '@/application/ports/ItemRepository';
import { criarJsonStore, type JsonStore } from '../persistence/jsonStore';

// Adapter JSON-file do ItemRepository. Semântica idêntica ao in-memory,
// mais I/O: lazy-load no primeiro acesso, flush atômico a cada mutação.
//
// CONCORRÊNCIA: `garantirCarregado` memoiza a PROMISE do Map (não o
// resultado), garantindo que múltiplas chamadas paralelas compartilhem
// a mesma instância de Map. Sem isso, cada caller criaria seu próprio
// Map e sobrescreveria mutações das outras — foi o bug que causava
// perda de registros ao cadastrar em paralelo.
//
// Writes: encaminhados pro jsonStore que tem fila serializada por
// arquivo, garantindo que rename de .tmp nunca colida.
export class JsonFileItemRepository implements ItemRepository {
  private readonly json: JsonStore<Item>;
  private storePromise: Promise<Map<ItemId, Item>> | null = null;

  constructor(nomeArquivo = 'itens.json') {
    this.json = criarJsonStore<Item>(nomeArquivo);
  }

  private async garantirCarregado(): Promise<Map<ItemId, Item>> {
    if (this.storePromise) return this.storePromise;
    this.storePromise = (async () => {
      const registros = await this.json.carregar();
      // Normalização de dados legacy. Arquivos JSON antigos podem faltar:
      //   - `estoqueTotal` (versão anterior a 2026-04)
      //   - `categoriaId` (versão anterior à refatoração de Category)
      // Em ambos os casos injetamos valores seguros:
      //   - estoqueTotal: null (sem limite de inventário)
      //   - categoriaId: string vazia como sentinela (branded). O boostrap
      //     detecta e executa a migração real (cria Category a partir do
      //     campo legado `categoria` e atualiza o item). Até lá, o item
      //     continua legível na listagem.
      return new Map(
        registros.map((i) => [
          i.id,
          {
            ...i,
            estoqueTotal:
              (i as { estoqueTotal?: number | null }).estoqueTotal ?? null,
            categoriaId:
              (i as { categoriaId?: string }).categoriaId
                ? CategoryId((i as { categoriaId?: string }).categoriaId!)
                : CategoryId(''),
            categoria: (i as { categoria?: string }).categoria ?? '',
          } as Item,
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

  async criar(item: Item): Promise<void> {
    const store = await this.garantirCarregado();
    store.set(item.id, item);
    await this.flush();
  }

  async atualizar(item: Item): Promise<void> {
    const store = await this.garantirCarregado();
    if (!store.has(item.id)) {
      throw new Error(`Item não encontrado para atualizar: ${item.id}`);
    }
    store.set(item.id, item);
    await this.flush();
  }

  async porId(id: ItemId): Promise<Item | null> {
    const store = await this.garantirCarregado();
    return store.get(id) ?? null;
  }

  async listar(opts?: { apenasAtivos?: boolean }): Promise<Item[]> {
    const store = await this.garantirCarregado();
    const todos = Array.from(store.values());
    return opts?.apenasAtivos ? todos.filter((i) => i.ativo) : todos;
  }
}
