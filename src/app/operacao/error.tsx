'use client';

import { ErroPagina } from '@/app/_components/ErroPagina';

// Error boundary do segmento /operacao/*. Mesma estratégia do /admin —
// capturar throw, exibir tela amigável com digest + retry.
export default function OperacaoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErroPagina error={error} reset={reset} area="operacao" />;
}
