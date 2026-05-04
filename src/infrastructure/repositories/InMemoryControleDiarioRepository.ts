import type { ControleDiarioEnxoval } from '@/domain/entities/ControleDiarioEnxoval';
import type { ControleDiarioRepository } from '@/application/ports/ControleDiarioRepository';

export class InMemoryControleDiarioRepository implements ControleDiarioRepository {
  // Chave: data (YYYY-MM-DD). Garante um registro por dia.
  private readonly store = new Map<string, ControleDiarioEnxoval>();

  async porData(data: string): Promise<ControleDiarioEnxoval | null> {
    return this.store.get(data) ?? null;
  }

  async salvar(controle: ControleDiarioEnxoval): Promise<void> {
    this.store.set(controle.data, controle);
  }

  async listar(): Promise<ControleDiarioEnxoval[]> {
    return Array.from(this.store.values());
  }

  async limpar(): Promise<void> {
    this.store.clear();
  }
}
