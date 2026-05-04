import { getContainer } from '@/infrastructure/singleton';
import type { ContatoLavanderia } from '@/domain/entities/ContatoLavanderia';
import type { EstatisticaContato } from '@/application/services/ContatoLavanderiaService';
import type { LoteId } from '@/domain/types/ids';

export async function contatosPorLote(loteId: LoteId): Promise<ContatoLavanderia[]> {
  const c = await getContainer();
  return c.contatoLavanderiaService.porLoteId(loteId);
}

export async function estatisticaContatoLote(
  loteId: LoteId,
  opts?: { temPendencia?: boolean },
): Promise<EstatisticaContato> {
  const c = await getContainer();
  return c.contatoLavanderiaService.estatisticaLote(loteId, {
    temPendencia: opts?.temPendencia,
  });
}

export async function mapaEstatisticaContato(): Promise<Map<LoteId, EstatisticaContato>> {
  const c = await getContainer();
  return c.contatoLavanderiaService.mapaEstatisticaTodos();
}
