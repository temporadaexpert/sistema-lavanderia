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
