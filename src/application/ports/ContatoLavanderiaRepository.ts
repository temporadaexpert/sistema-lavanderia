import type { ContatoLavanderia } from '@/domain/entities/ContatoLavanderia';
import type { LoteId } from '@/domain/types/ids';

export interface ContatoLavanderiaRepository {
  // Append-only: registrar novo contato. Não há update/delete por design —
  // para corrigir, registra-se outro contato explicando.
  registrar(contato: ContatoLavanderia): Promise<void>;
  listarPorLote(loteId: LoteId): Promise<ContatoLavanderia[]>;
  listar(): Promise<ContatoLavanderia[]>;
  // Operação administrativa: zera todos os contatos.
  limpar(): Promise<void>;
}
