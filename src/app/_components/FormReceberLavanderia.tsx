'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoteResumo } from '@/application/services/LoteLavanderiaService';
import { registrarRetornoLoteAction, type AcaoResultado } from '../_lib/actions';
import styles from './OperacaoForm.module.css';

interface Props {
  lotesAbertos: LoteResumo[];
  // Itens pendentes por lote, calculados server-side e injetados para que
  // o form não precise chamar outra API no cliente.
  pendenciasPorLote: Record<string, readonly PendenciaLinha[]>;
}

export interface PendenciaLinha {
  readonly itemId: string;
  readonly nomeItem: string;
  readonly pendencia: number;
}

export function FormReceberLavanderia({ lotesAbertos, pendenciasPorLote }: Props) {
  const [loteSelecionado, setLoteSelecionado] = useState<string>('');
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const pendencias = useMemo(
    () => (loteSelecionado ? pendenciasPorLote[loteSelecionado] ?? [] : []),
    [loteSelecionado, pendenciasPorLote],
  );
  const loteResumo = useMemo(
    () => lotesAbertos.find((l) => l.lote.id === loteSelecionado) ?? null,
    [lotesAbertos, loteSelecionado],
  );

  function aoMudarLote(id: string) {
    setLoteSelecionado(id);
    // Pré-preenche com a pendência total — gestora confirma ou ajusta para menos.
    const inicial: Record<string, string> = {};
    const linhas = pendenciasPorLote[id] ?? [];
    for (const l of linhas) inicial[l.itemId] = String(l.pendencia);
    setQuantidades(inicial);
    setResultado(null);
  }

  function aoMudarQtd(itemId: string, valor: string) {
    setQuantidades((atual) => ({ ...atual, [itemId]: valor }));
  }

  async function aoSubmeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setResultado(null);
    setLoading(true);
    try {
      const r = await registrarRetornoLoteAction(formData);
      setResultado(r);
      if (r.ok) {
        setLoteSelecionado('');
        setQuantidades({});
        form.reset();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  if (lotesAbertos.length === 0) {
    return (
      <div className={styles.vazio}>
        Nenhum lote aberto ou com retorno parcial. Crie um lote em <strong>Enviar para lavanderia</strong> para poder registrar retornos.
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={aoSubmeter} className={styles.form} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="loteId">Lote a receber</label>
        <select
          id="loteId"
          name="loteId"
          className={styles.select}
          value={loteSelecionado}
          onChange={(e) => aoMudarLote(e.target.value)}
          required
        >
          <option value="" disabled>Selecione um lote pendente…</option>
          {lotesAbertos.map((r) => (
            <option key={r.lote.id} value={r.lote.id}>
              {r.lote.codigo} — enviado em {formatarData(r.lote.dataEnvio)} ·
              {' '}pendente: {r.pendenciaTotal} peça(s)
              {r.possuiDivergencia ? ' · com divergência' : ''}
            </option>
          ))}
        </select>
      </div>

      {loteResumo && (
        <div className={styles.loteResumoBox}>
          <div>
            <span className={styles.fixoLabel}>Origem enviada</span>
            <strong>{loteResumo.totalEnviado} peça(s)</strong>
          </div>
          <div>
            <span className={styles.fixoLabel}>Já retornado</span>
            <strong>{loteResumo.totalRetornado} peça(s)</strong>
          </div>
          <div>
            <span className={styles.fixoLabel}>Pendente</span>
            <strong className={loteResumo.pendenciaTotal > 0 ? styles.alertaTexto : ''}>
              {loteResumo.pendenciaTotal} peça(s)
            </strong>
          </div>
        </div>
      )}

      {loteSelecionado && pendencias.length > 0 && (
        <div className={styles.linhasWrapper}>
          <div className={styles.linhasHeader}>
            <span className={styles.label}>Quantidade retornada agora</span>
            <span className={styles.hint}>
              {pendencias.length} item(ns) pendente(s). Ajuste a quantidade que chegou — por padrão já vem preenchido o pendente total.
            </span>
          </div>
          {pendencias.map((p) => (
            <div key={p.itemId} className={styles.linhaRetorno}>
              <div className={styles.linhaRetornoNome}>
                <strong>{p.nomeItem}</strong>
                <span className={styles.hint}>pendente: {p.pendencia}</span>
              </div>
              <input type="hidden" name="itemLinhaId" value={p.itemId} readOnly />
              <input
                type="number"
                name="itemLinhaQtd"
                min={0}
                step={1}
                className={styles.input}
                value={quantidades[p.itemId] ?? ''}
                onChange={(e) => aoMudarQtd(p.itemId, e.target.value)}
                placeholder="Qtd que voltou"
                aria-label={`Quantidade retornada de ${p.nomeItem}`}
              />
            </div>
          ))}
        </div>
      )}

      {loteSelecionado && pendencias.length === 0 && (
        <p className={styles.aviso}>
          Esse lote não tem pendência no momento. Se ainda assim chegou algum item (retorno tardio),
          contate o gestor para registrar como entrada ou como ajuste.
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
          placeholder="Nome de quem recebeu"
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
          placeholder="Ex.: 2 fronhas ficarão para próxima devolução (manchadas)"
        />
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.button} disabled={loading || !loteSelecionado}>
          {loading ? 'Registrando…' : 'Registrar retorno'}
        </button>
      </div>

      {resultado && (
        <div
          className={`${styles.feedback} ${resultado.ok ? styles.success : styles.error}`}
          role="status"
          aria-live="polite"
        >
          {resultado.ok
            ? resultado.mensagem ?? 'Retorno registrado com sucesso.'
            : resultado.error}
        </div>
      )}
    </form>
  );
}

function formatarData(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
