// Erros de domínio carregam um `code` estável para que camadas superiores
// possam traduzi-los (HTTP status, i18n, logs estruturados) sem parsear mensagens.

export class DomainError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} não encontrado: ${id}`);
  }
}

export class RegraNegocioError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

export class SaldoInsuficienteError extends RegraNegocioError {
  constructor(itemId: string, localId: string, disponivel: number, solicitado: number) {
    super(
      'SALDO_INSUFICIENTE',
      `Saldo insuficiente do item ${itemId} no local ${localId}: disponível ${disponivel}, solicitado ${solicitado}`,
    );
  }
}

// Erro amigável para o modelo novo de inventário (admin define
// estoqueTotal, sistema calcula disponibilidade). Usa o NOME do item
// em vez do id técnico — a funcionária vê "Toalha" em vez de
// "item-uuid-xyz" quando o envio não cabe no disponível.
export class EstoqueInsuficienteError extends RegraNegocioError {
  constructor(nomeItem: string, disponivel: number, solicitado: number) {
    super(
      'ESTOQUE_INSUFICIENTE',
      `Estoque disponível insuficiente para ${nomeItem}. Disponível: ${disponivel}, solicitado: ${solicitado}.`,
    );
  }
}

// Linha de divergência exposta ao caller — tem TODOS os campos que a UI
// precisa pra renderizar o modal de classificação sem chamada extra.
export interface LinhaDivergencia {
  readonly itemId: string;
  readonly nomeItem: string;
  readonly enviado: number;
  readonly retornado: number;
  readonly diferenca: number; // sempre > 0 pra item faltando
}

// Sinaliza que um retorno DEIXARIA pendência no lote sem o operador ter
// classificado o motivo. NÃO é erro fatal — é etapa operacional. O caller
// deve oferecer ao usuário um select (perda/dano/extravio/etc) e re-submeter
// com `motivo` preenchido.
//
// Diferente dos outros erros: carrega payload `divergencias` pra UI
// renderizar a lista detalhada sem precisar consultar o lote de novo.
export class DivergenciaDetectadaError extends RegraNegocioError {
  readonly divergencias: readonly LinhaDivergencia[];
  constructor(divergencias: readonly LinhaDivergencia[]) {
    const total = divergencias.reduce((s, l) => s + l.diferenca, 0);
    super(
      'DIVERGENCIA_DETECTADA',
      `Após este retorno, faltam ${total} peça(s) em ${divergencias.length} item(ns). Classifique para concluir.`,
    );
    this.divergencias = divergencias;
  }
}

// Linha de divergência diária (controle do dia) — formato distinto do
// lote: tem faltante E excedente por item, porque o snapshot diário pode
// ter ambos simultaneamente (ex.: 2 toalhas faltam, mas 1 pano sobra).
// Lote nunca tem excedente legítimo (excesso é proibido pela validação).
export interface LinhaDivergenciaDiariaDetectada {
  readonly itemId: string;
  readonly nomeItem: string;
  readonly enviado: number;
  readonly retornado: number;
  readonly faltante: number;   // > 0 quando enviado > retornado
  readonly excedente: number;  // > 0 quando retornado > enviado
}

// Sinaliza que o operador clicou "Salvar e fechar o dia" mas a contagem
// diverge do envio sem que ele tenha informado a classificação/origem/motivo.
//
// Resolve a "trava" do FormRetornoDiario: o gatilho `aoClicarFechar` checa
// `temDivergenciaHoje` (snapshot SALVO no servidor) e abre modal apenas
// nesse caso. Se a divergência for FORM-LIVE (números digitados ainda não
// salvos), o snapshot é false → modal não abre → server lança ValidationError
// e a UI fica sem caminho operacional.
//
// Com este erro tipado, a action devolve um `code` específico e a UI abre
// o modal REATIVAMENTE — independente do snapshot pré-existente.
export class DivergenciaDiariaDetectadaError extends RegraNegocioError {
  readonly divergencias: readonly LinhaDivergenciaDiariaDetectada[];
  readonly totalFaltante: number;
  readonly totalExcedente: number;
  constructor(divergencias: readonly LinhaDivergenciaDiariaDetectada[]) {
    const totalFaltante = divergencias.reduce((s, l) => s + l.faltante, 0);
    const totalExcedente = divergencias.reduce((s, l) => s + l.excedente, 0);
    super(
      'DIVERGENCIA_DIARIA_DETECTADA',
      `Fechamento do dia diverge do envio: ${totalFaltante} faltando, ${totalExcedente} sobrando. Classifique para concluir.`,
    );
    this.divergencias = divergencias;
    this.totalFaltante = totalFaltante;
    this.totalExcedente = totalExcedente;
  }
}
