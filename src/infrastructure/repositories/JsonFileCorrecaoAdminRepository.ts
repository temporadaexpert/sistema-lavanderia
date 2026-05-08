import type { CorrecaoAdmin } from '@/domain/entities/CorrecaoAdmin';
import type {
  CorrecaoAdminFiltro,
  CorrecaoAdminRepository,
} from '@/application/ports/CorrecaoAdminRepository';
import { criarJsonStore, type JsonStore } from '../persistence/jsonStore';

// Persistência em disco da trilha de correções administrativas. Mesmo
// padrão append-only do JsonFileMovimentacaoRepository — registrar()
// só adiciona; não há update/delete (limpar só pra reset operacional).
export class JsonFileCorrecaoAdminRepository implements CorrecaoAdminRepository {
  private readonly json: JsonStore<CorrecaoAdmin>;
  private storePromise: Promise<CorrecaoAdmin[]> | null = null;

  constructor(nomeArquivo = 'correcoes-admin.json') {
    this.json = criarJsonStore<CorrecaoAdmin>(nomeArquivo);
  }

  private async garantirCarregado(): Promise<CorrecaoAdmin[]> {
    if (this.storePromise) return this.storePromise;
    this.storePromise = this.json.carregar();
    return this.storePromise;
  }

  private async flush(): Promise<void> {
    if (!this.storePromise) return;
    const log = await this.storePromise;
    await this.json.salvar(log);
  }

  async registrar(correcao: CorrecaoAdmin): Promise<void> {
    const log = await this.garantirCarregado();
    log.push(correcao);
    await this.flush();
  }

  async listar(filtro?: CorrecaoAdminFiltro): Promise<CorrecaoAdmin[]> {
    const log = await this.garantirCarregado();
    if (!filtro) return log.slice();
    return log.filter((c) => {
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
    const log = await this.garantirCarregado();
    log.length = 0;
    await this.json.limpar();
  }
}
