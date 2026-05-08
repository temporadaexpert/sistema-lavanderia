'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  cancelarLoteDuplicadoAction,
  type AcaoResultado,
} from '../_lib/actions';
import styles from './EncerrarLoteDialog.module.css';

interface Props {
  loteId: string;
  loteCodigo: string;
  // Indica se o lote já tem encerramento prévio (ex.: "encerrado como
  // perda" antes de descobrirmos que era duplicado). Influencia o aviso
  // mostrado ao operador — neste caso explicamos que vamos REVERTER.
  jaEncerrado: boolean;
  // Quantidade de peças que estarão sendo desfeitas — só pra UX (mostra
  // o impacto da reversão).
  totalEnviado: number;
}

// Diálogo destrutivo pra cancelar lote por DUPLICAÇÃO ou erro grave.
// Diferente de EncerrarLoteDialog: NÃO cria ajustes nem conta como
// perda. Cancela todas as movs do lote e marca header com motivo='duplicado'.
//
// Funciona em qualquer estado:
//   - Lote aberto: cancela envios → saldo lavanderia volta a zero
//   - Lote já encerrado como perda: cancela envios + ajustes prévios →
//     reverte completamente o impacto contábil + remove de "Perdas"
export function CancelarLoteDuplicadoDialog({
  loteId,
  loteCodigo,
  jaEncerrado,
  totalEnviado,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [motivo, setMotivo] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function abrir() {
    setResultado(null);
    setMotivo('');
    setResponsavel('');
    setConfirmado(false);
    dialogRef.current?.showModal();
  }

  function fechar() {
    if (loading) return;
    dialogRef.current?.close();
  }

  async function aoSubmeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setLoading(true);
    setResultado(null);
    try {
      const r = await cancelarLoteDuplicadoAction(formData);
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
        className={styles.botaoCancelarDuplicado}
        onClick={abrir}
      >
        Cancelar lote (duplicação/erro)…
      </button>

      <dialog ref={dialogRef} className={styles.dialog} onClose={() => setResultado(null)}>
        <form onSubmit={aoSubmeter} className={styles.form} noValidate>
          <input type="hidden" name="loteId" value={loteId} readOnly />

          <header className={styles.header}>
            <h3>Cancelar lote {loteCodigo}</h3>
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

          <div className={styles.alerta}>
            <strong>Use isto APENAS para duplicação ou erro grave de registro</strong> —
            quando o lote nunca deveria ter existido. Esta ação:
            <ul>
              <li>
                Cancela TODAS as movimentações do lote ({totalEnviado} peça(s) enviadas
                voltam ao saldo do depósito).
              </li>
              {jaEncerrado && (
                <li>
                  <strong>Reverte o encerramento anterior:</strong> os ajustes que
                  haviam sido criados também são cancelados, e o lote NÃO conta mais
                  como perda em "Perdas no mês".
                </li>
              )}
              <li>
                NÃO cria ajustes novos. NÃO conta como perda em relatórios.
              </li>
              <li>
                Marca o lote com motivo "Duplicado" no histórico (auditável).
              </li>
            </ul>
            <p className={styles.alertaRodape}>
              Para perda real (peças não vão voltar), use{' '}
              <strong>"Encerrar com pendência"</strong>.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="motivo-cancelamento">
              Motivo do cancelamento
            </label>
            <textarea
              id="motivo-cancelamento"
              name="motivo"
              className={styles.textarea}
              rows={3}
              maxLength={500}
              required
              placeholder='Ex.: "duplicação do lote L-2026-002 por duplo clique no envio"'
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="responsavel-cancel">
              Quem está autorizando
            </label>
            <input
              id="responsavel-cancel"
              name="responsavel"
              type="text"
              className={styles.input}
              maxLength={120}
              required
              placeholder="Nome do gestor / supervisor"
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
            />
          </div>

          <label className={styles.riscoCheck}>
            <input
              type="checkbox"
              checked={confirmado}
              onChange={(e) => setConfirmado(e.target.checked)}
              required
            />
            <span>
              Entendo que esta ação cancela todas as movimentações do lote e que ela
              NÃO deve ser usada para perdas reais.
            </span>
          </label>

          {resultado && !resultado.ok && (
            <div className={styles.feedbackErro} role="alert">
              {resultado.error}
            </div>
          )}

          <div className={styles.acoes}>
            <button
              type="button"
              className={styles.botaoSecundario}
              onClick={fechar}
              disabled={loading}
            >
              Voltar
            </button>
            <button
              type="submit"
              className={styles.botaoPrimario}
              disabled={
                loading || !motivo.trim() || !responsavel.trim() || !confirmado
              }
            >
              {loading ? 'Cancelando…' : 'Confirmar cancelamento'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
