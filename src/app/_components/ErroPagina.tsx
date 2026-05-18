'use client';

import { useEffect } from 'react';
import styles from './ErroPagina.module.css';

// Componente compartilhado entre /admin/error.tsx e /operacao/error.tsx.
// Exibe mensagem amigável + digest do erro (pro suporte cruzar com Vercel
// logs) + botão de retry. Logga no console do BROWSER pra ajudar quando o
// cliente abrir DevTools — o erro real fica no server log da Vercel
// (capturado pelo serverLog).
export interface ErroPaginaProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
  readonly area: 'admin' | 'operacao';
}

const TITULOS: Record<ErroPaginaProps['area'], string> = {
  admin: 'Não conseguimos carregar o painel administrativo',
  operacao: 'Não conseguimos carregar a operação',
};

const SUB: Record<ErroPaginaProps['area'], string> = {
  admin: 'O servidor encontrou um problema ao montar a tela. Os dados estão preservados — nenhuma operação foi perdida. Tente novamente; se persistir, avise o desenvolvedor com o código abaixo.',
  operacao: 'O servidor encontrou um problema ao montar a tela. Suas movimentações estão preservadas — nada foi perdido. Tente novamente; se persistir, avise o gestor com o código abaixo.',
};

export function ErroPagina({ error, reset, area }: ErroPaginaProps) {
  useEffect(() => {
    // Log no console do cliente — útil quando o suporte pede print de
    // DevTools. O erro REAL (com stack) já foi gravado server-side pelo
    // serverLog antes do throw chegar aqui.
    // eslint-disable-next-line no-console
    console.error('[ErroPagina]', { area, digest: error.digest, message: error.message });
  }, [error, area]);

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <div className={styles.icone} aria-hidden>⚠</div>
        <h1 className={styles.titulo}>{TITULOS[area]}</h1>
        <p className={styles.subtitulo}>{SUB[area]}</p>

        <div className={styles.codigo}>
          <span className={styles.codigoLabel}>Código de referência</span>
          <code className={styles.codigoValor}>
            {error.digest ?? '(sem digest — erro de cliente)'}
          </code>
        </div>

        <div className={styles.acoes}>
          <button type="button" className={styles.botao} onClick={() => reset()}>
            Tentar novamente
          </button>
          <a href={area === 'admin' ? '/login' : '/operacao/login'} className={styles.link}>
            Voltar para o login
          </a>
        </div>
      </div>
    </main>
  );
}
