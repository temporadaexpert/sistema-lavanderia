'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  COOKIE_NOME,
  SESSAO_MAX_AGE_SEGUNDOS,
  criarTokenSessao,
  timingSafeEqual,
} from '@/auth/token';

// Sanitiza o parâmetro `from` vindo da query string. Evita open redirect
// (ex.: ?from=//evil.com) — só aceita caminhos internos que comecem com
// /admin. Qualquer coisa suspeita cai para o dashboard.
function sanitizarFrom(raw: unknown): string {
  if (typeof raw !== 'string') return '/admin';
  if (!raw.startsWith('/admin')) return '/admin';
  if (raw.includes('//') || raw.includes('\\')) return '/admin';
  return raw;
}

export async function loginAction(formData: FormData): Promise<void> {
  const senha = String(formData.get('senha') ?? '');
  const from = sanitizarFrom(formData.get('from'));
  const esperada = process.env.ADMIN_PASSWORD;

  if (!esperada) {
    // Sistema não configurado — não dá pra autenticar ninguém. Mostra erro
    // específico para que o gestor configure a variável.
    redirect('/login?error=config');
  }

  // Comparação timing-safe: nunca `senha === esperada` diretamente.
  if (!timingSafeEqual(senha, esperada)) {
    redirect('/login?error=invalid');
  }

  const token = await criarTokenSessao(esperada);
  cookies().set(COOKIE_NOME, token, {
    httpOnly: true, // inacessível ao JS do cliente → mitiga XSS
    secure: process.env.NODE_ENV === 'production', // HTTPS only em produção
    sameSite: 'lax', // envia em navegações top-level; bloqueia CSRF cross-site
    path: '/',
    maxAge: SESSAO_MAX_AGE_SEGUNDOS,
  });

  redirect(from);
}

export async function logoutAction(): Promise<void> {
  cookies().delete(COOKIE_NOME);
  redirect('/login');
}
