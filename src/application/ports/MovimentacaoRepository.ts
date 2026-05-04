import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { ItemId, LocalId, LoteId, MovimentacaoId } from '@/domain/types/ids';
import type { MovimentacaoTipo } from '@/domain/types/enums';

export interface MovimentacaoFiltro {
  readonly itemId?: ItemId;
  readonly localId?: LocalId;
  readonly tipo?: MovimentacaoTipo;
  readonly ateDataHora?: string;
  readonly desdeDataHora?: string;
  readonly loteId?: LoteId;
  // Por padrão canceladas ficam de fora — blindando todos os consumidores
  // de projeção (saldo, relatórios, dashboard) sem mudar cada chamador.
  // Histórico da UI passa `true` para mostrar canceladas riscadas.
  readonly incluirCanceladas?: boolean;
}

// Patch aplicado ao marcar uma movimentação como cancelada. NUNCA altera
// tipo/quantidade/data/itemId/etc. — só esses quatro campos de auditoria.
export interface CancelamentoPatch {
  readonly canceladoEm: string;
  readonly canceladoPor: string;
  readonly motivoCancelamento: string;
}

export interface MovimentacaoRepository {
  registrar(mov: Movimentacao): Promise<void>;
  listar(filtro?: MovimentacaoFiltro): Promise<Movimentacao[]>;
  porId(id: MovimentacaoId): Promise<Movimentacao | null>;
  // Mutação controlada: só pode aplicar patch de cancelamento, e só em
  // movimentações não canceladas. Se já estava cancelada, o repositório
  // rejeita pra deixar o erro o mais cedo possível na stack.
  marcarCancelada(id: MovimentacaoId, patch: CancelamentoPatch): Promise<void>;
  // Operação administrativa: zera o log. Faz parte do contrato porque
  // quando migrarmos pra DB real, o adapter vai disparar um DELETE/TRUNCATE
  // dentro de transação — mesma semântica, mesma interface.
  limpar(): Promise<void>;
}
