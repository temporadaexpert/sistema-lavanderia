import { getContainer } from '@/infrastructure/singleton';
import type {
  PerdaMensal,
  PerdaPorItem,
  PerdaPorLote,
  PerdaPorMotivo,
  ResumoPerdas,
} from '@/application/services/RelatorioPerdaService';
import type { PeriodoResolvido } from './periodo';

export interface RelatorioPerdasDados {
  readonly resumo: ResumoPerdas;
  readonly porMotivo: PerdaPorMotivo[];
  readonly porItem: PerdaPorItem[];
  readonly porLote: PerdaPorLote[];
  readonly mensal: PerdaMensal[];
}

// Fan-out das 5 projeções em paralelo. Cada uma recalcula a partir do log
// (baixas = ajustes vinculados a lote encerrado no período) — fonte única
// de verdade. Barato in-memory; com DB vira queries agregadas.
export async function relatorioPerdas(periodo: PeriodoResolvido): Promise<RelatorioPerdasDados> {
  const c = await getContainer();
  const filtro = { desde: periodo.desde, ate: periodo.ate };
  const [resumo, porMotivo, porItem, porLote, mensal] = await Promise.all([
    c.relatorioPerda.resumo(filtro),
    c.relatorioPerda.porMotivo(filtro),
    c.relatorioPerda.porItem(filtro),
    c.relatorioPerda.porLote(filtro),
    c.relatorioPerda.mensal(filtro),
  ]);
  return { resumo, porMotivo, porItem, porLote, mensal };
}
