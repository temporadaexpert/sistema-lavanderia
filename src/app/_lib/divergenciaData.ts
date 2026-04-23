import { getContainer } from '@/infrastructure/singleton';
import type {
  DivergenciaLote,
  ResumoDivergencias,
} from '@/application/services/DivergenciaService';
import type { LoteId } from '@/domain/types/ids';

export async function listarDivergencias(): Promise<DivergenciaLote[]> {
  const c = await getContainer();
  return c.divergenciaService.listar();
}

export async function divergenciaPorLote(id: LoteId): Promise<DivergenciaLote | null> {
  const c = await getContainer();
  return c.divergenciaService.porLoteId(id);
}

export async function resumoDivergencias(): Promise<ResumoDivergencias> {
  const c = await getContainer();
  return c.divergenciaService.resumoAlertas();
}
