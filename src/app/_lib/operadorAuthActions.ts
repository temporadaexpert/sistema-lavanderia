'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  COOKIE_NOME_OPERADOR,
  SESSAO_MAX_AGE_SEGUNDOS,
  criarTokenSessao,
  timingSafeEqual,
} from '@/auth/token';

// Sanitiza o `from` vindo do middleware. Anti open-redirect: só aceita
// caminhos internos que comecem com /operacao. Qualquer coisa suspeita
// (URL absoluta, protocolo, traversal) cai pro home da operação.
function sanitizarFrom(raw: unknown): string {
  if (typeof raw !== 'string') return '/operacao';
  if (!raw.startsWith('/operacao')) return '/operacao';
  if (raw.includes('//') || raw.includes('\\')) return '/operacao';
  // Evita loop: se o `from` apontar de volta pra /operacao/login, redireciona
  // pro home — caso típico depois de um logout que tente preservar contexto.
  if (raw === '/operacao/login' || raw.startsWith('/operacao/login?')) {
    return '/operacao';
  }
  return raw;
}

export async function loginOperadorAction(formData: FormData): Promise<void> {
  const senha = String(formData.get('senha') ?? '');
  const from = sanitizarFrom(formData.get('from'));
  const esperada = process.env.OPERADOR_PASSWORD;

  if (!esperada) {
    // Sistema não configurado: trata como erro de config explícito pra
    // que o gestor perceba e configure a env var.
    redirect('/operacao/login?error=config');
  }

  // Comparação timing-safe — nunca `senha === esperada`.
  if (!timingSafeEqual(senha, esperada)) {
    redirect('/operacao/login?error=invalid');
  }

  const token = await criarTokenSessao(esperada);
  cookies().set(COOKIE_NOME_OPERADOR, token, {
    httpOnly: true, // inacessível ao JS do cliente — mitiga XSS
    secure: process.env.NODE_ENV === 'production', // HTTPS only em prod
    sameSite: 'lax', // envia em navegação top-level; bloqueia CSRF cross-site
    path: '/',
    maxAge: SESSAO_MAX_AGE_SEGUNDOS,
  });

  redirect(from);
}

export async function logoutOperadorAction(): Promise<void> {
  cookies().delete(COOKIE_NOME_OPERADOR);
  redirect('/operacao/login');
}
