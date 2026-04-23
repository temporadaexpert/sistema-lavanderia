import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Sistema de Lavanderia',
  description: 'Controle operacional de enxoval',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
