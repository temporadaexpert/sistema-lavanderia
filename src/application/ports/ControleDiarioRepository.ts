import type { ControleDiarioEnxoval } from '@/domain/entities/ControleDiarioEnxoval';

export interface ControleDiarioRepository {
  porData(data: string): Promise<ControleDiarioEnxoval | null>;
  salvar(controle: ControleDiarioEnxoval): Promise<void>;
  listar(): Promise<ControleDiarioEnxoval[]>;
  // Operação administrativa: zera todos os controles diários.
  limpar(): Promise<void>;
}
