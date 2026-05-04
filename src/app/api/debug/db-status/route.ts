import { NextResponse, type NextRequest } from 'next/server';
import { getContainer } from '@/infrastructure/singleton';
import { timingSafeEqual } from '@/auth/token';

// Endpoint de diagnóstico read-only. Retorna o que o container REAL do
// servidor está enxergando: env vars (mascaradas), contagens das tabelas
// principais, e amostras de nomes pra confirmar de onde os dados vêm.
//
// Útil pra diagnosticar discrepâncias entre o que o Supabase mostra no SQL
// editor e o que a app exibe — geralmente env diferente, deploy stale, ou
// container poisoned em algum Lambda.
//
// SEGURANÇA: a rota /api/* não passa pelo middleware (matcher cobre só
// /admin e /operacao). Toda proteção é via `?secret=` comparado timing-safe
// contra DEBUG_SECRET.
//
//   - Se DEBUG_SECRET não estiver setado → 404 (fail-closed; nem revela
//     a existência do endpoint).
//   - Se secret query não bater → 404 (mesma resposta = não enumerável).
//   - Match → 200 com JSON.
//
// Read-only: nenhuma escrita, nenhum bootstrap-side-effect além do que
// /admin já dispara naturalmente. Não roda seed, não roda reset.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Mascaramento da URL: revela o project ref (parte identificadora,
// suficiente pra diagnosticar "qual Supabase Vercel está usando") sem
// expor protocolo completo nem qualquer eventual sufixo.
function mascarSupabaseUrl(url: string | undefined): string {
  if (!url) return '(unset)';
  const match = url.match(/^https?:\/\/([^./]+)\.supabase\.co/);
  if (match) return `${match[1]}.supabase.co`;
  // URL malformada — mostra só comprimento + 4 primeiros chars pra ajudar
  // diagnosticar truncamento ou prefixo errado, sem revelar o resto.
  return `(formato inesperado: len=${url.length}, prefixo="${url.slice(0, 4)}…")`;
}

export async function GET(req: NextRequest) {
  const expected = process.env.DEBUG_SECRET;
  if (!expected || expected.trim() === '') {
    // Sem segredo configurado, endpoint não existe — fail-closed.
    return new NextResponse('Not Found', { status: 404 });
  }

  const provided = req.nextUrl.searchParams.get('secret') ?? '';
  if (!timingSafeEqual(provided, expected)) {
    // Mesma resposta de "sem segredo" pra não revelar que o endpoint existe.
    return new NextResponse('Not Found', { status: 404 });
  }

  // Mesmo container do /admin (singleton compartilhado por request).
  const c = await getContainer();
  const [categorias, itens, locais] = await Promise.all([
    c.categorias.listar(),
    c.itens.listar(),
    c.locais.listar(),
  ]);

  const corpo = {
    env: {
      NODE_ENV: process.env.NODE_ENV ?? '(unset)',
      PERSISTENCE_DRIVER: process.env.PERSISTENCE_DRIVER ?? '(unset)',
      SUPABASE_URL: mascarSupabaseUrl(process.env.SUPABASE_URL),
      // Confirma se a service-role key está presente sem expor valor.
      SUPABASE_SERVICE_ROLE_KEY_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      SEED_DEMO: process.env.SEED_DEMO ?? '(unset)',
    },
    counts: {
      categorias: categorias.length,
      itens: itens.length,
      locais: locais.length,
    },
    samples: {
      itens: itens.slice(0, 10).map((i) => i.nome),
      locais: locais.slice(0, 10).map((l) => l.nome),
    },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(corpo, {
    // Sem cache em nenhum nível — força leitura fresca do container/banco
    // a cada request, importante pra diagnóstico.
    headers: { 'cache-control': 'no-store, no-cache, must-revalidate' },
  });
}
