import { criarContainer, type Container } from './container';
import { popularSeed, ITENS, LOCAIS } from '@/mock/seed';
import type { MovimentacaoService } from '@/application/services/MovimentacaoService';
import type { LoteLavanderiaService } from '@/application/services/LoteLavanderiaService';
import type { RegistrarMovimentacaoInput } from '@/application/dto/RegistrarMovimentacaoInput';
import type { ItemId } from '@/domain/types/ids';

// Singleton do container para que o repositório in-memory sobreviva
// entre requests do Next.js (cada request é executado no mesmo processo
// Node). Chave em globalThis evita recriar em hot-reload no dev.
//
// Quando trocarmos o adapter por DB real, este módulo continua — só o
// criarContainer() passará a instanciar o repositório de banco.

const globalStore = globalThis as unknown as {
  __sistemaLavanderia_container__?: Promise<Container>;
};

type SeedMovInput = Omit<RegistrarMovimentacaoInput, 'dataHora' | 'loteId'>;

function registrarMov(svc: MovimentacaoService, dataHora: string, input: SeedMovInput) {
  return svc.registrar({ ...input, dataHora });
}

// Helper para criar lote de envio com múltiplos itens + registrar retorno
// vinculado. Mantém o seed legível e equivalente ao fluxo real do sistema.
interface SeedLinha {
  readonly itemId: ItemId;
  readonly quantidade: number;
}

async function cicloLavanderia(
  svc: LoteLavanderiaService,
  envio: {
    dataEnvio: string;
    responsavel: string;
    observacao?: string;
    itens: readonly SeedLinha[];
  },
  retorno?: {
    dataRetorno: string;
    responsavel: string;
    observacao?: string;
    itens: readonly SeedLinha[];
  },
) {
  const lote = await svc.criarEnvio({
    origemId: LOCAIS.depositoCentral,
    destinoId: LOCAIS.lavanderiaExterna,
    dataEnvio: envio.dataEnvio,
    responsavel: envio.responsavel,
    observacao: envio.observacao ?? null,
    itens: envio.itens,
  });
  if (retorno) {
    await svc.registrarRetorno({
      loteId: lote.id,
      dataRetorno: retorno.dataRetorno,
      responsavel: retorno.responsavel,
      observacao: retorno.observacao ?? null,
      itens: retorno.itens,
    });
  }
}

// Cria Category para cada nome distinto dos itens persistidos sem
// `categoriaId` (sentinela = ''), reescrevendo os itens com o id correto.
// Idempotente: itens que já têm categoriaId válido são ignorados.
async function migrarCategoriasLegacy(container: Container): Promise<void> {
  const itens = await container.itens.listar();
  const semCategoria = itens.filter((i) => !i.categoriaId);
  if (semCategoria.length === 0) return;

  for (const item of semCategoria) {
    // `item.categoria` (string legacy) deve ter sido preservado pela
    // normalização do repo. Se por algum motivo chegou vazio, usa
    // "sem categoria" como fallback pra não perder o item.
    const nomeCategoria = item.categoria?.trim() || 'Sem categoria';
    const categoria =
      await container.categoryService.obterOuCriarPorNome(nomeCategoria);
    await container.itens.atualizar({
      ...item,
      categoriaId: categoria.id,
      categoria: categoria.nome,
    });
  }
}

async function bootstrap(): Promise<Container> {
  const container = criarContainer();

  // Migração idempotente de categorias legacy: itens gravados antes do
  // Category virar entidade vinham com `categoria: string` livre. Criamos
  // uma Category pra cada nome distinto e reescrevemos os itens com o id.
  // Roda silenciosamente em todo boot — é O(itens) e não faz I/O quando
  // não há nada a migrar.
  await migrarCategoriasLegacy(container);

  // Seed de demo: só é executado quando TODAS as condições abaixo batem:
  //   1. NODE_ENV !== 'production'  (proteção primária — em produção, seed
  //      jamais roda, mesmo se o banco estiver acidentalmente vazio).
  //   2. SEED_DEMO === '1'          (opt-in explícito do dev local).
  //   3. itensPersistidos.length === 0 (não sobrescreve dados existentes).
  //
  // POR QUE ISSO IMPORTA: o seed cria categorias com nomes como 'Toalha' que
  // colidem com o índice `unique (lower(nome))` em categorias quando o banco
  // tem dados migrados ('toalha'). Em produção (Supabase) isso resultava em
  // unique violation no bootstrap, container.promise rejeitada, e páginas
  // que aterrissavam naquele Lambda recebiam erro silencioso. Categórico:
  // demo data não tem lugar em prod.
  const seedHabilitado =
    process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO === '1';
  if (!seedHabilitado) {
    return container;
  }

  const itensPersistidos = await container.itens.listar();
  if (itensPersistidos.length > 0) {
    return container;
  }

  await popularSeed(container);
  const mov = container.movimentacaoService;
  const lote = container.loteLavanderia;

  // --- Estoque inicial (janeiro): antecede qualquer envio ----------------
  const estoqueEm = '2026-01-02T08:00:00.000Z';
  await registrarMov(mov, estoqueEm, {
    itemId: ITENS.toalhaBanho,
    quantidade: 150,
    tipo: 'entrada_deposito',
    origemId: null,
    destinoId: LOCAIS.depositoCentral,
    responsavel: 'Seed inicial',
    observacao: 'Estoque de abertura',
  });
  await registrarMov(mov, estoqueEm, {
    itemId: ITENS.toalhaRosto,
    quantidade: 120,
    tipo: 'entrada_deposito',
    origemId: null,
    destinoId: LOCAIS.depositoCentral,
    responsavel: 'Seed inicial',
  });
  await registrarMov(mov, estoqueEm, {
    itemId: ITENS.lencolCasal,
    quantidade: 80,
    tipo: 'entrada_deposito',
    origemId: null,
    destinoId: LOCAIS.depositoCentral,
    responsavel: 'Seed inicial',
  });
  await registrarMov(mov, estoqueEm, {
    itemId: ITENS.froha,
    quantidade: 180,
    tipo: 'entrada_deposito',
    origemId: null,
    destinoId: LOCAIS.depositoCentral,
    responsavel: 'Seed inicial',
  });

  // --- Fevereiro/2026: dois lotes concluídos (um com perda de 1 peça) ----
  await cicloLavanderia(
    lote,
    {
      dataEnvio: '2026-02-05T10:00:00.000Z',
      responsavel: 'Ana',
      observacao: 'Lote semanal',
      itens: [{ itemId: ITENS.toalhaBanho, quantidade: 20 }],
    },
    {
      dataRetorno: '2026-02-12T16:00:00.000Z',
      responsavel: 'Ana',
      observacao: '1 toalha faltando',
      itens: [{ itemId: ITENS.toalhaBanho, quantidade: 19 }],
    },
  );

  await registrarMov(mov, '2026-02-07T09:30:00.000Z', {
    itemId: ITENS.froha,
    quantidade: 15,
    tipo: 'saida_imovel',
    origemId: LOCAIS.depositoCentral,
    destinoId: LOCAIS.imovel302,
    responsavel: 'Bruno',
  });

  await cicloLavanderia(
    lote,
    {
      dataEnvio: '2026-02-15T10:00:00.000Z',
      responsavel: 'Ana',
      itens: [{ itemId: ITENS.froha, quantidade: 25 }],
    },
    {
      dataRetorno: '2026-02-20T15:00:00.000Z',
      responsavel: 'Ana',
      itens: [{ itemId: ITENS.froha, quantidade: 25 }],
    },
  );

  await registrarMov(mov, '2026-02-28T11:00:00.000Z', {
    itemId: ITENS.lencolCasal,
    quantidade: 10,
    tipo: 'saida_imovel',
    origemId: LOCAIS.depositoCentral,
    destinoId: LOCAIS.imovel405,
    responsavel: 'Bruno',
  });

  // --- Março/2026: lote multi-item concluído com perda + lote pendente ---
  await cicloLavanderia(
    lote,
    {
      dataEnvio: '2026-03-03T09:00:00.000Z',
      responsavel: 'Ana',
      observacao: 'Rodízio semanal',
      itens: [
        { itemId: ITENS.toalhaBanho, quantidade: 30 },
        { itemId: ITENS.toalhaRosto, quantidade: 40 },
      ],
    },
    {
      dataRetorno: '2026-03-10T15:30:00.000Z',
      responsavel: 'Ana',
      observacao: 'Faltando 2 toalhas de banho e 2 de rosto',
      itens: [
        { itemId: ITENS.toalhaBanho, quantidade: 28 },
        { itemId: ITENS.toalhaRosto, quantidade: 38 },
      ],
    },
  );

  await registrarMov(mov, '2026-03-05T14:00:00.000Z', {
    itemId: ITENS.froha,
    quantidade: 15,
    tipo: 'retorno_imovel',
    origemId: LOCAIS.imovel302,
    destinoId: LOCAIS.depositoCentral,
    responsavel: 'Bruno',
  });

  await cicloLavanderia(
    lote,
    {
      dataEnvio: '2026-03-12T10:00:00.000Z',
      responsavel: 'Ana',
      itens: [
        { itemId: ITENS.lencolCasal, quantidade: 15 },
        { itemId: ITENS.froha, quantidade: 30 },
      ],
    },
    {
      dataRetorno: '2026-03-20T14:00:00.000Z',
      responsavel: 'Ana',
      observacao: '1 lençol faltando',
      itens: [
        { itemId: ITENS.lencolCasal, quantidade: 14 },
        { itemId: ITENS.froha, quantidade: 30 },
      ],
    },
  );

  await registrarMov(mov, '2026-03-30T10:00:00.000Z', {
    itemId: ITENS.toalhaBanho,
    quantidade: 20,
    tipo: 'saida_imovel',
    origemId: LOCAIS.depositoCentral,
    destinoId: LOCAIS.imovel302,
    responsavel: 'Bruno',
  });

  // --- Abril/2026 (mês corrente): mix de lotes em estados diferentes -----
  // Lote parcial: enviou 2 itens, apenas 1 voltou (e parcial)
  await cicloLavanderia(
    lote,
    {
      dataEnvio: '2026-04-05T09:00:00.000Z',
      responsavel: 'Ana',
      observacao: 'Lote grande do início do mês',
      itens: [
        { itemId: ITENS.lencolCasal, quantidade: 25 },
        { itemId: ITENS.froha, quantidade: 50 },
      ],
    },
    {
      dataRetorno: '2026-04-15T15:00:00.000Z',
      responsavel: 'Ana',
      observacao: 'Lavanderia alegou que restante vai na próxima devolução',
      itens: [
        { itemId: ITENS.lencolCasal, quantidade: 24 },
        { itemId: ITENS.froha, quantidade: 45 },
      ],
    },
  );

  // Saída operacional de imóvel
  await registrarMov(mov, '2026-04-20T10:00:00.000Z', {
    itemId: ITENS.toalhaRosto,
    quantidade: 10,
    tipo: 'saida_imovel',
    origemId: LOCAIS.depositoCentral,
    destinoId: LOCAIS.imovel405,
    responsavel: 'Bruno',
  });

  // Lote aberto (sem retorno ainda) — gestor verá pendência total no admin
  await cicloLavanderia(lote, {
    dataEnvio: '2026-04-22T09:00:00.000Z',
    responsavel: 'Ana',
    observacao: 'Ainda na lavanderia',
    itens: [{ itemId: ITENS.toalhaRosto, quantidade: 20 }],
  });

  return container;
}

export function getContainer(): Promise<Container> {
  const cached = globalStore.__sistemaLavanderia_container__;
  if (cached) return cached;
  // Captura falha de bootstrap (env vars ausentes, banco indisponível,
  // migração faltando) com contexto antes de cachear o reject. Sem isso,
  // o erro real fica escondido atrás do digest do Next.js.
  //
  // INVALIDA o cache em caso de erro: bootstrap falha em runtime (env
  // vars vêm de cache da Vercel; banco pode estar momentaneamente fora)
  // e queremos re-tentar no próximo request — não congelar a Lambda num
  // estado de erro permanente.
  const tentativa = bootstrap();
  const monitorada: Promise<Container> = tentativa.catch((err) => {
    const e = err as Error & { code?: string };
    console.error(
      JSON.stringify({
        event: 'container_bootstrap_failed',
        level: 'error',
        timestamp: new Date().toISOString(),
        errorName: e?.name ?? 'Error',
        errorMessage: e?.message ?? String(err),
        errorCode: e?.code,
        stack:
          typeof e?.stack === 'string'
            ? e.stack.split('\n').slice(0, 8).join(' | ')
            : undefined,
        env: {
          NODE_ENV: process.env.NODE_ENV ?? '(unset)',
          PERSISTENCE_DRIVER: process.env.PERSISTENCE_DRIVER ?? '(unset)',
          VERCEL_ENV: process.env.VERCEL_ENV ?? '(unset)',
          VERCEL_REGION: process.env.VERCEL_REGION ?? '(unset)',
          VERCEL_GIT_COMMIT_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 12),
        },
      }),
    );
    // Limpa o cache só se ainda apontar pra esta tentativa: próximo
    // request faz outro bootstrap em vez de cachear o reject pra sempre.
    if (globalStore.__sistemaLavanderia_container__ === monitorada) {
      globalStore.__sistemaLavanderia_container__ = undefined;
    }
    throw err;
  });
  globalStore.__sistemaLavanderia_container__ = monitorada;
  return monitorada;
}
