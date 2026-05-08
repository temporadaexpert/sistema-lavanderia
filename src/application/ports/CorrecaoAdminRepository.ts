import type {
  CorrecaoAdmin,
  TipoBlocoCorrecao,
} from '@/domain/entities/CorrecaoAdmin';
import type { ItemId } from '@/domain/types/ids';

export interface CorrecaoAdminFiltro {
  readonly tipoBloco?: TipoBlocoCorrecao;
  readonly itemId?: ItemId;
  readonly adminResponsavel?: string;
  readonly desde?: string; // ISO inclusivo
  readonly ate?: string;   // ISO inclusivo
  readonly operacaoId?: string;
}

// Persistência das entradas de auditoria forte de correção admin. Não
// expõe update/delete: trilha é append-only por design (igual ao log
// de movimentações). Se uma "correção da correção" for necessária no
// futuro, registra-se uma NOVA correção apontando pra mov nova como
// se fosse a original.
export interface CorrecaoAdminRepository {
  registrar(correcao: CorrecaoAdmin): Promise<void>;
  listar(filtro?: CorrecaoAdminFiltro): Promise<CorrecaoAdmin[]>;
  // Operação administrativa (parte do ResetOperacionalService).
  limpar(): Promise<void>;
}
