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

// Loga um erro com contexto e re-lança. Use em volta de loaders que podem
// estourar — o re-throw mantém o comportamento do server component (que
// vira error.tsx); o log dá rastro pra debugar via Vercel.
export async function comLog<T>(
  contexto: ContextoBase,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = err as Error & { code?: string; cause?: unknown };
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
        stack: typeof e?.stack === 'string'
          ? e.stack.split('\n').slice(0, 8).join(' | ')
          : undefined,
        env: fingerprintAmbiente(),
      }),
    );
    throw err;
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
