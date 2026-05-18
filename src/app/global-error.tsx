'use client';

import { useEffect } from 'react';

// Catch-all de último recurso. Ativa quando o próprio app/layout.tsx ou
// algum segmento sem error.tsx específico estoura. Diferente de error.tsx
// de segmento, este precisa renderizar <html>/<body> próprios (porque o
// layout que faria isso é justamente o que quebrou).
//
// Mantemos cosmética mínima — CSS inline pra não depender de globals.css
// (que poderia ser a causa). Mensagem direta + retry + digest.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[GlobalError]', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          background: '#f7f1ea',
          color: '#1f2937',
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 520,
            width: '100%',
            background: '#fff',
            borderRadius: 16,
            padding: '36px 32px',
            boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, color: '#c2410c', marginBottom: 16 }}>⚠</div>
          <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>
            Falha ao carregar a aplicação
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, margin: '0 0 24px', color: '#4b5563' }}>
            Houve um erro inesperado no servidor. Tente novamente; se persistir, avise o
            desenvolvedor com o código abaixo.
          </p>
          <div
            style={{
              background: '#f9fafb',
              border: '1px dashed #d1d5db',
              borderRadius: 10,
              padding: '12px 16px',
              marginBottom: 24,
              textAlign: 'left',
            }}
          >
            <div
              style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#6b7280',
                marginBottom: 4,
              }}
            >
              Código de referência
            </div>
            <code style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>
              {error.digest ?? '(sem digest)'}
            </code>
          </div>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: '#c2410c',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              padding: '12px 20px',
              cursor: 'pointer',
              minHeight: 44,
              width: '100%',
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
