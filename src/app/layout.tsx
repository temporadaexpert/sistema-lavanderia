import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'TE Lavanderia Control',
  description:
    'Sistema de controle de enxoval e lavanderia da Temporada Expert — operação e gestão.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
