'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ContadorItem } from './ContadorItem';
import { salvarRetornoDiarioAction } from '../_lib/controleDiarioActions';
import type { AcaoResultado } from '../_lib/actions';
import styles from './FormRetornoDiario.module.css';

interface ItemOpcao {
  readonly id: string;
  readonly nome: string;
  readonly categoria: string;
}

interface ValoresItem {
  readonly sujo: number;
  readonly limpo: number;
}

interface LinhaResumoDivergencia {
  readonly itemId: string;
  readonly nomeItem: string;
  readonly faltante: number;
}

interface Props {
  readonly dataHoje: string;
  readonly itens: readonly ItemOpcao[];
  readonly valoresIniciais: ReadonlyMap<string, ValoresItem>;
  readonly responsavelInicial: string | null;
  readonly jaFechado: boolean;
  // Projeção ao vivo da divergência (calculada no server com base no
  // retorno já salvo). Se a funcionária clicar "Salvar e fechar", usamos
  // isso pra decidir se abrimos o modal de motivo obrigatório.
  readonly temDivergenciaHoje: boolean;
  readonly totalFaltanteHoje: number;
  readonly totalExcedenteHoje: number;
  readonly linhasFaltanteHoje: readonly LinhaResumoDivergencia[];
}

export function FormRetornoDiario({
  dataHoje,
  itens,
  valoresIniciais,
  responsavelInicial,
  jaFechado,
  temDivergenciaHoje,
  totalFaltanteHoje,
  totalExcedenteHoje,
  linhasFaltanteHoje,
}: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState(dataHoje);
  const [responsavel, setResponsavel] = useState(responsavelInicial ?? '');
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);

  // Estado do modal de fechamento com divergência
  const [motivoModal, setMotivoModal] = useState('');
  const [responsavelFechamentoModal, setResponsavelFechamentoModal] = useState('');
  const [erroModal, setErroModal] = useState<string | null>(null);

  async function enviar(
    fechar: boolean,
    extras?: { motivoDivergencia?: string; responsavelFechamento?: string },
  ) {
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    if (fechar) formData.set('fecharDia', 'on');
    else formData.delete('fecharDia');
    if (extras?.motivoDivergencia) {
      formData.set('motivoDivergencia', extras.motivoDivergencia);
    }
    if (extras?.responsavelFechamento) {
      formData.set('responsavelFechamento', extras.responsavelFechamento);
    }

    setLoading(true);
    setResultado(null);
    try {
      const r = await salvarRetornoDiarioAction(formData);
      setResultado(r);
      if (r.ok) {
        dialogRef.current?.close();
        router.refresh();
      } else {
        return r;
      }
    } finally {
      setLoading(false);
    }
    return { ok: true as const };
  }

  function aoClicarFechar() {
    if (temDivergenciaHoje) {
      // Abre modal obrigatório com motivo + responsável
      setMotivoModal('');
      setResponsavelFechamentoModal(responsavel);
      setErroModal(null);
      dialogRef.current?.showModal();
    } else {
      // Sem divergência: fecha direto
      void enviar(true);
    }
  }

  async function confirmarFechamentoComDivergencia(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const motivo = motivoModal.trim();
    const resp = responsavelFechamentoModal.trim();
    if (!motivo) {
      setErroModal('Descreva o que aconteceu com as peças faltantes.');
      return;
    }
    if (!resp) {
      setErroModal('Informe quem está autorizando o fechamento com divergência.');
      return;
    }
    const r = await enviar(true, {
      motivoDivergencia: motivo,
      responsavelFechamento: resp,
    });
    if (r && !r.ok) setErroModal(r.error);
  }

  function fecharModal() {
    if (loading) return;
    dialogRef.current?.close();
    setErroModal(null);
  }

  return (
    <>
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(false);
        }}
        className={styles.form}
      >
        <div className={styles.cabecalho}>
          <label className={styles.campo}>
            <span className={styles.label}>Data</span>
            <input
              type="date"
              name="data"
              value={data}
              onChange={(e) => setData(e.target.value)}
              required
              className={styles.input}
            />
          </label>
          <label className={styles.campo}>
            <span className={styles.label}>Responsável</span>
            <input
              type="text"
              name="responsavel"
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              required
              maxLength={120}
              autoComplete="off"
              className={styles.input}
            />
          </label>
        </div>

        <div className={styles.legenda}>
          <span className={styles.pilulaSujo}>Sujo — vai pra lavanderia</span>
          <span className={styles.pilulaLimpo}>Limpo — volta pro estoque</span>
        </div>

        <div className={styles.listaTitulo}>
          <p className={styles.listaTituloTexto}>Materiais</p>
          <span className={styles.listaContador}>{itens.length} item(ns)</span>
        </div>

        <ul className={styles.lista}>
          {itens.map((item) => {
            const val = valoresIniciais.get(item.id);
            return (
              <li key={item.id} className={styles.linha}>
                <div className={styles.info}>
                  <div className={styles.nome}>{item.nome}</div>
                  <div className={styles.categoria}>{item.categoria}</div>
                </div>
                <div className={styles.contadores}>
                  <div className={`${styles.contadorBloco} ${styles.contadorSujo}`}>
                    <span className={styles.miniLabelSujo}>Sujo</span>
                    <ContadorItem
                      inputName={`sujo[${item.id}]`}
                      valorInicial={val?.sujo ?? 0}
                      destaque="sujo"
                    />
                  </div>
                  <div className={`${styles.contadorBloco} ${styles.contadorLimpo}`}>
                    <span className={styles.miniLabelLimpo}>Limpo</span>
                    <ContadorItem
                      inputName={`limpo[${item.id}]`}
                      valorInicial={val?.limpo ?? 0}
                      destaque="limpo"
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {resultado && !resultado.ok && (
          <div className={styles.erro} role="alert">
            <span aria-hidden>⚠</span>
            <span>{resultado.error}</span>
          </div>
        )}
        {resultado?.ok && resultado.mensagem && (
          <div className={styles.sucesso} role="status">
            <span aria-hidden>✓</span>
            <span>{resultado.mensagem}</span>
          </div>
        )}

        {jaFechado && (
          <div className={styles.bloqueio}>
            Dia já fechado — para alterar, abra um novo dia.
          </div>
        )}

        <div className={styles.acoes}>
          <button
            type="submit"
            className={styles.botaoSecundario}
            disabled={loading || jaFechado}
          >
            {loading ? 'Salvando…' : 'Salvar parcial'}
          </button>
          <button
            type="button"
            className={styles.botaoPrimario}
            disabled={loading || jaFechado}
            onClick={aoClicarFechar}
          >
            {loading ? '…' : 'Salvar e fechar o dia'}
          </button>
        </div>
      </form>

      {/* Modal obrigatório quando fecha com divergência */}
      <dialog ref={dialogRef} className={styles.modal}>
        <form onSubmit={confirmarFechamentoComDivergencia} className={styles.modalForm}>
          <header className={styles.modalHeader}>
            <h3 className={styles.modalTitulo}>
              <span className={styles.modalIconeAlerta} aria-hidden>!</span>
              Fechar o dia com divergência
            </h3>
            <button
              type="button"
              onClick={fecharModal}
              className={styles.modalFecharX}
              aria-label="Fechar"
              disabled={loading}
            >
              ×
            </button>
          </header>

          <div className={styles.modalAviso}>
            <p>
              Estão faltando <strong>{totalFaltanteHoje} peça(s)</strong>
              {totalExcedenteHoje > 0 && (
                <>
                  {' '}e sobrando <strong>{totalExcedenteHoje} peça(s)</strong>
                </>
              )}
              . Para fechar o dia assim, é obrigatório registrar o motivo.
            </p>
            {linhasFaltanteHoje.length > 0 && (
              <ul className={styles.modalLista}>
                {linhasFaltanteHoje.map((l) => (
                  <li key={l.itemId}>
                    {l.nomeItem}: <strong>−{l.faltante}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className={styles.modalCampo}>
            <span className={styles.modalLabel}>Motivo (obrigatório)</span>
            <textarea
              className={styles.modalTextarea}
              rows={3}
              maxLength={500}
              placeholder="Ex.: 2 toalhas rasgaram na lavagem; 1 fronha esquecida no imóvel 302."
              value={motivoModal}
              onChange={(e) => setMotivoModal(e.target.value)}
              autoFocus
            />
          </label>

          <label className={styles.modalCampo}>
            <span className={styles.modalLabel}>Quem autoriza o fechamento</span>
            <input
              type="text"
              className={styles.modalInput}
              maxLength={120}
              placeholder="Nome do gestor / supervisor"
              value={responsavelFechamentoModal}
              onChange={(e) => setResponsavelFechamentoModal(e.target.value)}
            />
          </label>

          {erroModal && (
            <div className={styles.modalErro} role="alert">
              {erroModal}
            </div>
          )}

          <div className={styles.modalAcoes}>
            <button
              type="button"
              onClick={fecharModal}
              className={styles.modalBotaoSecundario}
              disabled={loading}
            >
              Voltar
            </button>
            <button
              type="submit"
              className={styles.modalBotaoPrimario}
              disabled={loading || !motivoModal.trim() || !responsavelFechamentoModal.trim()}
            >
              {loading ? 'Fechando…' : 'Confirmar fechamento com divergência'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
