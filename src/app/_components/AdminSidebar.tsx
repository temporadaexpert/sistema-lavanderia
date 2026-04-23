'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoTE } from './LogoTE';
import { logoutAction } from '@/app/_lib/authActions';
import styles from './AdminSidebar.module.css';

interface ItemNav {
  readonly href: string;
  readonly label: string;
}

const GESTAO: readonly ItemNav[] = [
  { href: '/admin', label: 'Painel' },
  { href: '/admin/materiais', label: 'Materiais' },
  { href: '/admin/locais', label: 'Locais' },
  { href: '/admin/lotes-lavanderia', label: 'Lotes' },
  { href: '/admin/divergencias', label: 'Divergências' },
  { href: '/admin/lavanderia', label: 'Custos' },
  { href: '/admin/perdas', label: 'Perdas' },
];

function estaAtivo(pathname: string, href: string): boolean {
  // '/admin' é a raiz administrativa — só marca ativo se for exato, senão
  // qualquer subrota do admin também acenderia.
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(href + '/');
}

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className={styles.sidebar} aria-label="Navegação administrativa">
      <div className={styles.brand}>
        <Link href="/admin" className={styles.brandLink} aria-label="Painel admin">
          <LogoTE variant="light" tamanho="sm" />
        </Link>
      </div>

      <nav className={styles.nav}>
        <div className={styles.grupoTitulo}>Gestão</div>
        <ul className={styles.lista}>
          {GESTAO.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`${styles.item} ${estaAtivo(pathname, item.href) ? styles.itemAtivo : ''}`}
              >
                <span className={styles.itemLabel}>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className={styles.separador} />

        <div className={styles.grupoTitulo}>Atalhos</div>
        <ul className={styles.lista}>
          <li>
            <Link href="/" className={styles.item}>
              <span className={styles.itemLabel}>Operação</span>
              <span className={styles.seta} aria-hidden="true">
                ↗
              </span>
            </Link>
          </li>
        </ul>
      </nav>

      <div className={styles.rodape}>
        <form action={logoutAction}>
          <button type="submit" className={styles.sair}>
            Sair
          </button>
        </form>
      </div>
    </aside>
  );
}
