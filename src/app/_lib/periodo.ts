// Helper de período: converte a chave recebida via query string em
// intervalo ISO (desde/ate) e em rótulos para exibição. Centralizar aqui
// garante que todo relatório que aceite filtro use a mesma semântica.

export type PeriodoKey = 'mes-atual' | 'ultimos-30' | 'ultimos-90' | 'todos';

export const PERIODOS: readonly { key: PeriodoKey; label: string }[] = [
  { key: 'mes-atual', label: 'Mês atual' },
  { key: 'ultimos-30', label: 'Últimos 30 dias' },
  { key: 'ultimos-90', label: 'Últimos 90 dias' },
  { key: 'todos', label: 'Todos' },
];

const VALIDOS: readonly string[] = PERIODOS.map((p) => p.key);

export function parsePeriodo(raw: unknown): PeriodoKey {
  if (typeof raw === 'string' && VALIDOS.includes(raw)) return raw as PeriodoKey;
  return 'mes-atual';
}

export interface PeriodoResolvido {
  readonly key: PeriodoKey;
  readonly label: string;
  readonly desde?: string;
  readonly ate?: string;
  readonly rotuloIntervalo: string;
}

function fmtData(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function resolverPeriodo(key: PeriodoKey, agora: Date = new Date()): PeriodoResolvido {
  if (key === 'todos') {
    return { key, label: 'Todos', rotuloIntervalo: 'Todo o período registrado' };
  }

  const labelPorKey: Record<Exclude<PeriodoKey, 'todos'>, string> = {
    'mes-atual': 'Mês atual',
    'ultimos-30': 'Últimos 30 dias',
    'ultimos-90': 'Últimos 90 dias',
  };

  let inicio: Date;
  if (key === 'mes-atual') {
    inicio = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
  } else if (key === 'ultimos-30') {
    inicio = new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    inicio = new Date(agora.getTime() - 90 * 24 * 60 * 60 * 1000);
  }

  return {
    key,
    label: labelPorKey[key],
    desde: inicio.toISOString(),
    ate: agora.toISOString(),
    rotuloIntervalo: `${fmtData(inicio)} – ${fmtData(agora)}`,
  };
}
