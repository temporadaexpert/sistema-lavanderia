import type { LocalId, LoteId } from '../types/ids';
import type { MotivoFechamento, OrigemDivergencia } from '../types/enums';

// Lote (remessa) de lavanderia. É o "cabeçalho" do envio: identidade,
// quem enviou, para onde, quando e observação geral. As QUANTIDADES
// (enviadas, retornadas, pendentes) NÃO ficam aqui — continuam sendo
// derivadas das movimentações vinculadas via Movimentacao.loteId.
//
// Essa escolha preserva o invariante central do sistema: o log de
// movimentações é a fonte única de verdade do saldo. O Lote só adiciona
// contexto de agrupamento e metadados que não cabem por-movimentação.
//
// Campos de encerramento: quando preenchidos, indicam que o gestor aceitou
// baixar a pendência. O encerramento NÃO apaga nem altera movimentações
// anteriores — ele apenas registra a decisão administrativa + gera novos
// lançamentos de ajuste (no service) reduzindo o saldo da lavanderia na
// quantidade pendente. O log continua imutável.
//
// Hooks deliberados para evolução futura:
//   - compensaLoteId → permitir que um retorno "quite" uma pendência de
//     lote anterior. Preferimos introduzir quando houver caso real.
export interface Lote {
  readonly id: LoteId;
  readonly codigo: string;
  readonly criadoEm: string;
  readonly dataEnvio: string;
  readonly origemId: LocalId;
  readonly destinoId: LocalId;
  readonly responsavel: string;
  readonly observacao: string | null;
  readonly encerradoEm: string | null;
  readonly encerradoPor: string | null;
  readonly motivoFechamento: MotivoFechamento | null;
  readonly motivoDescricao: string | null;
  // Origem provável da pendência — coletada do operador no modal de
  // classificação ao concluir retorno com divergência. Permite relatórios
  // agrupados (lavanderia vs imóvel vs operação interna). Sempre null em
  // lotes sem encerramento; quando o lote é fechado, vira não-null
  // exceto se a classificação foi `retorno_parcial` (que não fecha).
  readonly origemDivergencia: OrigemDivergencia | null;
}
