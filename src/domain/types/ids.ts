// IDs "branded" evitam que um ItemId seja passado onde se espera um LocalId.
// O compilador rejeita a mistura sem custo em runtime.

type Brand<T, B> = T & { readonly __brand: B };

export type ItemId = Brand<string, 'ItemId'>;
export type LocalId = Brand<string, 'LocalId'>;
export type MovimentacaoId = Brand<string, 'MovimentacaoId'>;
export type LoteId = Brand<string, 'LoteId'>;

export const ItemId = (raw: string): ItemId => raw as ItemId;
export const LocalId = (raw: string): LocalId => raw as LocalId;
export const MovimentacaoId = (raw: string): MovimentacaoId => raw as MovimentacaoId;
export const LoteId = (raw: string): LoteId => raw as LoteId;
