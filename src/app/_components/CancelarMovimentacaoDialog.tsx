'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cancelarMovimentacaoAction } from '../_lib/adminOperacionalActions';
import type { AcaoResultado } from '../_lib/actions';
import styles from './CancelarMovimentacaoDialog.module.css';

interface Props {
  readonly movimentacaoId: string;
  readonly descricao: string;
}

export function CancelarMovimentacaoDialog({ movimentacaoId, descricao }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [motivo, setMotivo] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function abrir() {
    setResultado(null);
    setMotivo('');
    setResponsavel('');
    dialogRef.current?.showModal();
  }

  function fechar() {
    if (loading) return;
    dialogRef.current?.close();
  }

  async function aoSubmeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setLoading(true);
    setResultado(null);
    try {
      const r = await cancelarMovimentacaoAction(formData);
      setResultado(r);
      if (r.ok) {
        dialogRef.current?.close();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className={styles.botaoCancelar}
        title="Cancelar este lançamento"
      >
        Cancelar
      </button>
      <dialog ref={dialogRef} className={styles.dialog}>
        <form onSubmit={aoSubmeter} className={styles.form} noValidate>
          <input type="hidden" name="movimentacaoId" value={movimentacaoId} readOnly />

          <header className={styles.header}>
            <h3>Cancelar lançamento</h3>
            <button
              type="button"
              onClick={fechar}
              className={styles.fecharX}
              aria-label="Fechar"
              disabled={loading}
            >
              ×
            </button>
          </header>

          <div className={styles.aviso}>
            <strong>Atenção:</strong> o lançamento permanece no histórico como{' '}
            <em>cancelado</em> (com motivo e responsável registrados) e deixa de
            impactar saldo e relatórios. Esta ação não pode ser desfeita.
          </div>

          <div className={styles.descricao}>{descricao}</div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="motivo-cancel">
              Motivo
            </label>
            <textarea
              id="motivo-cancel"
              name="motivo"
              className={styles.textarea}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              minLength={3}
              maxLength={500}
              required
              placeholder="Ex.: lançado em duplicidade; contagem errada; item trocado"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="resp-cancel">
              Responsável
            </label>
            <input
              id="resp-cancel"
              type="text"
              name="responsavel"
              className={styles.input}
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              maxLength={120}
              required
              placeholder="Quem está cancelando"
            />
          </div>

          {resultado && !resultado.ok && (
            <div className={styles.erro} role="alert">
              {resultado.error}
            </div>
          )}

          <div className={styles.acoes}>
            <button
              type="button"
              onClick={fechar}
              className={styles.botaoSecundario}
              disabled={loading}
            >
              Voltar
            </button>
            <button
              type="submit"
              className={styles.botaoPrimario}
              disabled={loading || !motivo.trim() || !responsavel.trim()}
            >
              {loading ? 'Cancelando…' : 'Confirmar cancelamento'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
