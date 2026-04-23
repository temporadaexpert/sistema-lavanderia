'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { REGRAS_MOVIMENTACAO } from '@/domain/rules/movimentacaoRules';
import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import type { LocalTipo } from '@/domain/types/enums';
import { registrarAcaoAction, type AcaoResultado } from '../_lib/actions';
import { ACAO_CONFIG, type AcaoOperacional, type ModoCampo } from '../_lib/acoes';
import styles from './OperacaoForm.module.css';

interface Props {
  acao: Exclude<AcaoOperacional, 'enviar_lavanderia' | 'receber_lavanderia'>;
  itens: Item[];
  locais: Local[];
}

type ResolucaoCampo =
  | { tipo: 'oculto' }
  | { tipo: 'fixo'; local: Local }
  | { tipo: 'seletor'; opcoes: Local[]; obrigatorio: boolean; permiteNenhum: boolean };

function resolverCampo(
  modo: ModoCampo,
  tiposPermitidos: readonly LocalTipo[] | null,
  locais: Local[],
): ResolucaoCampo {
  if (modo === 'vazia') return { tipo: 'oculto' };
  const candidatos = tiposPermitidos
    ? locais.filter((l) => tiposPermitidos.includes(l.tipo))
    : locais;
  if (modo === 'livre') {
    return { tipo: 'seletor', opcoes: candidatos, obrigatorio: false, permiteNenhum: true };
  }
  if (modo === 'seletor') {
    return { tipo: 'seletor', opcoes: candidatos, obrigatorio: true, permiteNenhum: false };
  }
  const [unico, ...resto] = candidatos;
  if (unico && resto.length === 0) return { tipo: 'fixo', local: unico };
  return { tipo: 'seletor', opcoes: candidatos, obrigatorio: true, permiteNenhum: false };
}

export function FormGenerico({ acao, itens, locais }: Props) {
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const cfg = ACAO_CONFIG[acao];
  const regra = REGRAS_MOVIMENTACAO[cfg.tipoMovimentacao];
  const origem = resolverCampo(cfg.origem, regra.tiposOrigemPermitidos, locais);
  const destino = resolverCampo(cfg.destino, regra.tiposDestinoPermitidos, locais);

  async function aoSubmeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setResultado(null);
    setLoading(true);
    try {
      const r = await registrarAcaoAction(formData);
      setResultado(r);
      if (r.ok) {
        form.reset();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={aoSubmeter} className={styles.form} noValidate>
      <input type="hidden" name="acao" value={acao} readOnly />

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="itemId">Item</label>
          <select id="itemId" name="itemId" className={styles.select} defaultValue="" required>
            <option value="" disabled>Selecione…</option>
            {itens.map((i) => (
              <option key={i.id} value={i.id}>{i.nome}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="quantidade">Quantidade</label>
          <input
            id="quantidade"
            name="quantidade"
            type="number"
            min={1}
            step={1}
            className={styles.input}
            required
          />
        </div>
      </div>

      {origem.tipo === 'fixo' && (
        <div className={styles.fixo}>
          <span className={styles.fixoLabel}>Origem</span>
          <strong className={styles.fixoValor}>{origem.local.nome}</strong>
          <input type="hidden" name="origemId" value={origem.local.id} readOnly />
        </div>
      )}
      {origem.tipo === 'seletor' && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="origemId">
            Origem {!origem.obrigatorio && <span className={styles.hint}>(opcional)</span>}
          </label>
          <select
            id="origemId"
            name="origemId"
            className={styles.select}
            defaultValue=""
            required={origem.obrigatorio}
          >
            {origem.permiteNenhum ? (
              <option value="">— nenhum</option>
            ) : (
              <option value="" disabled>Selecione…</option>
            )}
            {origem.opcoes.map((l) => (
              <option key={l.id} value={l.id}>{l.nome}</option>
            ))}
          </select>
        </div>
      )}

      {destino.tipo === 'fixo' && (
        <div className={styles.fixo}>
          <span className={styles.fixoLabel}>Destino</span>
          <strong className={styles.fixoValor}>{destino.local.nome}</strong>
          <input type="hidden" name="destinoId" value={destino.local.id} readOnly />
        </div>
      )}
      {destino.tipo === 'seletor' && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="destinoId">
            Destino {!destino.obrigatorio && <span className={styles.hint}>(opcional)</span>}
          </label>
          <select
            id="destinoId"
            name="destinoId"
            className={styles.select}
            defaultValue=""
            required={destino.obrigatorio}
          >
            {destino.permiteNenhum ? (
              <option value="">— nenhum</option>
            ) : (
              <option value="" disabled>Selecione…</option>
            )}
            {destino.opcoes.map((l) => (
              <option key={l.id} value={l.id}>{l.nome}</option>
            ))}
          </select>
        </div>
      )}

      {acao === 'ajuste_manual' && (
        <p className={styles.aviso}>
          Preencha <strong>origem</strong> para dar baixa, <strong>destino</strong> para acrescentar, ou ambos para transferir.
        </p>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="responsavel">Responsável</label>
        <input
          id="responsavel"
          name="responsavel"
          type="text"
          className={styles.input}
          maxLength={120}
          required
          placeholder="Nome de quem está registrando"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="observacao">
          Observação <span className={styles.hint}>(opcional)</span>
        </label>
        <textarea
          id="observacao"
          name="observacao"
          className={styles.textarea}
          rows={2}
          maxLength={500}
        />
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.button} disabled={loading}>
          {loading ? 'Registrando…' : 'Confirmar'}
        </button>
      </div>

      {resultado && (
        <div
          className={`${styles.feedback} ${resultado.ok ? styles.success : styles.error}`}
          role="status"
          aria-live="polite"
        >
          {resultado.ok
            ? resultado.mensagem ?? 'Movimentação registrada com sucesso.'
            : resultado.error}
        </div>
      )}
    </form>
  );
}
