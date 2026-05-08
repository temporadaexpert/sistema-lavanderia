import type { CorrecaoAdmin } from '@/domain/entities/CorrecaoAdmin';
import type {
  CorrecaoAdminFiltro,
  CorrecaoAdminRepository,
} from '@/application/ports/CorrecaoAdminRepository';

export class InMemoryCorrecaoAdminRepository implements CorrecaoAdminRepository {
  private log: CorrecaoAdmin[] = [];

  async registrar(correcao: CorrecaoAdmin): Promise<void> {
    this.log.push(correcao);
  }

  async listar(filtro?: CorrecaoAdminFiltro): Promise<CorrecaoAdmin[]> {
    if (!filtro) return this.log.slice();
    return this.log.filter((c) => {
      if (filtro.tipoBloco && c.tipoBloco !== filtro.tipoBloco) return false;
      if (filtro.itemId && c.itemId !== filtro.itemId) return false;
      if (filtro.adminResponsavel && c.adminResponsavel !== filtro.adminResponsavel) {
        return false;
      }
      if (filtro.operacaoId && c.operacaoId !== filtro.operacaoId) return false;
      if (filtro.desde && c.corrigidoEm < filtro.desde) return false;
      if (filtro.ate && c.corrigidoEm > filtro.ate) return false;
      return true;
    });
  }

  async limpar(): Promise<void> {
    this.log = [];
  }
}
