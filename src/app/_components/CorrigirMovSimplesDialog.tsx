'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  corrigirMovSimplesAction,
  type CorrecaoResultado,
} from '@/app/_lib/correcaoAdminActions';
import styles from './EncerrarLoteDialog.module.css';

interface Props {
  readonly movId: string;
  readonly nomeItem: string;
  readonly quantidade: number;
  readonly tipo: 'saida_imovel' | 'retorno_imovel';
  readonly imovelNome: string;
}

// Modal admin para corrigir uma movimentação simples (saída ou retorno
// de imóvel — fluxos 3 e 4). Mais enxuto que os de lavanderia: 1 mov
// = 1 operação, sem fan-out.
export function CorrigirMovSimplesDialog({
  movId,
  nomeItem,
  quantidade,
  tipo,
  imovelNome,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [novaQtd, setNovaQtd] = useState(String(quantidade));
  const [motivo, setMotivo] = useState('');
  const [admin, setAdmin] = useState('');
  const [confirmaGrande, setConfirmaGrande] = useState(false);
  const [resultado, setResultado] = useState<CorrecaoResultado | null>(null);
  const [loading, setLoading] = useState(false);

  function abrir() {
    setNovaQtd(String(quantidade));
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

  const novaNum = Number(novaQtd);
  const valida = Number.isFinite(novaNum) && novaNum >= 0 && Number.isInteger(novaNum);
  const diff = valida ? novaNum - quantidade : 0;
  const limite = Math.max(10, Math.floor(quantidade * 0.3));
  const eGrande = Math.abs(diff) >= limite;
  const mudou = valida && novaNum !== quantidade;

  async function aoSubmeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setResultado(null);
    try {
      const fd = new FormData(e.currentTarget);
      const r = await corrigirMovSimplesAction(fd);
      setResultado(r);
      if (r.ok) {
        dialogRef.current?.close();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  const labelTipo = tipo === 'saida_imovel' ? 'Envio para' : 'Retorno de';

  return (
    <>
      <button type="button" className={styles.botaoPrimario} onClick={abrir}>
        Corrigir
      </button>
      <dialog ref={dialogRef} className={styles.dialog}>
        <form onSubmit={aoSubmeter} className={styles.form} noValidate>
          <input type="hidden" name="movId" value={movId} readOnly />
          <header className={styles.header}>
            <h3>
              Corrigir {labelTipo} {imovelNome}
            </h3>
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
            A movimentação original será cancelada e uma nova será criada com
            a quantidade corrigida. Saldo do depósito e do imóvel se ajustam
            automaticamente.
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
              <tr>
                <td>{nomeItem}</td>
                <td className={styles.colNum}>{quantidade}</td>
                <td className={styles.colNum}>
                  <input
                    type="number"
                    name="quantidadeNova"
                    min={0}
                    step={1}
                    value={novaQtd}
                    onChange={(e) => setNovaQtd(e.target.value)}
                    className={styles.inputNum}
                    required
                  />
                </td>
                <td className={styles.colNum}>
                  <span className={diff > 0 ? styles.diffPos : diff < 0 ? styles.diffNeg : ''}>
                    {diff > 0 ? `+${diff}` : diff}
                    {eGrande && diff !== 0 ? ' ⚠' : ''}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="motivoMov">
              Motivo (mínimo 5 caracteres)
            </label>
            <textarea
              id="motivoMov"
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
            <label className={styles.label} htmlFor="adminMov">
              Admin responsável
            </label>
            <input
              id="adminMov"
              name="adminResponsavel"
              type="text"
              className={styles.input}
              maxLength={120}
              required
              value={admin}
              onChange={(e) => setAdmin(e.target.value)}
            />
          </div>

          {eGrande && diff !== 0 && (
            <label className={styles.riscoCheck}>
              <input
                type="checkbox"
                name="confirmacaoCorrecaoGrande"
                checked={confirmaGrande}
                onChange={(e) => setConfirmaGrande(e.target.checked)}
              />
              <span>
                Diferença grande (≥ 10 ou ≥ 30%). Confirmo que revisei o número.
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
                !mudou ||
                motivo.trim().length < 5 ||
                !admin.trim() ||
                (eGrande && !confirmaGrande)
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
