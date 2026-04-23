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
export const MOTIVOS_FECHAMENTO = [
  'perda_confirmada',
  'danificado',
  'extravio',
  'erro_operacional',
  'outros',
] as const;
export type MotivoFechamento = (typeof MOTIVOS_FECHAMENTO)[number];
