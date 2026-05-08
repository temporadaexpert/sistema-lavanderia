'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MOTIVOS_FECHAMENTO, type MotivoFechamento } from '@/domain/types/enums';
import { encerrarLoteAction, type AcaoResultado } from '../_lib/actions';
import styles from './EncerrarLoteDialog.module.css';

interface RiscoView {
  temRisco: boolean;
  nuncaCobrado: boolean;
  promessaVencida: boolean;
  diasAtrasoPromessa: number | null;
  valorPendenteAlto: boolean;
  valorPendente: number;
  pendenciaAntiga: boolean;
  diasDesdeEnvio: number;
  motivos: readonly string[];
}

interface Props {
  loteId: string;
  loteCodigo: string;
  pendenciaEfetiva: number;
  possuiDivergencia: boolean;
  risco: RiscoView | null;
}

const LABEL_MOTIVO: Record<MotivoFechamento, string> = {
  perda_confirmada: 'Perda confirmada',
  danificado: 'Peça(s) danificada(s)',
  extravio: 'Extravio',
  erro_operacional: 'Erro operacional',
  outros: 'Outros (descrever)',
  // 'duplicado' NÃO entra neste dialog — usar CancelarLoteDuplicadoDialog.
  // Mantemos no Record por exigência de Record<MotivoFechamento, string>;
  // a opção é filtrada da lista renderizada (MOTIVOS_FECHAMENTO_ENCERRAVEIS).
  duplicado: 'Duplicado (use Cancelar lote)',
};

const DESCRICAO_MOTIVO: Record<MotivoFechamento, string> = {
  perda_confirmada: 'Gestor aceita a perda — a lavanderia não vai devolver.',
  danificado: 'Peças retornaram danificadas e serão baixadas do estoque.',
  extravio: 'Peças extraviadas (perdidas em trânsito, roubo, etc).',
  erro_operacional: 'Erro de contagem no envio, lançamento duplicado, etc.',
  outros: 'Outro motivo — descreva em detalhes abaixo.',
  duplicado: '', // não usado neste dialog
};

// Motivos válidos pra encerrar com pendência (gera ajuste, conta como
// perda). Exclui 'duplicado' — duplicação NÃO é perda real.
const MOTIVOS_FECHAMENTO_ENCERRAVEIS = MOTIVOS_FECHAMENTO.filter(
  (m) => m !== 'duplicado',
);

export function EncerrarLoteDialog({
  loteId,
  loteCodigo,
  pendenciaEfetiva,
  possuiDivergencia,
  risco,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [motivo, setMotivo] = useState<MotivoFechamento | ''>('');
  const [reconheceRisco, setReconheceRisco] = useState(false);
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const exigeReconhecimento = risco?.temRisco === true;

  function abrir() {
    setResultado(null);
    setMotivo('');
    setReconheceRisco(false);
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
      const r = await encerrarLoteAction(formData);
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
      <button type="button" className={styles.botaoEncerrar} onClick={abrir}>
        Encerrar lote com pendência…
      </button>

      <dialog ref={dialogRef} className={styles.dialog} onClose={() => setResultado(null)}>
        <form onSubmit={aoSubmeter} className={styles.form} noValidate>
          <input type="hidden" name="loteId" value={loteId} readOnly />

          <header className={styles.header}>
            <h3>Encerrar lote {loteCodigo}</h3>
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
            <strong>Atenção:</strong> esta ação registra um <em>ajuste</em> reduzindo o saldo da
            lavanderia em <strong>{pendenciaEfetiva} peça(s)</strong>. As movimentações anteriores
            são preservadas; a baixa entra como novo lançamento no log. A ação não pode ser
            desfeita automaticamente.
            {possuiDivergencia && (
              <>
                {' '}
                O lote também apresenta <strong>divergência</strong> (retorno maior que envio em
                algum item) — isso não é afetado pelo encerramento.
              </>
            )}
          </div>

          {exigeReconhecimento && risco && (
            <div className={styles.riscoBloco} role="alert">
              <div className={styles.riscoTitulo}>
                <span aria-hidden>⚠</span> Baixa de alto risco
              </div>
              <p className={styles.riscoTexto}>
                Antes de encerrar, revise os sinais abaixo — baixas precipitadas podem esconder
                peças que a lavanderia ainda devolveria.
              </p>
              <ul className={styles.riscoLista}>
                {risco.nuncaCobrado && (
                  <li>
                    <strong>Nunca cobrado:</strong> nenhum contato foi registrado com a
                    lavanderia sobre este lote.
                  </li>
                )}
                {risco.promessaVencida && (
                  <li>
                    <strong>Promessa vencida:</strong> a lavanderia prometeu retorno e está
                    atrasada há {risco.diasAtrasoPromessa ?? 0} dia(s).
                  </li>
                )}
                {risco.valorPendenteAlto && (
                  <li>
                    <strong>Valor alto:</strong> pendência estimada em R${' '}
                    {risco.valorPendente.toFixed(2)}.
                  </li>
                )}
                {risco.pendenciaAntiga && (
                  <li>
                    <strong>Pendência antiga:</strong> o envio saiu há {risco.diasDesdeEnvio}{' '}
                    dia(s).
                  </li>
                )}
              </ul>
              <label className={styles.riscoCheck}>
                <input
                  type="checkbox"
                  name="reconhecimentoRisco"
                  checked={reconheceRisco}
                  onChange={(e) => setReconheceRisco(e.target.checked)}
                  required
                />
                <span>
                  Confirmo que revi os sinais acima e desejo encerrar o lote mesmo assim. A
                  decisão fica registrada no histórico.
                </span>
              </label>
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="motivo">
              Motivo do encerramento
            </label>
            <select
              id="motivo"
              name="motivo"
              className={styles.select}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value as MotivoFechamento)}
              required
            >
              <option value="" disabled>
                Selecione o motivo…
              </option>
              {MOTIVOS_FECHAMENTO_ENCERRAVEIS.map((m) => (
                <option key={m} value={m}>
                  {LABEL_MOTIVO[m]}
                </option>
              ))}
            </select>
            {motivo && <p className={styles.hint}>{DESCRICAO_MOTIVO[motivo]}</p>}
          </div>

          {motivo === 'outros' && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="motivoDescricao">
                Descrição do motivo
              </label>
              <textarea
                id="motivoDescricao"
                name="motivoDescricao"
                className={styles.textarea}
                rows={3}
                minLength={3}
                maxLength={500}
                required
                placeholder="Descreva o que aconteceu para registro de auditoria"
              />
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="responsavel">
              Responsável pela decisão
            </label>
            <input
              id="responsavel"
              name="responsavel"
              type="text"
              className={styles.input}
              maxLength={120}
              required
              placeholder="Nome do gestor que está encerrando"
            />
          </div>

          {resultado && !resultado.ok && (
            <div className={styles.erro} role="status">
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
              Cancelar
            </button>
            <button
              type="submit"
              className={styles.botaoPrimario}
              disabled={loading || !motivo || (exigeReconhecimento && !reconheceRisco)}
            >
              {loading ? 'Encerrando…' : 'Confirmar encerramento'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
