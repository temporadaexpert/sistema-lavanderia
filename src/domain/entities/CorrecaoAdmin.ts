import type { ItemId, LocalId, LoteId, MovimentacaoId } from '../types/ids';

// Tipos de bloco operacional que admin pode corrigir. Mesma família dos
// 4 fluxos do dia (envio/retorno lavanderia + envio/retorno casa).
export type TipoBlocoCorrecao =
  | 'envio_lavanderia'
  | 'retorno_lavanderia'
  | 'saida_imovel'
  | 'retorno_imovel';

// Trilha de auditoria forte de uma correção administrativa. Uma linha
// por ITEM corrigido — operação com 3 itens corrigidos = 3 entradas
// compartilhando operacaoId/admin/motivo/timestamp.
//
// Por que não fazemos UPDATE destrutivo na movimentação original:
//   - movimentações são eventos imutáveis (event-sourcing).
//   - alterar quantidade contaminaria snapshot de preço já capturado.
//   - relatórios históricos teriam comportamento retroativo.
//
// Por que não fazemos só `ajuste` compensatório:
//   - ajuste de -10 não reduz `totalEnviado` do lote — ele entra em
//     `baixadoPorAjuste`. Quebra a verdade do criarEnvio.
//
// Solução: pra cada item corrigido, cancelamos a mov original (campos
// de auditoria de cancelamento preenchidos no log) e registramos uma
// mov nova com a quantidade certa, herdando origem/destino/lote/
// snapshot_preço da original. CorrecaoAdmin guarda o "antes/depois"
// estruturado pra relatório.
export interface CorrecaoAdmin {
  readonly id: string;
  readonly tipoBloco: TipoBlocoCorrecao;
  // Operação corrigida. Pode ser null APENAS pra movs antigas pré-0006
  // (sem correlação) — UI lida graciosamente nesses casos.
  readonly operacaoId: string | null;

  readonly itemId: ItemId;
  // Snapshot do nome no momento da correção. Mantém legibilidade do
  // relatório mesmo se o item for renomeado/excluído depois.
  readonly nomeItemSnapshot: string;

  // Lote OU local — só um por linha, conforme o tipoBloco. lavanderia
  // → loteId; imóvel → localId.
  readonly loteId: LoteId | null;
  readonly localId: LocalId | null;

  readonly quantidadeAnterior: number;
  readonly quantidadeNova: number;
  readonly diferenca: number; // = quantidadeNova - quantidadeAnterior (CHECK no banco)

  readonly motivo: string; // texto livre, mín. 5 chars
  readonly adminResponsavel: string;
  readonly corrigidoEm: string; // ISO timestamp

  // Trilha de evidência. Liga a entrada de auditoria às movs efetivamente
  // canceladas e às novas criadas pela correção.
  readonly movsCanceladasIds: readonly MovimentacaoId[];
  readonly movsNovasIds: readonly MovimentacaoId[];

  // Texto livre gerado pelo sistema com contexto da correção.
  readonly observacaoAutomatica: string | null;
}
