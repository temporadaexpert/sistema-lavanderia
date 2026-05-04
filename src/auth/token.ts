// Sessão administrativa — token HMAC curto e sem estado.
//
// Por que não "cookie=logado=true": seria trivial de forjar pelo usuário.
// Por que não JWT completo: overkill — não precisamos de claims, múltiplos
//   usuários, refresh tokens. Um único password → um único tipo de sessão.
// Por que Web Crypto (não node:crypto): middleware do Next.js roda em Edge
//   runtime; Web Crypto é a única API disponível nos dois runtimes.
//
// Formato do token: `<issuedAtMs>.<hmacSHA256(issuedAtMs, secret)>`
// Validação: HMAC confere + idade dentro do limite. A `secret` é o próprio
// ADMIN_PASSWORD — rotacionar a senha invalida todas as sessões de graça.

const encoder = new TextEncoder();
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 dias

async function hmacSHA256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

function toBase64Url(bytes: Uint8Array): string {
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Comparação constante de tempo. Implementada sobre strings (já que as
// assinaturas são base64url). Previne timing attack em comparações de
// token/senha.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function criarTokenSessao(secret: string): Promise<string> {
  const issuedAt = Date.now();
  const mensagem = String(issuedAt);
  const assinatura = await hmacSHA256(secret, mensagem);
  return `${mensagem}.${assinatura}`;
}

export async function validarTokenSessao(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const ponto = token.indexOf('.');
  if (ponto <= 0) return false;
  const mensagem = token.slice(0, ponto);
  const assinatura = token.slice(ponto + 1);
  const issuedAt = Number(mensagem);
  if (!Number.isFinite(issuedAt)) return false;
  const idadeSegundos = (Date.now() - issuedAt) / 1000;
  if (idadeSegundos < 0 || idadeSegundos > MAX_AGE_SECONDS) return false;
  const esperada = await hmacSHA256(secret, mensagem);
  return timingSafeEqual(esperada, assinatura);
}

export const SESSAO_MAX_AGE_SEGUNDOS = MAX_AGE_SECONDS;
export const COOKIE_NOME = 'admin_sessao';
// Sessão separada do operador. Mesmo formato (HMAC issuedAt.signature),
// mas chave HMAC é OPERADOR_PASSWORD — desacopla rotação de senha:
// trocar ADMIN_PASSWORD não invalida sessões de operador, e vice-versa.
export const COOKIE_NOME_OPERADOR = 'operador_sessao';
