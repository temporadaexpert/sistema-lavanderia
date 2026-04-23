import { getContainer } from '@/infrastructure/singleton';
import type {
  LoteDetalhe,
  LoteResumo,
} from '@/application/services/LoteLavanderiaService';
import type { LoteId } from '@/domain/types/ids';

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
