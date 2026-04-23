import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '@/application/services/MovimentacaoService';

export class UuidGenerator implements IdGenerator {
  gerar(): string {
    return randomUUID();
  }
}
