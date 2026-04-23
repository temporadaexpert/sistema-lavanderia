import type { Clock } from '@/application/services/MovimentacaoService';

export class SystemClock implements Clock {
  agoraISO(): string {
    return new Date().toISOString();
  }
}
