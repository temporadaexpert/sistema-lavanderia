'use client';

import { ErroPagina } from '@/app/_components/ErroPagina';

// Error boundary do segmento /admin/*. Captura qualquer throw em server
// components, server actions, ou data loaders. Substitui a tela genérica
// "Application error: a server-side exception has occurred" do Next.js.
//
// O `digest` é o mesmo que aparece no console do servidor (Vercel logs) —
// permite cruzar o que o usuário vê com a linha de log real.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErroPagina error={error} reset={reset} area="admin" />;
}
