import type { MotivoFechamento } from '@/domain/types/enums';

// Rótulos curtos dos motivos de encerramento para exibição em tabelas/selos.
// O diálogo de encerramento tem labels um pouco mais longos (com "(descrever)"
// em "outros") por conta do contexto — mantido separado lá.
export const MOTIVO_LABEL: Record<MotivoFechamento, string> = {
  perda_confirmada: 'Perda confirmada',
  danificado: 'Danificado',
  extravio: 'Extravio',
  erro_operacional: 'Erro operacional',
  outros: 'Outros',
  duplicado: 'Duplicado (cancelado)',
};
