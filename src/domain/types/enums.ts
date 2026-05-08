export const LOCAL_TIPOS = ['deposito', 'imovel', 'lavanderia'] as const;
export type LocalTipo = (typeof LOCAL_TIPOS)[number];

export const MOVIMENTACAO_TIPOS = [
  'entrada_deposito',
  'saida_imovel',
  'retorno_imovel',
  'envio_lavanderia',
  'retorno_lavanderia',
  'ajuste',
] as const;
export type MovimentacaoTipo = (typeof MOVIMENTACAO_TIPOS)[number];

// Status do lote de lavanderia. Derivado: movimentações vinculadas dizem
// enviado/retornado; o campo Lote.encerradoEm tem prioridade e leva ao
// status 'encerrado_com_pendencia' — decisão administrativa explícita.
export const LOTE_STATUS = [
  'aberto',
  'retorno_parcial',
  'concluido',
  'com_divergencia',
  'encerrado_com_pendencia',
] as const;
export type LoteStatus = (typeof LOTE_STATUS)[number];

// Motivos de encerramento com pendência. 'outros' exige descrição livre.
// Lista fechada para permitir relatórios agrupados por motivo no admin.
//
// IMPORTANTE: 'duplicado' é semanticamente DIFERENTE — significa que o
// lote nunca deveria ter existido (lançamento duplicado, erro grave de
// registro). Relatórios de perda EXCLUEM esse valor (RelatorioPerdaService).
// O fluxo de cancelamento (LoteLavanderiaService.cancelarLoteDuplicado)
// cancela todas as movs do lote em vez de criar ajustes.
export const MOTIVOS_FECHAMENTO = [
  'perda_confirmada',
  'danificado',
  'extravio',
  'erro_operacional',
  'outros',
  'duplicado',
] as const;
export type MotivoFechamento = (typeof MOTIVOS_FECHAMENTO)[number];

// Canais pelos quais o gestor cobra a lavanderia sobre um lote em aberto.
// Lista fechada para facilitar relatórios agrupados por canal e evitar
// texto livre inconsistente.
export const TIPOS_CONTATO_LAVANDERIA = [
  'whatsapp',
  'telefone',
  'email',
  'presencial',
  'outro',
] as const;
export type TipoContatoLavanderia = (typeof TIPOS_CONTATO_LAVANDERIA)[number];

// Origem provável da divergência registrada quando um lote é encerrado
// com pendência. Coletada na UI pelo operador no modal de classificação,
// gravada no header do lote (`lotes_lavanderia.origem_divergencia`).
//
// Permite agrupamento em relatórios ("quanto perdemos POR culpa da
// lavanderia este mês vs. internamente") sem texto livre. Schema tem
// CHECK aceitando estes 4 valores ou null.
export const ORIGENS_DIVERGENCIA = [
  'lavanderia',
  'imovel',
  'operacao',
  'desconhecida',
] as const;
export type OrigemDivergencia = (typeof ORIGENS_DIVERGENCIA)[number];

// Classificação da divergência no FECHAMENTO DIÁRIO (controle do dia).
// Diferente de `MotivoFechamento` (lote) — daily expressa a CATEGORIA crua
// do operador, sem o vocabulário formal de baixa administrativa.
//
// Não inclui `retorno_parcial` (que existe em lote como "mais virá depois")
// porque no daily isso é mapeado para o botão "Salvar parcial" (não fecha
// o dia).
export const CLASSIFICACOES_DIVERGENCIA_DIARIA = [
  'perda',
  'dano',
  'extravio',
  'erro_operacional',
  'outro',
] as const;
export type ClassificacaoDivergenciaDiaria =
  (typeof CLASSIFICACOES_DIVERGENCIA_DIARIA)[number];
