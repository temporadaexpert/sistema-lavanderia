'use client';

import { useState } from 'react';
import styles from './ContadorItem.module.css';

interface Props {
  readonly inputName: string;
  readonly valorInicial?: number;
  readonly passo?: number;
  readonly min?: number;
  readonly max?: number;
  readonly destaque?: 'sujo' | 'limpo' | null;
}

// Contador mobile-first com botões +/-. Expõe o valor como <input hidden>
// com o `inputName` — o FormData da action pega pelo name.
export function ContadorItem({
  inputName,
  valorInicial = 0,
  passo = 1,
  min = 0,
  max = 9999,
  destaque = null,
}: Props) {
  const [valor, setValor] = useState(valorInicial);

  const ajustar = (delta: number) => {
    setValor((v) => Math.max(min, Math.min(max, v + delta)));
  };

  const classeValor =
    destaque === 'sujo'
      ? styles.valorSujo
      : destaque === 'limpo'
        ? styles.valorLimpo
        : styles.valor;

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.botao}
        onClick={() => ajustar(-passo)}
        aria-label="diminuir"
        disabled={valor <= min}
      >
        −
      </button>
      <div className={classeValor} aria-live="polite">
        {valor}
      </div>
      <button
        type="button"
        className={styles.botao}
        onClick={() => ajustar(passo)}
        aria-label="aumentar"
        disabled={valor >= max}
      >
        +
      </button>
      <input type="hidden" name={inputName} value={valor} readOnly />
    </div>
  );
}
