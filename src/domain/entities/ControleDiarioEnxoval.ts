import type { ControleDiarioId, ItemId } from '../types/ids';
import type {
  ClassificacaoDivergenciaDiaria,
  OrigemDivergencia,
} from '../types/enums';

// Registro diário operacional do enxoval baseado no depósito. Complementa
// o controle por lote da lavanderia: aqui, o foco é o fluxo macro do dia
// — o que saiu do depósito de manhã e o que voltou à noite, misturado,
// sem rastreio por unidade/imóvel/motorista. Fica para a pessoa do
// depósito fechar em menos de 2 minutos.
//
// Granularidade: um registro por DATA (YYYY-MM-DD). Se alguém tentar abrir
// o mesmo dia duas vezes, o serviço retorna o existente — não cria outro.
//
// Separação sujo/limpo: a lavanderia recebe SÓ o sujo. Kits que voltaram
// limpos (não usados) são aproveitamento direto no depósito, não geram
// envio. Esta separação é o insumo-chave pro futuro "Gerar envio".

// Status do controle diário:
//   - aberto: recebendo lançamentos (envio e/ou retorno parciais)
//   - fechado: dia encerrado SEM divergência — enviado bate com retornado
//   - fechado_com_divergencia: dia encerrado COM divergência registrada
//     (peças faltam ou sobram). Motivo e responsável do fechamento ficam
//     gravados obrigatoriamente para auditoria posterior.
export type ControleDiarioStatus = 'aberto' | 'fechado' | 'fechado_com_divergencia';

export interface LinhaEnviada {
  readonly itemId: ItemId;
  readonly quantidade: number;
}

export interface LinhaRetornada {
  readonly itemId: ItemId;
  readonly recebidoSujo: number;
  readonly recebidoLimpo: number;
}

export interface ControleDiarioEnxoval {
  readonly id: ControleDiarioId;
  readonly data: string; // YYYY-MM-DD — fonte de verdade da identidade do dia
  readonly enviado: readonly LinhaEnviada[];
  readonly retorno: readonly LinhaRetornada[];
  readonly status: ControleDiarioStatus;
  readonly abertoEm: string; // ISO datetime
  readonly fechadoEm: string | null;
  readonly responsavelEnvio: string | null;
  readonly responsavelRetorno: string | null;
  // Preenchidos só quando o dia é fechado COM divergência. Ficam null em
  // dias que fecharam ok ou que ainda não fecharam.
  readonly responsavelFechamento: string | null;
  // Texto livre — descrição detalhada do que aconteceu (obrigatória só
  // quando classificacaoDivergencia='outro'; opcional nas demais).
  readonly motivoDivergencia: string | null;
  // Categoria estruturada da divergência. Obrigatória ao fechar com
  // divergência (a partir do fluxo unificado do operador). Permite
  // relatórios agrupados por tipo no admin.
  readonly classificacaoDivergencia: ClassificacaoDivergenciaDiaria | null;
  // Origem provável da divergência (mesmo enum usado em lote). Obrigatória
  // ao fechar com divergência. Permite relatórios "perda por canal".
  readonly origemDivergencia: OrigemDivergencia | null;
}
