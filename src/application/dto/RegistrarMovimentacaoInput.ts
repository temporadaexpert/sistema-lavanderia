import type { ItemId, LocalId, LoteId } from '@/domain/types/ids';
import type { MovimentacaoTipo } from '@/domain/types/enums';

export interface RegistrarMovimentacaoInput {
  readonly itemId: ItemId;
  readonly quantidade: number;
  readonly tipo: MovimentacaoTipo;
  readonly origemId: LocalId | null;
  readonly destinoId: LocalId | null;
  readonly responsavel: string;
  readonly observacao?: string | null;
  readonly dataHora?: string;
  readonly loteId?: LoteId | null;
  // Default true. Passar false APENAS no canal "excedente operacional
  // não conciliado" do recebimento de lavanderia (ver
  // LoteLavanderiaService.registrarRetornoEFinalizar). Exposto no DTO
  // pra forçar o caller a ser explícito quando estiver criando uma mov
  // não-conciliada — não é algo que deva acontecer por descuido.
  readonly conciliado?: boolean;
  // Correlação com a operação de UI que criou esta mov. Quando passado,
  // todas as movs da mesma operação compartilham o id — habilita
  // correção administrativa de operações multi-mov (ex.: retorno
  // cross-lote). Movs avulsas/legacy continuam funcionando com null.
  readonly operacaoId?: string | null;
  // Override do snapshot de preço. USO EXCLUSIVO da camada de correção
  // administrativa (CorrecaoAdminService): ao re-registrar uma mov pra
  // substituir uma cancelada, herdamos o snapshot original em vez de
  // capturar o preço atual — preserva o contexto financeiro histórico
  // (impostômetro, custo, margem). Se ausente, o service segue o fluxo
  // padrão (captura conforme a regra do tipo).
  readonly precoUnitarioSnapshotOverride?: number | null;
}
