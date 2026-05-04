import type { CategoryId, ItemId } from '../types/ids';

export interface Item {
  readonly id: ItemId;
  readonly nome: string;
  // Referência estruturada: fonte única da verdade da categoria.
  // Renomear a categoria no admin reflete em todos os itens sem migração
  // de dados (a UI resolve nome via `categorias.porId`).
  readonly categoriaId: CategoryId;
  // Cache denormalizado do nome da categoria, mantido pelo ItemService em
  // sincronia com a categoria referenciada. Evita joins em hot path (UI,
  // relatórios). Se a categoria for renomeada, este cache fica velho até
  // o próximo `atualizar()` — aceitável porque a UI tem `categorias.porId`
  // como fonte para o nome atual. O cache existe pra logs/audit legado.
  readonly categoria: string;
  readonly ativo: boolean;
  readonly unidade: string;
  readonly valorUnitario: number | null;
  readonly estoqueMinimo: number | null;
  // Inventário total comprado/cadastrado pelo admin. Quando definido,
  // o sistema calcula disponibilidade como
  //   disponivel = estoqueTotal − em_uso_em_imoveis − em_lavanderia
  // Quando null, o item é tratado no modo legacy "event-sourced puro"
  // (saldo = soma de entradas − saídas), preservando compatibilidade
  // com cadastros antigos. Editável apenas pelo admin, nunca pelo fluxo
  // operacional. Fonte única da verdade do "quanto temos no total".
  readonly estoqueTotal: number | null;
  readonly criadoEm: string;
}
