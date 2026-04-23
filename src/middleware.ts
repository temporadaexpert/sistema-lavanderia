import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NOME, validarTokenSessao } from '@/auth/token';

// Middleware roda em Edge runtime. Protege exclusivamente /admin/* —
// operação (/) e /login permanecem públicos. Fail-closed: se
// ADMIN_PASSWORD não estiver configurado, redireciona para /login
// (a tela de login detecta a ausência e mostra erro).
export async function middleware(req: NextRequest) {
  const secret = process.env.ADMIN_PASSWORD;
  const token = req.cookies.get(COOKIE_NOME)?.value;
  const autenticado = !!secret && (await validarTokenSessao(token, secret));

  if (autenticado) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  // Preserva onde o usuário queria ir, para redirecionar de volta após o
  // login bem-sucedido. A action sanitiza esse valor antes de usar.
  url.searchParams.set('from', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Protege /admin e qualquer subrota (/admin/materiais, /admin/lotes-lavanderia/123…).
  // Login e operação ficam fora do matcher, seguem públicos.
  matcher: ['/admin/:path*'],
};
