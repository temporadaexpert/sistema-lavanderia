import { getContainer } from '@/infrastructure/singleton';
import type {
  LoteDetalhe,
  LoteResumo,
  RiscoEncerramento,
} from '@/application/services/LoteLavanderiaService';
import type { LoteId } from '@/domain/types/ids';

// Timezone da operação — bate com o usado em controleDiarioData. Garante
// que filtragem por data local não vire "amanhã" em UTC.
const TIMEZONE_OPERACAO = 'America/Sao_Paulo';

const FMT_YMD_LOCAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE_OPERACAO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dataIsoParaYmdLocal(iso: string): string {
  return FMT_YMD_LOCAL.format(new Date(iso));
}

export type FiltroStatusRomaneio = 'aberto' | 'encerrado' | 'todos';

export interface FiltroRomaneios {
  readonly dataInicial?: string; // YYYY-MM-DD
  readonly dataFinal?: string; // YYYY-MM-DD
  readonly status?: FiltroStatusRomaneio;
  readonly responsavel?: string;
}

// Filtra lotes em memória com base nos parâmetros vindos da URL. Puro
// (sem I/O) — fácil de testar e barato pra cardinalidade esperada
// (centenas de lotes/ano). Quando vier banco de verdade, esse filtro
// migra pra query SQL sem mudar a UI.
export function filtrarLotesParaRomaneio(
  lotes: readonly LoteResumo[],
  filtro: FiltroRomaneios,
): LoteResumo[] {
  const inicial = filtro.dataInicial?.trim() || null;
  const final = filtro.dataFinal?.trim() || null;
  const respNorm = filtro.responsavel?.trim().toLowerCase() || null;
  const status = filtro.status ?? 'todos';

  return lotes
    .filter((r) => {
      const dataYmd = dataIsoParaYmdLocal(r.lote.dataEnvio);
      if (inicial && dataYmd < inicial) return false;
      if (final && dataYmd > final) return false;
      if (status === 'aberto' && r.encerrado) return false;
      if (status === 'encerrado' && !r.encerrado) return false;
      if (respNorm) {
        if (!r.lote.responsavel.toLowerCase().includes(respNorm)) return false;
      }
      return true;
    })
    .sort((a, b) => b.lote.dataEnvio.localeCompare(a.lote.dataEnvio));
}

// Loaders de lotes para server components. Delegam direto ao serviço.

export async function listarLotes(): Promise<LoteResumo[]> {
  const c = await getContainer();
  return c.loteLavanderia.listar();
}

export async function listarLotesAbertos(): Promise<LoteResumo[]> {
  const c = await getContainer();
  return c.loteLavanderia.listar({ apenasAbertos: true });
}

export async function detalheLote(id: LoteId): Promise<LoteDetalhe | null> {
  const c = await getContainer();
  return c.loteLavanderia.detalhe(id);
}

export async function avaliarRiscoLote(
  id: LoteId,
): Promise<RiscoEncerramento | null> {
  const c = await getContainer();
  try {
    return await c.loteLavanderia.avaliarRiscoEncerramento(id);
  } catch {
    return null;
  }
}
