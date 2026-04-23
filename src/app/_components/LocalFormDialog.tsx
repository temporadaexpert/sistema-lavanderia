'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Local } from '@/domain/entities/Local';
import { LOCAL_TIPOS, type LocalTipo } from '@/domain/types/enums';
import {
  atualizarLocalAction,
  criarLocalAction,
  type AcaoResultado,
} from '../_lib/localActions';
import styles from './LocalFormDialog.module.css';

type Modo = 'criar' | 'editar';

interface Props {
  modo: Modo;
  local?: Local;
  rotuloBotao?: string;
  tamanhoBotao?: 'primario' | 'pequeno';
}

const TIPO_LABEL: Record<LocalTipo, string> = {
  deposito: 'Depósito',
  imovel: 'Imóvel',
  lavanderia: 'Lavanderia',
};

const TIPO_DESCRICAO: Record<LocalTipo, string> = {
  deposito: 'Depósito central ou auxiliar. Origem das saídas e destino das entradas/retornos.',
  imovel: 'Unidade onde o enxoval é utilizado (ex.: apartamento, suíte, casa).',
  lavanderia: 'Lavanderia externa que recebe lotes para lavagem.',
};

// Mesmo padrão do MaterialFormDialog: um único componente serve criar e
// editar, a diferença é o modo + action chamada. UX consistente entre os
// dois cadastros do admin.
export function LocalFormDialog({
  modo,
  local,
  rotuloBotao,
  tamanhoBotao = 'primario',
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tipo, setTipo] = useState<LocalTipo>(local?.tipo ?? 'deposito');
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function abrir() {
    setResultado(null);
    setTipo(local?.tipo ?? 'deposito');
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
      const r =
        modo === 'criar'
          ? await criarLocalAction(formData)
          : await atualizarLocalAction(formData);
      setResultado(r);
      if (r.ok) {
        dialogRef.current?.close();
        if (modo === 'criar') form.reset();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  const titulo = modo === 'criar' ? 'Novo local' : `Editar ${local?.nome ?? 'local'}`;
  const labelSubmit = modo === 'criar' ? 'Cadastrar local' : 'Salvar alterações';
  const botaoClasse =
    tamanhoBotao === 'primario' ? styles.triggerPrimario : styles.triggerPequeno;
  const labelBotao = rotuloBotao ?? (modo === 'criar' ? '+ Novo local' : 'Editar');

  return (
    <>
      <button type="button" className={botaoClasse} onClick={abrir}>
        {labelBotao}
      </button>

      <dialog ref={dialogRef} className={styles.dialog} onClose={() => setResultado(null)}>
        <form onSubmit={aoSubmeter} className={styles.form} noValidate>
          {local && <input type="hidden" name="id" value={local.id} readOnly />}

          <header className={styles.header}>
            <h3>{titulo}</h3>
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

          <div className={styles.field}>
            <label className={styles.label} htmlFor="nome">
              Nome
            </label>
            <input
              id="nome"
              name="nome"
              type="text"
              className={styles.input}
              required
              maxLength={120}
              defaultValue={local?.nome ?? ''}
              placeholder="Ex.: Depósito Central, Apto 302, Lavanderia Zona Sul"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="tipo">
              Tipo
            </label>
            <select
              id="tipo"
              name="tipo"
              className={styles.input}
              required
              value={tipo}
              onChange={(e) => setTipo(e.target.value as LocalTipo)}
            >
              {LOCAL_TIPOS.map((t) => (
                <option key={t} value={t}>
                  {TIPO_LABEL[t]}
                </option>
              ))}
            </select>
            <p className={styles.hint}>{TIPO_DESCRICAO[tipo]}</p>
          </div>

          <div className={styles.checkboxRow}>
            <label className={styles.checkboxLabel}>
              <input type="checkbox" name="ativo" defaultChecked={local?.ativo ?? true} />
              <span>Local ativo (disponível nos formulários operacionais)</span>
            </label>
            <p className={styles.hint}>
              Locais inativos ficam escondidos dos selects da operação, mas o histórico de
              movimentações e lotes que os envolve continua legível — movs antigas preservam
              o vínculo pelo id.
            </p>
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
              {loading ? 'Salvando…' : labelSubmit}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
