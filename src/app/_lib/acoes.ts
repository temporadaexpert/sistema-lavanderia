import type { MovimentacaoTipo } from '@/domain/types/enums';

// Ações operacionais são a linguagem do front: o que a funcionária está
// realmente fazendo. Cada uma mapeia para UM MovimentacaoTipo do domínio.
// O domínio continua sendo a fonte de verdade das regras (tipos de origem/
// destino permitidos vêm de REGRAS_MOVIMENTACAO) — este módulo só carrega
// rótulos e pistas de UX. Por ser livre de React/Node, é importável tanto
// por client components quanto por server actions.

export type AcaoOperacional =
  | 'enviar_lavanderia'
  | 'receber_lavanderia'
  | 'enviar_imovel'
  | 'receber_imovel'
  | 'entrada_deposito'
  | 'ajuste_manual';

export const ACOES: readonly AcaoOperacional[] = [
  'enviar_lavanderia',
  'receber_lavanderia',
  'enviar_imovel',
  'receber_imovel',
  'entrada_deposito',
  'ajuste_manual',
];

// Como a UI deve se comportar em cada lado (origem / destino):
//   auto_unico — se houver EXATAMENTE um local do tipo permitido,
//                pré-seleciona sem mostrar campo; senão vira seletor.
//   seletor    — operador escolhe entre os locais do tipo permitido.
//   vazia      — o campo não se aplica a esta ação (não é enviado).
//   livre      — seletor com todos os locais e opção "nenhum" (ajuste).
export type ModoCampo = 'auto_unico' | 'seletor' | 'vazia' | 'livre';

export interface AcaoConfig {
  readonly label: string;
  readonly descricao: string;
  readonly tipoMovimentacao: MovimentacaoTipo;
  readonly origem: ModoCampo;
  readonly destino: ModoCampo;
}

export const ACAO_CONFIG: Record<AcaoOperacional, AcaoConfig> = {
  enviar_lavanderia: {
    label: 'Enviar para lavanderia',
    descricao: 'Enxoval sujo saindo do depósito para lavagem externa.',
    tipoMovimentacao: 'envio_lavanderia',
    origem: 'auto_unico',
    destino: 'auto_unico',
  },
  receber_lavanderia: {
    label: 'Receber da lavanderia',
    descricao: 'Peças limpas voltando da lavanderia para o depósito. Confira a quantidade antes de registrar.',
    tipoMovimentacao: 'retorno_lavanderia',
    origem: 'auto_unico',
    destino: 'auto_unico',
  },
  enviar_imovel: {
    label: 'Enviar para imóvel',
    descricao: 'Saída de material limpo do depósito para uso em um imóvel.',
    tipoMovimentacao: 'saida_imovel',
    origem: 'auto_unico',
    destino: 'seletor',
  },
  receber_imovel: {
    label: 'Receber do imóvel',
    descricao: 'Retorno de material do imóvel para o depósito (para lavar ou reaproveitar).',
    tipoMovimentacao: 'retorno_imovel',
    origem: 'seletor',
    destino: 'auto_unico',
  },
  entrada_deposito: {
    label: 'Entrada no depósito',
    descricao: 'Chegada de material novo ou reposição externa (ex.: compra, doação).',
    tipoMovimentacao: 'entrada_deposito',
    origem: 'vazia',
    destino: 'auto_unico',
  },
  ajuste_manual: {
    label: 'Ajuste manual',
    descricao: 'Correção de saldo, baixa de perda confirmada ou transferência entre locais.',
    tipoMovimentacao: 'ajuste',
    origem: 'livre',
    destino: 'livre',
  },
};

export function parseAcao(raw: unknown): AcaoOperacional | null {
  if (typeof raw !== 'string') return null;
  return raw in ACAO_CONFIG ? (raw as AcaoOperacional) : null;
}
