import type { ReactNode } from 'react';
import { AdminSidebar } from '@/app/_components/AdminSidebar';
import styles from './layout.module.css';

// Layout admin com sidebar fixa (desktop) / topbar (mobile). Todas as
// rotas /admin/* herdam essa estrutura — substitui os header-nav
// duplicados que existiam em cada página.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <AdminSidebar />
      <div className={styles.conteudo}>{children}</div>
    </div>
  );
}
