import type { ContatoLavanderiaId, LoteId } from '../types/ids';
import type { TipoContatoLavanderia } from '../types/enums';

// Registro imutável (append-only) de cobrança/contato sobre um lote
// específico com a lavanderia. Não altera saldo, movimentações ou status
// do lote — é puramente um evento administrativo de auditoria.
//
// Se um contato foi registrado errado, NÃO se edita: registra-se outro
// corrigindo. Preserva histórico completo para gestão e auditoria.
//
// `proximaAcao` e `promessaRetornoData` são opcionais — apenas quando
// a conversa com a lavanderia resultou em uma decisão ou data prometida.
export interface ContatoLavanderia {
  readonly id: ContatoLavanderiaId;
  readonly loteId: LoteId;
  readonly dataHora: string;
  readonly responsavel: string;
  readonly tipo: TipoContatoLavanderia;
  readonly observacao: string | null;
  readonly proximaAcao: string | null;
  readonly promessaRetornoData: string | null; // ISO date (YYYY-MM-DD) ou ISO datetime
  readonly registradoEm: string;
}
