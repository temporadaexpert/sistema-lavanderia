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

// Fingerprint da chave: primeiros 10 chars + comprimento total. Distingue
// JWT clássico (eyJ…, ~220 chars) vs novo formato (sb_secret_…, ~41 chars)
// vs anon key acidentalmente colada. Não expõe a chave útil pra atacante.
function mascarKey(key: string | undefined): string {
  if (!key) return '(unset)';
  return `${key.slice(0, 10)}… (len=${key.length})`;
}

// Assinatura "test residue vs migração real". Se todos os locais têm tipo
// 'deposito' ou 'lavanderia' (nenhum 'imovel'), é o seed de teste. Se há
// dezenas de 'imovel', é a migração real (tinha 35).
function classificarLocais(tipos: string[]): {
  total: number;
  deposito: number;
  imovel: number;
  lavanderia: number;
  parece_residuo_de_teste: boolean;
} {
  const c = { deposito: 0, imovel: 0, lavanderia: 0 };
  for (const t of tipos) {
    if (t === 'deposito' || t === 'imovel' || t === 'lavanderia') c[t]++;
  }
  return {
    total: tipos.length,
    ...c,
    // Heurística: residual de teste tem apenas deposito + lavanderia (1 de cada),
    // sem nenhum imovel. Migração real tem 35 imoveis + 1 deposito + 1 lavanderia.
    parece_residuo_de_teste: c.imovel === 0 && tipos.length <= 3,
  };
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

  // "Maior criadoEm" indica quando a tabela foi populada pela última vez.
  // Se for muito recente (horas atrás), aponta pra escrita acidental
  // — provavelmente teste de integração rodou contra esta URL.
  const maxCriadoEm = (rows: Array<{ criadoEm: string }>): string | null => {
    if (rows.length === 0) return null;
    return rows
      .map((r) => r.criadoEm)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  };

  const corpo = {
    env: {
      NODE_ENV: process.env.NODE_ENV ?? '(unset)',
      PERSISTENCE_DRIVER: process.env.PERSISTENCE_DRIVER ?? '(unset)',
      SUPABASE_URL: mascarSupabaseUrl(process.env.SUPABASE_URL),
      // Fingerprint da key (primeiros 10 chars + comprimento). Permite
      // ao usuário cruzar com o que ele tem no .env.local.
      SUPABASE_SERVICE_ROLE_KEY_fingerprint: mascarKey(
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      ),
      SEED_DEMO: process.env.SEED_DEMO ?? '(unset)',
    },
    // Build/deploy fingerprint — Vercel popula essas envs automaticamente.
    // Permite confirmar QUAL commit está rodando em produção, sem ambiguidade.
    deploy: {
      VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? '(unset)',
      VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF ?? '(unset)',
      VERCEL_GIT_COMMIT_MESSAGE:
        process.env.VERCEL_GIT_COMMIT_MESSAGE?.slice(0, 80) ?? '(unset)',
      VERCEL_ENV: process.env.VERCEL_ENV ?? '(unset)',
      VERCEL_REGION: process.env.VERCEL_REGION ?? '(unset)',
    },
    // Flag que prova se o build TEM o fluxo novo de divergência.
    // Sem ele, a aplicação está numa versão que não conhece o modal.
    feature_flags: {
      tem_fluxo_divergencia_unificado: true, // hard-coded no commit 721e165+
    },
    counts: {
      categorias: categorias.length,
      itens: itens.length,
      locais: locais.length,
    },
    // Distribuição por tipo nos locais — distingue residue de teste (só
    // deposito+lavanderia) vs migração real (35 imovel + 1 deposito + 1
    // lavanderia).
    locais_por_tipo: classificarLocais(locais.map((l) => l.tipo)),
    samples: {
      itens: itens.slice(0, 10).map((i) => ({
        nome: i.nome,
        ativo: i.ativo,
        categoria: i.categoria,
      })),
      locais: locais.slice(0, 10).map((l) => ({
        nome: l.nome,
        tipo: l.tipo,
        ativo: l.ativo,
      })),
      categorias: categorias.slice(0, 10).map((c) => c.nome),
    },
    // Timestamp do registro mais novo em cada tabela. Útil pra detectar
    // escrita recente (ex.: tudo populado nas últimas horas → suspeita
    // forte de teste de integração rodando contra esta URL).
    ultimas_escritas: {
      categorias: maxCriadoEm(categorias),
      itens: maxCriadoEm(itens),
      locais: maxCriadoEm(locais),
    },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(corpo, {
    // Sem cache em nenhum nível — força leitura fresca do container/banco
    // a cada request, importante pra diagnóstico.
    headers: { 'cache-control': 'no-store, no-cache, must-revalidate' },
  });
}
