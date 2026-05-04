'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Item } from '@/domain/entities/Item';
import type { Category } from '@/domain/entities/Category';
import {
  atualizarMaterialAction,
  criarMaterialAction,
  type AcaoResultado,
} from '../_lib/materialActions';
import { criarCategoriaAction } from '../_lib/categoryActions';
import styles from './MaterialFormDialog.module.css';

type Modo = 'criar' | 'editar';

interface Props {
  modo: Modo;
  item?: Item;
  // Categorias ativas, vindas do server. Select abaixo é populado com essas.
  categoriasConhecidas: readonly Category[];
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
  const categoriaDialogRef = useRef<HTMLDialogElement>(null);
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Categoria selecionada como estado local: precisa ser controlada pra
  // conseguir atualizar o valor após criar nova categoria no sub-modal
  // (select nativo não atualiza via refresh sozinho enquanto o form ainda
  // está aberto). `categorias` local também é atualizada otimisticamente
  // pra evitar depender só do router.refresh pra aparecer no select.
  const [categorias, setCategorias] = useState<readonly Category[]>(categoriasConhecidas);
  const [categoriaSelecionada, setCategoriaSelecionada] = useState<string>(
    item?.categoriaId ?? '',
  );

  // Estado do sub-modal "+ Nova categoria"
  const [novoNomeCategoria, setNovoNomeCategoria] = useState('');
  const [categoriaLoading, setCategoriaLoading] = useState(false);
  const [categoriaErro, setCategoriaErro] = useState<string | null>(null);

  function abrir() {
    setResultado(null);
    // Re-sincroniza com as props a cada abertura (caso o server component
    // tenha atualizado a lista entre interações).
    setCategorias(categoriasConhecidas);
    setCategoriaSelecionada(item?.categoriaId ?? '');
    dialogRef.current?.showModal();
  }
  function fechar() {
    if (loading) return;
    dialogRef.current?.close();
  }

  function abrirDialogoNovaCategoria() {
    setNovoNomeCategoria('');
    setCategoriaErro(null);
    categoriaDialogRef.current?.showModal();
  }
  function fecharDialogoNovaCategoria() {
    if (categoriaLoading) return;
    categoriaDialogRef.current?.close();
  }

  async function confirmarNovaCategoria(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nome = novoNomeCategoria.trim();
    if (!nome) {
      setCategoriaErro('Informe o nome da categoria.');
      return;
    }
    setCategoriaLoading(true);
    setCategoriaErro(null);
    try {
      const fd = new FormData();
      fd.set('nome', nome);
      const r = await criarCategoriaAction(fd);
      if (!r.ok) {
        setCategoriaErro(r.error);
        return;
      }
      // Atualização otimista: adiciona à lista local e seleciona direto.
      setCategorias((atual) => {
        const nova = [...atual, r.categoria].sort((a, b) =>
          a.nome.localeCompare(b.nome, 'pt-BR'),
        );
        return nova;
      });
      setCategoriaSelecionada(r.categoria.id);
      categoriaDialogRef.current?.close();
      // Refresh também, pra o server component refletir.
      router.refresh();
    } finally {
      setCategoriaLoading(false);
    }
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
              <label className={styles.label} htmlFor="categoriaId">
                Categoria
              </label>
              <div className={styles.categoriaRow}>
                <select
                  id="categoriaId"
                  name="categoriaId"
                  className={styles.input}
                  required
                  value={categoriaSelecionada}
                  onChange={(e) => setCategoriaSelecionada(e.target.value)}
                >
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={styles.botaoCategoria}
                  onClick={abrirDialogoNovaCategoria}
                  title="Criar nova categoria"
                >
                  + Nova
                </button>
              </div>
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

          <div className={styles.row}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="estoqueTotal">
                Estoque total{' '}
                <span className={styles.hint}>(peças compradas — define disponibilidade)</span>
              </label>
              <input
                id="estoqueTotal"
                name="estoqueTotal"
                type="number"
                min={0}
                step={1}
                className={styles.input}
                defaultValue={item?.estoqueTotal ?? ''}
                placeholder="Ex.: 120"
              />
              <p className={styles.hint}>
                Em branco = item sem limite total. Quando preenchido, o sistema calcula
                automaticamente <strong>disponível = total − em uso − em lavanderia</strong>.
              </p>
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

      {/* Sub-modal: criar nova categoria sem sair do formulário do material.
          Usa <dialog> aninhado — pode conviver com o dialog do material
          porque o browser empilha o showModal() corretamente. */}
      <dialog
        ref={categoriaDialogRef}
        className={styles.subDialog}
        onClose={() => {
          setNovoNomeCategoria('');
          setCategoriaErro(null);
        }}
      >
        <form onSubmit={confirmarNovaCategoria} className={styles.subForm}>
          <header className={styles.subHeader}>
            <h4>Nova categoria</h4>
            <button
              type="button"
              className={styles.fecharX}
              aria-label="Fechar"
              onClick={fecharDialogoNovaCategoria}
              disabled={categoriaLoading}
            >
              ×
            </button>
          </header>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="novoNomeCategoria">
              Nome da categoria
            </label>
            <input
              id="novoNomeCategoria"
              type="text"
              className={styles.input}
              maxLength={60}
              autoFocus
              value={novoNomeCategoria}
              onChange={(e) => setNovoNomeCategoria(e.target.value)}
              placeholder="Ex.: Roupa de mesa"
            />
          </div>
          {categoriaErro && (
            <div className={styles.erro} role="alert">
              {categoriaErro}
            </div>
          )}
          <div className={styles.acoes}>
            <button
              type="button"
              className={styles.botaoSecundario}
              onClick={fecharDialogoNovaCategoria}
              disabled={categoriaLoading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={styles.botaoPrimario}
              disabled={categoriaLoading || !novoNomeCategoria.trim()}
            >
              {categoriaLoading ? 'Criando…' : 'Criar categoria'}
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
