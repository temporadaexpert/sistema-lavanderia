import type { ReactNode } from 'react';

// Layout isolado para rotas de romaneio. Não injeta header, sidebar ou
// footer — a página é pensada pra impressão A4 e tela minimalista.
export default function RomaneioLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
