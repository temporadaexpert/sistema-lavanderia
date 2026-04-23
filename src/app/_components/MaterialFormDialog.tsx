'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Item } from '@/domain/entities/Item';
import {
  atualizarMaterialAction,
  criarMaterialAction,
  type AcaoResultado,
} from '../_lib/materialActions';
import styles from './MaterialFormDialog.module.css';

type Modo = 'criar' | 'editar';

interface Props {
  modo: Modo;
  item?: Item;
  categoriasConhecidas: readonly string[];
  unidadesConhecidas: readonly string[];
  rotuloBotao?: string;
  tamanhoBotao?: 'primario' | 'pequeno';
}

// Mesmo formulário para "Novo" e "Editar" — o modo controla o título,
// o botão de submit e qual action é chamada. Pré-preenche com o item quando
// editando, fica em branco para criar.
export function MaterialFormDialog({
  modo,
  item,
  categoriasConhecidas,
  unidadesConhecidas,
  rotuloBotao,
  tamanhoBotao = 'primario',
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function abrir() {
    setResultado(null);
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
          ? await criarMaterialAction(formData)
          : await atualizarMaterialAction(formData);
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

  const titulo = modo === 'criar' ? 'Novo material' : `Editar ${item?.nome ?? 'material'}`;
  const labelSubmit = modo === 'criar' ? 'Cadastrar material' : 'Salvar alterações';
  const botaoClasse =
    tamanhoBotao === 'primario' ? styles.triggerPrimario : styles.triggerPequeno;
  const labelBotao = rotuloBotao ?? (modo === 'criar' ? '+ Novo material' : 'Editar');

  return (
    <>
      <button type="button" className={botaoClasse} onClick={abrir}>
        {labelBotao}
      </button>

      <dialog ref={dialogRef} className={styles.dialog} onClose={() => setResultado(null)}>
        <form onSubmit={aoSubmeter} className={styles.form} noValidate>
          {item && <input type="hidden" name="id" value={item.id} readOnly />}

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

          <div className={styles.row}>
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
                defaultValue={item?.nome ?? ''}
                placeholder="Ex.: Toalha de banho branca"
              />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="categoria">
                Categoria
              </label>
              <input
                id="categoria"
                name="categoria"
                type="text"
                list="material-categorias"
                className={styles.input}
                required
                maxLength={60}
                defaultValue={item?.categoria ?? ''}
                placeholder="Ex.: toalha"
              />
              <datalist id="material-categorias">
                {categoriasConhecidas.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="unidade">
                Unidade
              </label>
              <input
                id="unidade"
                name="unidade"
                type="text"
                list="material-unidades"
                className={styles.input}
                required
                maxLength={20}
                defaultValue={item?.unidade ?? 'un'}
                placeholder="un"
              />
              <datalist id="material-unidades">
                {unidadesConhecidas.map((u) => (
                  <option key={u} value={u} />
                ))}
                <option value="un" />
                <option value="kg" />
                <option value="par" />
                <option value="m" />
              </datalist>
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="valorUnitario">
                Valor unitário{' '}
                <span className={styles.hint}>(R$ — em branco = sem preço)</span>
              </label>
              <input
                id="valorUnitario"
                name="valorUnitario"
                type="text"
                inputMode="decimal"
                className={styles.input}
                maxLength={20}
                defaultValue={item?.valorUnitario != null ? formatarDecimal(item.valorUnitario) : ''}
                placeholder="0,00"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="estoqueMinimo">
                Estoque mínimo <span className={styles.hint}>(peças)</span>
              </label>
              <input
                id="estoqueMinimo"
                name="estoqueMinimo"
                type="number"
                min={0}
                step={1}
                className={styles.input}
                defaultValue={item?.estoqueMinimo ?? ''}
                placeholder="0"
              />
            </div>
          </div>

          <div className={styles.checkboxRow}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                name="ativo"
                defaultChecked={item?.ativo ?? true}
              />
              <span>Material ativo (visível para a operação)</span>
            </label>
            <p className={styles.hint}>
              Materiais inativos ficam escondidos dos formulários operacionais, mas o histórico
              preserva todas as movimentações já registradas.
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

function formatarDecimal(n: number): string {
  return n.toFixed(2).replace('.', ',');
}
