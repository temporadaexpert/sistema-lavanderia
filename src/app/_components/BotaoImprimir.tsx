'use client';

import styles from './BotaoImprimir.module.css';

interface Props {
  readonly className?: string;
  readonly children?: React.ReactNode;
}

// Client component mínimo: dispara window.print(). Fica fora do romaneio em
// si pra que o markup do romaneio seja 100% server-rendered e o JS só
// carrega pra este botão.
export function BotaoImprimir({ className, children = 'Imprimir agora' }: Props) {
  return (
    <button
      type="button"
      className={`${styles.botao} ${className ?? ''}`}
      onClick={() => window.print()}
    >
      <span aria-hidden>🖨</span>
      {children}
    </button>
  );
}
