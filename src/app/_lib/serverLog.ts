// Logger estruturado server-side. Imprime UMA linha JSON por chamada, com
// campos previsíveis — fácil de filtrar no painel da Vercel (Logs →
// search por `event=...`).
//
// REGRAS DE OURO:
//   - NUNCA logar senha, token, service-role key, cookie, ou conteúdo de
//     `process.env` cru. Os campos abaixo mascaram explicitamente.
//   - Nunca logar entidade inteira (movimentação/lote) — só ids e contagens,
//     porque o log pode acabar indexado por terceiros e dados operacionais
//     do cliente não devem vazar pra logs imutáveis.

interface ContextoBase {
  readonly event: string;
  readonly rota?: string;
  readonly loader?: string;
}

interface FingerprintAmbiente {
  readonly NODE_ENV: string;
  readonly PERSISTENCE_DRIVER: string;
  readonly SUPABASE_URL_host: string;
  readonly SUPABASE_KEY_len: number;
  readonly VERCEL_ENV: string;
  readonly VERCEL_REGION: string;
  readonly VERCEL_GIT_COMMIT_SHA: string;
}

// Snapshot de ambiente sem segredo — host do Supabase (project ref) +
// comprimento da chave (suficiente pra distinguir tipos de chave sem
// vazar valor). Vercel popula as VERCEL_* automaticamente.
export function fingerprintAmbiente(): FingerprintAmbiente {
  const url = process.env.SUPABASE_URL ?? '';
  const match = url.match(/^https?:\/\/([^./]+)\.supabase\.co/);
  return {
    NODE_ENV: process.env.NODE_ENV ?? '(unset)',
    PERSISTENCE_DRIVER: process.env.PERSISTENCE_DRIVER ?? '(unset)',
    SUPABASE_URL_host: match?.[1] ?? (url ? '(formato inesperado)' : '(unset)'),
    SUPABASE_KEY_len: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').length,
    VERCEL_ENV: process.env.VERCEL_ENV ?? '(unset)',
    VERCEL_REGION: process.env.VERCEL_REGION ?? '(unset)',
    VERCEL_GIT_COMMIT_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 12),
  };
}

function logErro(contexto: ContextoBase, err: unknown): void {
  const e = err as Error & { code?: string };
  // JSON.stringify pra manter UMA linha por erro — facilita grep no
  // painel da Vercel.
  console.error(
    JSON.stringify({
      ...contexto,
      level: 'error',
      timestamp: new Date().toISOString(),
      errorName: e?.name ?? 'Error',
      errorMessage: e?.message ?? String(err),
      errorCode: e?.code,
      // Stack só os 8 primeiros frames — suficiente pra localizar o
      // ponto sem inflar o log.
      stack:
        typeof e?.stack === 'string'
          ? e.stack.split('\n').slice(0, 8).join(' | ')
          : undefined,
      env: fingerprintAmbiente(),
    }),
  );
}

// Loga um erro com contexto e re-lança. Use em volta de loaders CRÍTICOS —
// loaders que se falharem a página não tem como renderizar nada útil.
// O re-throw faz cair pro error.tsx do segmento (tela amigável).
export async function comLog<T>(
  contexto: ContextoBase,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    logErro(contexto, err);
    throw err;
  }
}

// Resultado de um loader resiliente. `ok=true` quando passou; `ok=false`
// quando falhou (com `fallback` aplicado). UI consulta `ok` pra decidir
// se mostra dado real ou estado degradado (com aviso "indisponível").
export type Resiliente<T> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly valor: T; readonly erro: string };

// Loga erro e devolve `fallback`. Use em volta de loaders NÃO-CRÍTICOS —
// loaders que se falharem a página ainda é utilizável (banner, alerta,
// stat, badge). Mantém a operação acessível mesmo com 1+ tabelas fora.
//
// O retorno carrega `ok` pra UI sinalizar "este bloco está indisponível"
// — diferente de "está vazio" (ambos seriam visualmente parecidos sem
// essa distinção, e o operador precisa saber se confia ou não nos zeros).
export async function comLogSafe<T>(
  contexto: ContextoBase,
  fn: () => Promise<T>,
  fallback: T,
): Promise<Resiliente<T>> {
  try {
    const valor = await fn();
    return { ok: true, valor };
  } catch (err) {
    logErro(contexto, err);
    const e = err as Error;
    return { ok: false, valor: fallback, erro: e?.message ?? String(err) };
  }
}

// Log informacional (não-erro). Útil pra anotar transições (ex.: container
// boot OK, supabase client criado, etc.). Usar com moderação — só em pontos
// de inflexão, nunca em hot path.
export function logInfo(contexto: ContextoBase & Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      ...contexto,
      level: 'info',
      timestamp: new Date().toISOString(),
    }),
  );
}
