import styles from './LogoTE.module.css';

interface Props {
  // dark → para fundos claros (inverte cores); light → para fundos escuros.
  variant?: 'dark' | 'light';
  tamanho?: 'sm' | 'md' | 'lg';
  // Quando true, mostra só o monograma "TE" (para espaços reduzidos).
  apenasMarca?: boolean;
}

// Identidade visual da Temporada Expert.
//
// Placeholder elegante via texto + monograma dourado. Quando a logo oficial
// for disponibilizada em `public/brand/logo.svg` (ou .png), o corpo deste
// componente é trocado por <Image src="/brand/logo.svg" ... />; chamadores
// não precisam mudar.
export function LogoTE({ variant = 'dark', tamanho = 'md', apenasMarca = false }: Props) {
  return (
    <div
      className={`${styles.logo} ${styles[variant]} ${styles[tamanho]}`}
      aria-label="Temporada Expert — Lavanderia Control"
    >
      <span className={styles.marca} aria-hidden="true">
        TE
      </span>
      {!apenasMarca && (
        <span className={styles.textos}>
          <span className={styles.empresa}>Temporada Expert</span>
          <span className={styles.produto}>Lavanderia Control</span>
        </span>
      )}
    </div>
  );
}
