import { NextResponse, type NextRequest } from 'next/server';
import {
  COOKIE_NOME,
  COOKIE_NOME_OPERADOR,
  validarTokenSessao,
} from '@/auth/token';

// Middleware roda em Edge runtime. Protege duas áreas com sessões
// independentes:
//   /admin/*    → ADMIN_PASSWORD, cookie admin_sessao,    redireciona /login
//   /operacao/* → OPERADOR_PASSWORD, cookie operador_sessao, redireciona /operacao/login
// /operacao/login é pública (a tela de login NÃO pode estar atrás do gate
// que ela serve pra abrir).
//
// Fail-closed: se a env var de senha não estiver configurada, o middleware
// trata como não-autenticado e manda pro login (o login detecta e mostra
// erro de config, ajudando o gestor a perceber a falha rápido).

interface Area {
  readonly secret: string | undefined;
  readonly cookie: string;
  readonly loginUrl: string;
}

async function verificar(req: NextRequest, area: Area): Promise<NextResponse> {
  const token = req.cookies.get(area.cookie)?.value;
  const autenticado = !!area.secret && (await validarTokenSessao(token, area.secret));
  if (autenticado) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = area.loginUrl;
  // Preserva onde o usuário queria ir, pra redirecionar de volta após
  // o login bem-sucedido. A action sanitiza esse valor antes de usar
  // (anti open-redirect).
  url.searchParams.set('from', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Login do operador é público — não pode estar atrás do gate que ela abre.
  if (pathname === '/operacao/login') {
    return NextResponse.next();
  }

  if (pathname.startsWith('/admin')) {
    return verificar(req, {
      secret: process.env.ADMIN_PASSWORD,
      cookie: COOKIE_NOME,
      loginUrl: '/login',
    });
  }

  if (pathname.startsWith('/operacao')) {
    return verificar(req, {
      secret: process.env.OPERADOR_PASSWORD,
      cookie: COOKIE_NOME_OPERADOR,
      loginUrl: '/operacao/login',
    });
  }

  return NextResponse.next();
}

export const config = {
  // Protege /admin e /operacao (excluindo /operacao/login, tratado dentro
  // da função acima). Login admin (/login) e rotas públicas (/, /romaneio,
  // assets) ficam fora do matcher.
  matcher: ['/admin/:path*', '/operacao/:path*'],
};
