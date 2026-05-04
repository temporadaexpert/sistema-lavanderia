import { getContainer } from '@/infrastructure/singleton';
import type { ControleDiarioEnxoval } from '@/domain/entities/ControleDiarioEnxoval';
import type {
  DivergenciaDiaria,
  LinhaDivergenciaDiaria,
  ResumoDashboardControle,
} from '@/application/services/ControleDiarioService';

// Loaders para server components do controle diário de enxoval.

export async function obterControleDoDia(
  data: string,
): Promise<ControleDiarioEnxoval | null> {
  const c = await getContainer();
  return c.controleDiario.obterPorData(data);
}

export async function divergenciaDoDia(
  data: string,
): Promise<DivergenciaDiaria | null> {
  const c = await getContainer();
  return c.controleDiario.calcularDivergencia(data);
}

export async function resumoControleDiario(): Promise<ResumoDashboardControle | null> {
  const c = await getContainer();
  return c.controleDiario.resumoDashboard();
}

// Timezone da operação — explícito pra garantir que "hoje" seja o mesmo
// dia que a funcionária está enxergando, independente do fuso do servidor
// (Vercel/container pode rodar em UTC). Brasil não tem horário de verão
// desde 2019, então America/Sao_Paulo é UTC-3 estável.
const TIMEZONE_OPERACAO = 'America/Sao_Paulo';

// Data "hoje" (YYYY-MM-DD) no fuso da operação. Sem essa normalização, um
// envio registrado às 22h em São Paulo (01h UTC do dia seguinte) viraria
// "amanhã" na leitura do admin — o que geraria incoerências na listagem e
// ativaria errado a trava de "dia anterior aberto".
export function hojeISO(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE_OPERACAO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA usa formato YYYY-MM-DD nativamente; não precisa juntar peças.
  return fmt.format(new Date());
}

export async function listarDivergenciasDiarias(opts?: {
  apenasFechados?: boolean;
}): Promise<LinhaDivergenciaDiaria[]> {
  const c = await getContainer();
  return c.controleDiario.listarDivergencias(opts);
}

// Dias ESTRITAMENTE anteriores a `dataReferencia` que ainda estão abertos
// e com conteúdo. A home /operacao consome isso para bloquear o início
// de um novo dia enquanto o anterior não é fechado.
export async function listarDiasAbertosAnteriores(
  dataReferencia: string,
): Promise<ControleDiarioEnxoval[]> {
  const c = await getContainer();
  return c.controleDiario.listarDiasAbertosAnteriores(dataReferencia);
}
