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
}
