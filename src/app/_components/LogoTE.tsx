import styles from './LogoTE.module.css';

interface Props {
  // dark → para fundos claros (inverte cores); light → para fundos escuros.
  variant?: 'dark' | 'light';
  tamanho?: 'sm' | 'md' | 'lg';
  // Quando true, mostra só o monograma "TE" (para espaços reduzidos).
  apenasMarca?: boolean;
  // Override do nome do produto (default "Lavanderia Control"). Útil para
  // contextos operacionais em que queremos usar "Controle de Enxoval" etc.
  produto?: string;
  // Linha extra opcional abaixo do produto (ex.: "Operação diária").
  subtitulo?: string;
}

// Identidade visual da Temporada Expert.
//
// Placeholder elegante via texto + monograma dourado. Quando a logo oficial
// for disponibilizada em `public/brand/logo.svg` (ou .png), o corpo deste
// componente é trocado por <Image src="/brand/logo.svg" ... />; chamadores
// não precisam mudar.
export function LogoTE({
  variant = 'dark',
  tamanho = 'md',
  apenasMarca = false,
  produto = 'Lavanderia Control',
  subtitulo,
}: Props) {
  return (
    <div
      className={`${styles.logo} ${styles[variant]} ${styles[tamanho]}`}
      aria-label={`Temporada Expert — ${produto}`}
    >
      <span className={styles.marca} aria-hidden="true">
        TE
      </span>
      {!apenasMarca && (
        <span className={styles.textos}>
          <span className={styles.empresa}>Temporada Expert</span>
          <span className={styles.produto}>{produto}</span>
          {subtitulo && <span className={styles.subtitulo}>{subtitulo}</span>}
        </span>
      )}
    </div>
  );
}
