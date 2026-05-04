import { getContainer } from '@/infrastructure/singleton';
import type {
  DivergenciaLote,
  ResumoDivergencias,
} from '@/application/services/DivergenciaService';
import type { EstatisticaContato } from '@/application/services/ContatoLavanderiaService';
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

// ----- Variantes enriquecidas com estatística de contato/cobrança -----

export interface DivergenciaComContato extends DivergenciaLote {
  readonly estatisticaContato: EstatisticaContato;
}

const ESTATISTICA_VAZIA: EstatisticaContato = {
  ultimo: null,
  diasDesdeUltimoContato: null,
  nuncaCobrado: true,
  promessaRetornoProxima: null,
  totalContatos: 0,
  promessaVencida: false,
  diasAtrasoPromessa: null,
  dataPromessaVencida: null,
};

export async function listarDivergenciasComContato(): Promise<DivergenciaComContato[]> {
  const c = await getContainer();
  const divergencias = await c.divergenciaService.listar();

  // Passa pendência por lote para o service de contato — garante que
  // promessas de lotes concluídos/encerrados (sem pendência real) não
  // sejam marcadas como "vencidas". Sem isso, dar entrada num retorno
  // tardio viraria "promessa vencida" pelo histórico antigo.
  const pendenciaPorLote = new Map<LoteId, number>();
  for (const d of divergencias) {
    pendenciaPorLote.set(d.lote.id, d.pendenciaEfetiva);
  }
  const mapaContato = await c.contatoLavanderiaService.mapaEstatisticaTodos({
    pendenciaPorLote,
  });

  const enriquecidas: DivergenciaComContato[] = divergencias.map((d) => ({
    ...d,
    estatisticaContato: mapaContato.get(d.lote.id) ?? ESTATISTICA_VAZIA,
  }));

  // Promessas vencidas têm prioridade máxima de exibição — vão ao topo
  // independente da classificação por tempo/valor. Restante mantém a
  // ordem original do DivergenciaService (estável via sort sem troca em
  // empate).
  enriquecidas.sort((a, b) => {
    const va = a.estatisticaContato.promessaVencida ? 1 : 0;
    const vb = b.estatisticaContato.promessaVencida ? 1 : 0;
    if (va !== vb) return vb - va;
    // Entre vencidas, maior atraso primeiro.
    if (va === 1) {
      const atA = a.estatisticaContato.diasAtrasoPromessa ?? 0;
      const atB = b.estatisticaContato.diasAtrasoPromessa ?? 0;
      return atB - atA;
    }
    return 0;
  });

  return enriquecidas;
}

export async function divergenciaPorLoteComContato(
  id: LoteId,
): Promise<DivergenciaComContato | null> {
  const c = await getContainer();
  const divergencia = await c.divergenciaService.porLoteId(id);
  if (!divergencia) return null;
  const estatistica = await c.contatoLavanderiaService.estatisticaLote(id, {
    temPendencia: divergencia.pendenciaEfetiva > 0,
  });
  return { ...divergencia, estatisticaContato: estatistica };
}
