import type { LocalTipo, MovimentacaoTipo } from '../types/enums';

// Regras declarativas por tipo de movimentação. Mantê-las como dados (e não
// como if/else espalhados) permite validar e documentar o mesmo lugar.
export interface RegraMovimentacao {
  readonly origemObrigatoria: boolean;
  readonly destinoObrigatorio: boolean;
  readonly tiposOrigemPermitidos: readonly LocalTipo[] | null;
  readonly tiposDestinoPermitidos: readonly LocalTipo[] | null;
  readonly exigeSaldoNaOrigem: boolean;
  readonly permiteOrigemIgualDestino: boolean;
  // Só envio/retorno de lavanderia aceitam vínculo a lote. Para outros
  // tipos, receber loteId é erro de contrato — rejeitado no service.
  readonly permiteLote: boolean;
  // Indica que o MovimentacaoService deve congelar o valorUnitario atual
  // do item em Movimentacao.precoUnitarioSnapshot. Ativo nos tipos que
  // alimentam relatórios financeiros — assim alterações futuras do cadastro
  // não distorcem a história. Tipos operacionais que não impactam custo
  // (entrada_deposito, saida/retorno de imóvel) ficam em false.
  readonly capturaSnapshotPreco: boolean;
}

export const REGRAS_MOVIMENTACAO: Record<MovimentacaoTipo, RegraMovimentacao> = {
  entrada_deposito: {
    origemObrigatoria: false,
    destinoObrigatorio: true,
    tiposOrigemPermitidos: null,
    tiposDestinoPermitidos: ['deposito'],
    exigeSaldoNaOrigem: false,
    permiteOrigemIgualDestino: false,
    permiteLote: false,
    capturaSnapshotPreco: false,
  },
  saida_imovel: {
    origemObrigatoria: true,
    destinoObrigatorio: true,
    tiposOrigemPermitidos: ['deposito'],
    tiposDestinoPermitidos: ['imovel'],
    exigeSaldoNaOrigem: true,
    permiteOrigemIgualDestino: false,
    permiteLote: false,
    capturaSnapshotPreco: false,
  },
  retorno_imovel: {
    origemObrigatoria: true,
    destinoObrigatorio: true,
    tiposOrigemPermitidos: ['imovel'],
    tiposDestinoPermitidos: ['deposito'],
    exigeSaldoNaOrigem: true,
    permiteOrigemIgualDestino: false,
    permiteLote: false,
    capturaSnapshotPreco: false,
  },
  envio_lavanderia: {
    origemObrigatoria: true,
    destinoObrigatorio: true,
    tiposOrigemPermitidos: ['deposito'],
    tiposDestinoPermitidos: ['lavanderia'],
    exigeSaldoNaOrigem: true,
    permiteOrigemIgualDestino: false,
    permiteLote: true,
    // Base do custo de lavanderia — precisa congelar para o relatório
    // histórico ser estável.
    capturaSnapshotPreco: true,
  },
  retorno_lavanderia: {
    origemObrigatoria: true,
    destinoObrigatorio: true,
    tiposOrigemPermitidos: ['lavanderia'],
    tiposDestinoPermitidos: ['deposito'],
    exigeSaldoNaOrigem: true,
    permiteOrigemIgualDestino: false,
    permiteLote: true,
    // Congela pelo mesmo motivo do envio: o relatório compara
    // custoEnviado × custoRetornado; só congelar um lado criaria
    // inconsistência quando o preço mudasse entre envio e retorno.
    capturaSnapshotPreco: true,
  },
  ajuste: {
    // Ajuste precisa de pelo menos um lado (origem OU destino). A verificação
    // "pelo menos um" é feita no serviço — aqui os flags de obrigatoriedade
    // ficam em false porque cada caso usa um lado só.
    origemObrigatoria: false,
    destinoObrigatorio: false,
    tiposOrigemPermitidos: null,
    tiposDestinoPermitidos: null,
    exigeSaldoNaOrigem: false,
    permiteOrigemIgualDestino: false,
    // Ajustes podem ser vinculados a lote quando geram a baixa de
    // encerramento (perda confirmada, danificado, extravio...). Ajustes
    // manuais avulsos continuam válidos com loteId=null.
    permiteLote: true,
    // Base das perdas (encerramento de lote) — precisa congelar o preço
    // para que o relatório de perdas não mude retroativamente.
    capturaSnapshotPreco: true,
  },
};
