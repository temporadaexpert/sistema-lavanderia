import Link from 'next/link';
import { LogoTE } from './LogoTE';
import styles from './OperacaoHeader.module.css';

interface Props {
  // Link de "voltar" opcional. Se ausente, mostra só a marca (usado na home).
  readonly voltarHref?: string;
  readonly voltarLabel?: string;
}

// Cabeçalho compartilhado de toda a área operacional da funcionária.
// Mantém identidade Temporada Expert consistente em /operacao e filhas.
// Mobile-first: ocupa top da tela, touch targets adequados.
export function OperacaoHeader({ voltarHref, voltarLabel = 'Voltar' }: Props) {
  return (
    <header className={styles.cabecalho}>
      <div className={styles.container}>
        <div className={styles.topo}>
          <LogoTE
            tamanho="sm"
            produto="Controle de Enxoval"
            subtitulo="Operação diária"
          />
        </div>
        {voltarHref && (
          <Link href={voltarHref} className={styles.voltar}>
            <span aria-hidden>←</span> {voltarLabel}
          </Link>
        )}
      </div>
    </header>
  );
}
