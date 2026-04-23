import type { ItemId } from '../types/ids';

export interface Item {
  readonly id: ItemId;
  readonly nome: string;
  readonly categoria: string;
  readonly ativo: boolean;
  // Campos adicionados para preparar o contexto admin (custos/metas). São
  // opcionais por natureza (podem não ser conhecidos no cadastro); o domínio
  // e o cálculo de saldo NÃO dependem deles — permanecem projeções sobre
  // movimentações. A UI operacional usa `unidade` e `estoqueMinimo`; o
  // futuro painel admin consumirá `valorUnitario` para estimativas de custo.
  readonly unidade: string;
  readonly valorUnitario: number | null;
  readonly estoqueMinimo: number | null;
  readonly criadoEm: string;
}
