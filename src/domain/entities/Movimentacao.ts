import type { ItemId, LocalId, LoteId, MovimentacaoId } from '../types/ids';
import type { MovimentacaoTipo } from '../types/enums';

// Movimentação é um evento imutável (append-only). Depois de registrada,
// não se edita nem se apaga — correções se fazem via novo lançamento
// (tipo 'ajuste'). Isso preserva a trilha de auditoria.
//
// loteId: liga a movimentação a uma remessa/lote de lavanderia. É opcional
// porque só faz sentido para tipos envio_lavanderia e retorno_lavanderia —
// a validação disso vive na regra do tipo (REGRAS_MOVIMENTACAO.permiteLote)
// e no MovimentacaoService.
//
// precoUnitarioSnapshot: preço do item no momento do registro, congelado
// em copy-on-write. Capturado automaticamente pelo MovimentacaoService para
// tipos relevantes (REGRAS_MOVIMENTACAO.capturaSnapshotPreco = true).
// Relatórios históricos devem preferir esse valor ao Item.valorUnitario
// atual, blindando o histórico contra reajustes de cadastro. Null significa:
// ou (a) movimentação é de tipo que não captura preço, ou (b) item estava
// sem valorUnitario cadastrado no momento do registro, ou (c) dado legado
// anterior à introdução do snapshot — os dois últimos tratados com fallback
// para o valorUnitario atual do item nos relatórios.
// Campos de cancelamento: uma movimentação pode ser marcada como cancelada
// por ação administrativa quando o operador registrou errado. Os campos
// originais (tipo/quantidade/data/itemId/…) NUNCA são alterados — isso
// preserva a trilha de auditoria. Consumidores de projeção (saldo,
// relatórios, dashboard) ignoram canceladas por padrão (via filtro do
// repositório); o histórico na UI mostra canceladas riscadas com o motivo.
// `conciliado`: marca se a movimentação está pareada com um envio/registro
// que a justifique. Default true — quase todas as movs são conciliadas
// (entradas, saídas, retornos vinculados a lote, ajustes manuais
// auditados). Recebe `false` apenas no canal "excedente operacional não
// conciliado" do recebimento de lavanderia: quando o operador devolve
// mais peças do que a soma das pendências abertas e o sistema não
// consegue parear o excedente com nenhum envio rastreado. Permite que
// admin filtre `WHERE conciliado=false` pra investigar sobras inexplicadas
// sem precisar varrer texto livre de observação.
export interface Movimentacao {
  readonly id: MovimentacaoId;
  readonly dataHora: string;
  readonly itemId: ItemId;
  readonly quantidade: number;
  readonly tipo: MovimentacaoTipo;
  readonly origemId: LocalId | null;
  readonly destinoId: LocalId | null;
  readonly responsavel: string;
  readonly observacao: string | null;
  readonly loteId: LoteId | null;
  readonly precoUnitarioSnapshot: number | null;
  readonly registradoEm: string;
  readonly cancelada: boolean;
  readonly canceladoEm: string | null;
  readonly canceladoPor: string | null;
  readonly motivoCancelamento: string | null;
  readonly conciliado: boolean;
  // Correlaciona movs criadas pela MESMA operação de UI (1 envio de lote
  // gera N movs com mesmo operacaoId; 1 recebimento de lote pode gerar
  // M movs cross-lote + excedente, todas com mesmo operacaoId). Permite
  // que CorrecaoAdminService cancele/re-execute uma operação inteira
  // como unidade. Movs anteriores à migration 0006 ficam com null.
  readonly operacaoId: string | null;
}
