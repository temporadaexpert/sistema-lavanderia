'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  corrigirEnvioLavanderiaAction,
  type CorrecaoResultado,
} from '@/app/_lib/correcaoAdminActions';
import styles from './EncerrarLoteDialog.module.css';

interface ItemEnvio {
  readonly itemId: string;
  readonly nomeItem: string;
  readonly quantidade: number;
}

interface Props {
  readonly loteId: string;
  readonly loteCodigo: string;
  readonly itens: readonly ItemEnvio[];
  readonly encerrado: boolean;
}

// Modal admin para corrigir um ENVIO de lote pra lavanderia. Cada item
// tem qtd anterior + input qtd nova; service só cancela/regrava itens
// que mudaram. Lote encerrado é bloqueado (mensagem clara).
export function CorrigirEnvioLavanderiaDialog({
  loteId,
  loteCodigo,
  itens,
  encerrado,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [novasQtds, setNovasQtds] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState('');
  const [admin, setAdmin] = useState('');
  const [confirmaGrande, setConfirmaGrande] = useState(false);
  const [resultado, setResultado] = useState<CorrecaoResultado | null>(null);
  const [loading, setLoading] = useState(false);

  function abrir() {
    setNovasQtds(
      Object.fromEntries(itens.map((i) => [i.itemId, String(i.quantidade)])),
    );
    setMotivo('');
    setAdmin('');
    setConfirmaGrande(false);
    setResultado(null);
    dialogRef.current?.showModal();
  }

  function fechar() {
    if (loading) return;
    dialogRef.current?.close();
  }

  function diff(item: ItemEnvio): number {
    const novaStr = novasQtds[item.itemId] ?? '';
    const nova = Number(novaStr);
    if (!Number.isFinite(nova)) return 0;
    return nova - item.quantidade;
  }

  // Regra do service replicada pra UX: |diff| >= max(10, qtdAnterior*0.3)
  function eGrande(item: ItemEnvio): boolean {
    const d = Math.abs(diff(item));
    const limite = Math.max(10, Math.floor(item.quantidade * 0.3));
    return d >= limite;
  }
  const algumaGrande = itens.some(eGrande);
  const algumaMudou = itens.some((i) => diff(i) !== 0);

  async function aoSubmeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setResultado(null);
    try {
      const fd = new FormData(e.currentTarget);
      const r = await corrigirEnvioLavanderiaAction(fd);
      setResultado(r);
      if (r.ok) {
        dialogRef.current?.close();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  if (encerrado) {
    return (
      <span title="Lote encerrado não pode ser corrigido por esta tela.">
        <button type="button" className={styles.botaoSecundario} disabled>
          Corrigir (lote encerrado)
        </button>
      </span>
    );
  }

  return (
    <>
      <button type="button" className={styles.botaoPrimario} onClick={abrir}>
        Corrigir envio
      </button>
      <dialog ref={dialogRef} className={styles.dialog}>
        <form onSubmit={aoSubmeter} className={styles.form} noValidate>
          <input type="hidden" name="loteId" value={loteId} readOnly />
          <header className={styles.header}>
            <h3>Corrigir envio do lote {loteCodigo}</h3>
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

          <p className={styles.alerta}>
            Toda alteração CANCELA a movimentação original e cria uma nova com
            a quantidade corrigida. O preço histórico (snapshot) é preservado —
            sem distorção em relatórios financeiros antigos.
          </p>

          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qtd atual</th>
                <th>Nova qtd</th>
                <th>Diferença</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((it) => {
                const d = diff(it);
                const grande = eGrande(it);
                return (
                  <tr key={it.itemId}>
                    <td>{it.nomeItem}</td>
                    <td className={styles.colNum}>{it.quantidade}</td>
                    <td className={styles.colNum}>
                      <input type="hidden" name="itemCorrigidoId" value={it.itemId} readOnly />
                      <input
                        type="number"
                        name="itemCorrigidoQtdNova"
                        min={0}
                        step={1}
                        value={novasQtds[it.itemId] ?? ''}
                        onChange={(e) =>
                          setNovasQtds((s) => ({ ...s, [it.itemId]: e.target.value }))
                        }
                        className={styles.inputNum}
                        aria-label={`Nova quantidade de ${it.nomeItem}`}
                      />
                    </td>
                    <td className={styles.colNum}>
                      <span className={d > 0 ? styles.diffPos : d < 0 ? styles.diffNeg : ''}>
                        {d > 0 ? `+${d}` : d}
                        {grande && d !== 0 ? ' ⚠' : ''}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="motivoCorr">
              Motivo (mínimo 5 caracteres)
            </label>
            <textarea
              id="motivoCorr"
              name="motivo"
              className={styles.textarea}
              rows={2}
              maxLength={500}
              required
              minLength={5}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="adminCorr">
              Admin responsável
            </label>
            <input
              id="adminCorr"
              name="adminResponsavel"
              type="text"
              className={styles.input}
              maxLength={120}
              required
              value={admin}
              onChange={(e) => setAdmin(e.target.value)}
            />
          </div>

          {algumaGrande && (
            <label className={styles.riscoCheck}>
              <input
                type="checkbox"
                name="confirmacaoCorrecaoGrande"
                checked={confirmaGrande}
                onChange={(e) => setConfirmaGrande(e.target.checked)}
              />
              <span>
                Algum item tem diferença grande (≥ 10 unidades ou ≥ 30%). Confirmo
                que revisei os números.
              </span>
            </label>
          )}

          {resultado && !resultado.ok && (
            <div className={styles.feedbackErro} role="alert">
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
              disabled={
                loading ||
                !algumaMudou ||
                motivo.trim().length < 5 ||
                !admin.trim() ||
                (algumaGrande && !confirmaGrande)
              }
            >
              {loading ? 'Corrigindo…' : 'Confirmar correção'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
