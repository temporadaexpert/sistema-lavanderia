'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import { criarLoteEnvioAction, type AcaoResultado } from '../_lib/actions';
import styles from './OperacaoForm.module.css';

interface Props {
  itens: Item[];
  depositos: Local[];
  lavanderias: Local[];
}

// Cada linha do lote tem um id de UI (só para key do React) e o itemId
// escolhido + quantidade. O envio usa FormData multi-valued (name="itemLinhaId",
// name="itemLinhaQtd") para que a action leia pares ordenados.
interface Linha {
  readonly uiKey: string;
  readonly itemId: string;
  readonly quantidade: string;
}

let linhaCounter = 0;
const novaLinha = (): Linha => ({ uiKey: `l-${++linhaCounter}`, itemId: '', quantidade: '' });

export function FormEnviarLavanderia({ itens, depositos, lavanderias }: Props) {
  const [linhas, setLinhas] = useState<Linha[]>(() => [novaLinha()]);
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const depositoUnico = depositos.length === 1 ? depositos[0] : null;
  const lavanderiaUnica = lavanderias.length === 1 ? lavanderias[0] : null;

  function atualizarLinha(uiKey: string, campo: 'itemId' | 'quantidade', valor: string) {
    setLinhas((atual) =>
      atual.map((l) => (l.uiKey === uiKey ? { ...l, [campo]: valor } : l)),
    );
  }

  function adicionarLinha() {
    setLinhas((atual) => [...atual, novaLinha()]);
  }

  function removerLinha(uiKey: string) {
    setLinhas((atual) => (atual.length === 1 ? atual : atual.filter((l) => l.uiKey !== uiKey)));
  }

  function resetar() {
    setLinhas([novaLinha()]);
    formRef.current?.reset();
  }

  async function aoSubmeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    setResultado(null);
    setLoading(true);
    try {
      // Em sucesso, criarLoteEnvioAction faz redirect server-side
      // pra /romaneio/lavanderia/[id] — o await abaixo nunca resolve
      // (NEXT_REDIRECT propaga até o RPC do Next handlear navegação).
      // Se a action retornar normalmente (caminho de erro), exibimos
      // a mensagem amigável.
      const r = await criarLoteEnvioAction(formData);
      setResultado(r);
      // Se chegou aqui com r.ok=true, é defensivo (action devia ter
      // redirecionado) — limpa o form e refresh.
      if (r.ok) {
        resetar();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  // Se há mais de um depósito ou lavanderia, mostramos seletor. Com 1 só,
  // exibimos como "fixo" e mandamos via hidden input. Mesma UX da etapa
  // anterior.
  return (
    <form ref={formRef} onSubmit={aoSubmeter} className={styles.form} noValidate>
      {depositoUnico ? (
        <div className={styles.fixo}>
          <span className={styles.fixoLabel}>Origem</span>
          <strong className={styles.fixoValor}>{depositoUnico.nome}</strong>
          <input type="hidden" name="origemId" value={depositoUnico.id} readOnly />
        </div>
      ) : (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="origemId">Depósito de origem</label>
          <select id="origemId" name="origemId" className={styles.select} defaultValue="" required>
            <option value="" disabled>Selecione…</option>
            {depositos.map((d) => (
              <option key={d.id} value={d.id}>{d.nome}</option>
            ))}
          </select>
        </div>
      )}

      {lavanderiaUnica ? (
        <div className={styles.fixo}>
          <span className={styles.fixoLabel}>Destino</span>
          <strong className={styles.fixoValor}>{lavanderiaUnica.nome}</strong>
          <input type="hidden" name="destinoId" value={lavanderiaUnica.id} readOnly />
        </div>
      ) : (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="destinoId">Lavanderia de destino</label>
          <select id="destinoId" name="destinoId" className={styles.select} defaultValue="" required>
            <option value="" disabled>Selecione…</option>
            {lavanderias.map((l) => (
              <option key={l.id} value={l.id}>{l.nome}</option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.linhasWrapper}>
        <div className={styles.linhasHeader}>
          <span className={styles.label}>Itens do lote</span>
          <span className={styles.hint}>{linhas.length} linha(s)</span>
        </div>

        {linhas.map((l, i) => (
          <div key={l.uiKey} className={styles.linha}>
            <select
              name="itemLinhaId"
              className={styles.select}
              value={l.itemId}
              onChange={(e) => atualizarLinha(l.uiKey, 'itemId', e.target.value)}
              required
              aria-label={`Item da linha ${i + 1}`}
            >
              <option value="" disabled>Item…</option>
              {itens.map((it) => (
                <option
                  key={it.id}
                  value={it.id}
                  disabled={linhas.some((ol) => ol.uiKey !== l.uiKey && ol.itemId === it.id)}
                >
                  {it.nome}
                </option>
              ))}
            </select>
            <input
              type="number"
              name="itemLinhaQtd"
              min={1}
              step={1}
              className={styles.input}
              value={l.quantidade}
              onChange={(e) => atualizarLinha(l.uiKey, 'quantidade', e.target.value)}
              placeholder="Qtd"
              required
              aria-label={`Quantidade da linha ${i + 1}`}
            />
            <button
              type="button"
              onClick={() => removerLinha(l.uiKey)}
              className={styles.linhaRemover}
              aria-label={`Remover linha ${i + 1}`}
              disabled={linhas.length === 1}
            >
              ×
            </button>
          </div>
        ))}

        <button type="button" onClick={adicionarLinha} className={styles.linhaAdicionar}>
          + Adicionar item
        </button>
      </div>

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
          Observação do lote <span className={styles.hint}>(opcional)</span>
        </label>
        <textarea
          id="observacao"
          name="observacao"
          className={styles.textarea}
          rows={2}
          maxLength={500}
          placeholder="Ex.: rodízio semanal, manchas específicas, etc."
        />
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.button} disabled={loading}>
          {loading ? 'Criando lote…' : 'Criar lote e enviar'}
        </button>
      </div>

      {resultado && (
        <div
          className={`${styles.feedback} ${resultado.ok ? styles.success : styles.error}`}
          role="status"
          aria-live="polite"
        >
          {resultado.ok
            ? resultado.mensagem ?? 'Lote criado com sucesso.'
            : resultado.error}
        </div>
      )}
    </form>
  );
}
