'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  corrigirRetornoLavanderiaAction,
  type CorrecaoResultado,
} from '@/app/_lib/correcaoAdminActions';
import styles from './EncerrarLoteDialog.module.css';

interface ItemRetorno {
  readonly itemId: string;
  readonly nomeItem: string;
  readonly quantidadeTotal: number;
  readonly quebraPorLote: ReadonlyArray<{
    readonly loteId: string | null;
    readonly loteCodigo: string | null;
    readonly quantidade: number;
    readonly conciliado: boolean;
  }>;
}

interface Props {
  readonly operacaoId: string;
  readonly loteAtualCodigo: string | null;
  readonly itens: readonly ItemRetorno[];
}

// Modal de correção do RETORNO de lavanderia. UX:
// - Mostra qtd TOTAL devolvida por item + quebra (atual / anterior /
//   excedente) só pra contexto.
// - Admin edita o total. Service cancela todas as movs da operação e
//   re-grava com a nova quantidade no lote atual.
//
// Trade-off explícito (também documentado no service): a correção NÃO
// re-distribui FIFO cross-lote. Se a operação original abateu pendências
// anteriores, o cancelamento RESTAURA essas pendências (movs canceladas
// somem da projeção); a nova quantidade vai inteira pro lote atual.
// Admin que precisar abater anteriores de novo pode fazer um novo
// recebimento normal pelo /operacao.
export function CorrigirRetornoLavanderiaDialog({
  operacaoId,
  loteAtualCodigo,
  itens,
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
      Object.fromEntries(itens.map((i) => [i.itemId, String(i.quantidadeTotal)])),
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

  function diff(item: ItemRetorno): number {
    const nova = Number(novasQtds[item.itemId] ?? '');
    if (!Number.isFinite(nova)) return 0;
    return nova - item.quantidadeTotal;
  }

  function eGrande(item: ItemRetorno): boolean {
    const d = Math.abs(diff(item));
    const limite = Math.max(10, Math.floor(item.quantidadeTotal * 0.3));
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
      const r = await corrigirRetornoLavanderiaAction(fd);
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
      <button type="button" className={styles.botaoPrimario} onClick={abrir}>
        Corrigir retorno
      </button>
      <dialog ref={dialogRef} className={styles.dialog}>
        <form onSubmit={aoSubmeter} className={styles.form} noValidate>
          <input type="hidden" name="operacaoId" value={operacaoId} readOnly />
          <header className={styles.header}>
            <h3>
              Corrigir retorno
              {loteAtualCodigo ? ` (lote ${loteAtualCodigo})` : ''}
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
            <strong>Atenção:</strong> esta correção CANCELA todas as
            movimentações desta operação (incluindo compensações em lotes
            anteriores e excedentes não conciliados) e regrava a nova
            quantidade no lote atual. As pendências dos lotes anteriores
            voltam ao estado pré-operação automaticamente.
          </p>

          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qtd devolvida</th>
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
                    <td>
                      {it.nomeItem}
                      {it.quebraPorLote.length > 1 && (
                        <ul className={styles.quebraInfo}>
                          {it.quebraPorLote.map((q, idx) => (
                            <li key={idx}>
                              {q.quantidade} →{' '}
                              {q.loteCodigo
                                ? `lote ${q.loteCodigo}`
                                : 'excedente não conciliado'}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className={styles.colNum}>{it.quantidadeTotal}</td>
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
            <label className={styles.label} htmlFor="motivoCorrRet">
              Motivo (mínimo 5 caracteres)
            </label>
            <textarea
              id="motivoCorrRet"
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
            <label className={styles.label} htmlFor="adminCorrRet">
              Admin responsável
            </label>
            <input
              id="adminCorrRet"
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
                Diferença grande detectada (≥ 10 unidades ou ≥ 30%). Confirmo
                que revisei o número.
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
