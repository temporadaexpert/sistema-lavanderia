'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  TIPOS_CONTATO_LAVANDERIA,
  type TipoContatoLavanderia,
} from '@/domain/types/enums';
import {
  registrarContatoAction,
  type AcaoResultado,
} from '@/app/_lib/contatoActions';
import styles from './RegistrarContatoDialog.module.css';

interface Props {
  loteId: string;
  loteCodigo: string;
  tamanhoBotao?: 'primario' | 'pequeno';
}

const TIPO_LABEL: Record<TipoContatoLavanderia, string> = {
  whatsapp: 'WhatsApp',
  telefone: 'Telefone',
  email: 'E-mail',
  presencial: 'Presencial',
  outro: 'Outro',
};

// Diálogo modal para registrar cobrança/contato com a lavanderia.
// Padrão visual idêntico ao EncerrarLoteDialog/MaterialFormDialog.
export function RegistrarContatoDialog({
  loteId,
  loteCodigo,
  tamanhoBotao = 'pequeno',
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tipo, setTipo] = useState<TipoContatoLavanderia>('whatsapp');
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function abrir() {
    setResultado(null);
    setTipo('whatsapp');
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
    setResultado(null);
    setLoading(true);
    try {
      const r = await registrarContatoAction(formData);
      setResultado(r);
      if (r.ok) {
        form.reset();
        setTipo('whatsapp');
        dialogRef.current?.close();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  const botaoClasse =
    tamanhoBotao === 'primario' ? styles.triggerPrimario : styles.triggerPequeno;

  return (
    <>
      <button type="button" className={botaoClasse} onClick={abrir}>
        Registrar cobrança
      </button>

      <dialog ref={dialogRef} className={styles.dialog} onClose={() => setResultado(null)}>
        <form onSubmit={aoSubmeter} className={styles.form} noValidate>
          <input type="hidden" name="loteId" value={loteId} readOnly />

          <header className={styles.header}>
            <h3>Registrar cobrança — {loteCodigo}</h3>
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

          <p className={styles.explicacao}>
            Registre o contato feito com a lavanderia sobre este lote. Isso não altera saldo,
            movimentações nem status do lote — é um evento de auditoria administrativa.
          </p>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="tipo">
                Canal de contato
              </label>
              <select
                id="tipo"
                name="tipo"
                className={styles.input}
                required
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoContatoLavanderia)}
              >
                {TIPOS_CONTATO_LAVANDERIA.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="responsavel">
                Responsável
              </label>
              <input
                id="responsavel"
                name="responsavel"
                type="text"
                className={styles.input}
                maxLength={120}
                required
                placeholder="Quem fez o contato"
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="observacao">
              Observação / resposta da lavanderia
            </label>
            <textarea
              id="observacao"
              name="observacao"
              className={styles.textarea}
              rows={3}
              maxLength={800}
              placeholder="Ex.: lavanderia confirmou que encontrou as peças, retorno na próxima devolução"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="promessaRetornoData">
                Promessa de retorno <span className={styles.hint}>(opcional)</span>
              </label>
              <input
                id="promessaRetornoData"
                name="promessaRetornoData"
                type="date"
                className={styles.input}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="proximaAcao">
                Próxima ação <span className={styles.hint}>(opcional)</span>
              </label>
              <input
                id="proximaAcao"
                name="proximaAcao"
                type="text"
                className={styles.input}
                maxLength={200}
                placeholder="Ex.: cobrar de novo em 3 dias se não retornar"
              />
            </div>
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
            <button type="submit" className={styles.botaoPrimario} disabled={loading}>
              {loading ? 'Registrando…' : 'Registrar cobrança'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
