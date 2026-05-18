import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cliente Supabase server-side. Lê env vars no momento da primeira chamada
// (lazy) — assim, ambientes que rodam sem Supabase (PERSISTENCE_DRIVER=json,
// testes unitários) não pagam o custo nem disparam erro de env ausente.
//
// Por que SERVICE_ROLE_KEY (e nunca anon/NEXT_PUBLIC_):
//   - todo acesso ao banco passa pelo servidor (server components, server
//     actions, repos chamados via container singleton);
//   - nunca expomos o client pro browser, então a chave não vaza;
//   - service role bypassa RLS — apropriado pq nossa autorização vive na
//     camada de aplicação (auth/token + middleware), não em policies.
//
// Singleton process-local: o module-level cache (`clientCache`) sobrevive
// entre requests dentro do mesmo Lambda warm. Cada instância nova faz seu
// próprio createClient — aceitável (sem connection pool no client; o pool
// fica do lado do PgBouncer/Supavisor).

let clientCache: SupabaseClient | null = null;

function lerEnvObrigatorio(nome: string): string {
  const valor = process.env[nome];
  if (!valor || valor.trim() === '') {
    // Log estruturado pra Vercel ANTES do throw: o erro propagado vai
    // virar digest opaco na tela; o log aqui é o que o desenvolvedor
    // consulta pra entender qual env está faltando.
    console.error(
      JSON.stringify({
        event: 'supabase_env_missing',
        level: 'error',
        timestamp: new Date().toISOString(),
        env_var_faltando: nome,
        PERSISTENCE_DRIVER: process.env.PERSISTENCE_DRIVER ?? '(unset)',
        NODE_ENV: process.env.NODE_ENV ?? '(unset)',
        VERCEL_ENV: process.env.VERCEL_ENV ?? '(unset)',
      }),
    );
    throw new Error(
      `Variável de ambiente ${nome} ausente. ` +
        'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local ' +
        '(ou no painel da Vercel em produção) para usar o driver Supabase. ' +
        'Para rodar com JSON local, defina PERSISTENCE_DRIVER=json.',
    );
  }
  return valor;
}

export function getSupabaseClient(): SupabaseClient {
  if (clientCache) return clientCache;
  const url = lerEnvObrigatorio('SUPABASE_URL');
  const serviceRoleKey = lerEnvObrigatorio('SUPABASE_SERVICE_ROLE_KEY');
  clientCache = createClient(url, serviceRoleKey, {
    auth: {
      // Server-side: não há "sessão de usuário" pra persistir nem refresh
      // tokens. Desabilitar evita warnings e overhead.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return clientCache;
}

// Hook de teste: permite injetar um client específico (mock ou real
// apontando pra schema de teste). Nunca chamado em produção.
export function setSupabaseClientParaTeste(client: SupabaseClient | null): void {
  clientCache = client;
}
