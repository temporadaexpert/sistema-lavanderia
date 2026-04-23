import { getContainer } from '@/infrastructure/singleton';
import type {
  DetalheItemLavanderia,
  ResumoLavanderia,
  ResumoMensal,
} from '@/application/services/RelatorioLavanderiaService';
import type { PeriodoResolvido } from './periodo';

export interface RelatorioLavanderiaDados {
  readonly resumo: ResumoLavanderia;
  readonly detalhes: DetalheItemLavanderia[];
  readonly mensal: ResumoMensal[];
}

// Fan-out das três projeções em paralelo. Toda a lógica de cálculo vive no
// RelatorioLavanderiaService — aqui só traduzimos o PeriodoResolvido em
// PeriodoFiltro e aguardamos as três promises.
export async function relatorioLavanderia(periodo: PeriodoResolvido): Promise<RelatorioLavanderiaDados> {
  const c = await getContainer();
  const filtro = { desde: periodo.desde, ate: periodo.ate };
  const [resumo, detalhes, mensal] = await Promise.all([
    c.relatorioLavanderia.resumo(filtro),
    c.relatorioLavanderia.detalhePorItem(filtro),
    c.relatorioLavanderia.resumoMensal(filtro),
  ]);
  return { resumo, detalhes, mensal };
}
