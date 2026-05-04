import { promises as fs } from 'node:fs';
import path from 'node:path';

// Persistência em arquivo JSON para MVP. Substitui o in-memory quando o
// sistema vai pra uso real: dados sobrevivem a restart/HMR. Quando migrar
// pra banco, os repos JSON são substituídos por adapters de DB — os ports
// (ItemRepository/LocalRepository) não mudam.
//
// Formato em disco: um array JSON serializado. Leitura inteira do arquivo
// cabe em memória (cardinalidade esperada ≪ 1000 registros). Escrita é
// atômica: grava em .tmp com nome único POR CHAMADA, depois rename.
//
// ROBUSTEZ CONTRA CONCORRÊNCIA:
//  1. Cada chamada de salvar() gera um tmp único (pid + timestamp +
//     contador), evitando colisão se duas escritas ocorrerem em paralelo.
//  2. salvar() e limpar() são serializadas por arquivo via uma cadeia de
//     promises — writes nunca se interleavam. Mesmo que popularSeed chame
//     criar() em paralelo, cada repo roda suas mutações em série no disco.
//  3. mkdir(recursive) antes de cada write — cobre o caso do diretório
//     ser removido entre operações.
//  4. Em caso de falha no rename, tenta limpar o .tmp para não poluir o
//     disco com artefatos órfãos.

const DATA_DIR = path.resolve(process.cwd(), 'data');

export interface JsonStore<T> {
  carregar(): Promise<T[]>;
  salvar(registros: readonly T[]): Promise<void>;
  limpar(): Promise<void>;
}

export function criarJsonStore<T>(nomeArquivo: string): JsonStore<T> {
  const arquivo = path.join(DATA_DIR, nomeArquivo);

  // Fila serial por arquivo: mantém uma promise "cauda" e chain cada nova
  // operação depois da anterior. Resultado: ordem preservada, zero
  // overlap entre writes.
  let cauda: Promise<void> = Promise.resolve();
  let contador = 0;

  function enfileirar<R>(op: () => Promise<R>): Promise<R> {
    // Executa sempre — mesmo se a anterior falhou, para não travar a fila.
    const resultado: Promise<R> = cauda.then(op, op);
    cauda = resultado.then(
      () => undefined,
      () => undefined,
    );
    return resultado;
  }

  return {
    async carregar(): Promise<T[]> {
      // Leitura não precisa ser enfileirada porque writes são atômicos via
      // rename — leitor vê ou a versão antiga ou a nova, nunca corrompido.
      try {
        const raw = await fs.readFile(arquivo, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          console.warn(`[jsonStore] ${arquivo} não continha array — ignorando`);
          return [];
        }
        return parsed as T[];
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
    },

    salvar(registros: readonly T[]): Promise<void> {
      return enfileirar(async () => {
        // mkdir é barato quando já existe (recursive:true é idempotente).
        // Refazer a cada write cobre o caso do diretório sumir.
        await fs.mkdir(DATA_DIR, { recursive: true });

        // Tmp único por chamada: pid + timestamp + contador.
        // Mesmo se duas escritas rodassem fora da fila (bug defensivo),
        // cada uma escreveria/renomearia seu próprio tmp.
        const tmp = `${arquivo}.${process.pid}.${Date.now()}.${++contador}.tmp`;
        const json = JSON.stringify(registros, null, 2);

        await fs.writeFile(tmp, json, 'utf-8');
        try {
          await fs.rename(tmp, arquivo);
        } catch (err) {
          // Tenta limpar o tmp pra não deixar lixo. Se limpar também
          // falhar, propagamos o erro original — o tmp eventualmente vira
          // órfão mas o sistema não quebra.
          try {
            await fs.unlink(tmp);
          } catch {
            // ignore — best-effort cleanup
          }
          throw err;
        }
      });
    },

    limpar(): Promise<void> {
      return enfileirar(async () => {
        try {
          await fs.unlink(arquivo);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
      });
    },
  };
}
