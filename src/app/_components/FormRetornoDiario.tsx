'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ContadorItem } from './ContadorItem';
import { salvarRetornoDiarioAction } from '../_lib/controleDiarioActions';
import type { AcaoResultado } from '../_lib/actions';
import type { LinhaDivergenciaDiariaDetectada } from '@/domain/errors/DomainErrors';
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

// 5 classificações no fechamento DIÁRIO. Diferente do lote (que tem 6 com
// retorno_parcial), aqui não tem "parcial" porque o operador usa o botão
// "Salvar parcial" pra esse fluxo.
const CLASSIFICACOES = [
  { valor: 'perda', rotulo: 'Perda', desc: 'Peças confirmadamente perdidas.' },
  { valor: 'dano', rotulo: 'Dano', desc: 'Peças voltaram danificadas.' },
  { valor: 'extravio', rotulo: 'Extravio', desc: 'Peças sumiram (em rota, etc).' },
  {
    valor: 'erro_operacional',
    rotulo: 'Erro operacional',
    desc: 'Contagem ou registro errado.',
  },
  { valor: 'outro', rotulo: 'Outro', desc: 'Descreva no campo abaixo.' },
] as const;
type ClassValor = (typeof CLASSIFICACOES)[number]['valor'];

const ORIGENS = [
  { valor: 'lavanderia', rotulo: 'Lavanderia' },
  { valor: 'imovel', rotulo: 'Imóvel' },
  { valor: 'operacao', rotulo: 'Operação interna' },
  { valor: 'desconhecida', rotulo: 'Desconhecida' },
] as const;
type OrigemValor = (typeof ORIGENS)[number]['valor'];

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
  const [classificacao, setClassificacao] = useState<ClassValor | ''>('');
  const [origemDivergencia, setOrigemDivergencia] = useState<OrigemValor | ''>('');
  const [erroModal, setErroModal] = useState<string | null>(null);
  // Snapshot do que o SERVIDOR retornou ao detectar divergência live.
  // Sobrescreve `linhasFaltanteHoje` (snapshot pré-renderizado) na tela
  // do modal — cobre o cenário "operador alterou números mas não salvou".
  const [linhasServidor, setLinhasServidor] = useState<readonly LinhaDivergenciaDiariaDetectada[]>([]);
  const [totaisServidor, setTotaisServidor] = useState<{ falt: number; exc: number } | null>(null);

  async function enviar(
    fechar: boolean,
    extras?: {
      motivoDivergencia?: string;
      responsavelFechamento?: string;
      classificacao?: ClassValor;
      origemDivergencia?: OrigemValor;
    },
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
    if (extras?.classificacao) {
      formData.set('classificacaoDivergencia', extras.classificacao);
    }
    if (extras?.origemDivergencia) {
      formData.set('origemDivergencia', extras.origemDivergencia);
    }

    setLoading(true);
    setResultado(null);
    try {
      const r = await salvarRetornoDiarioAction(formData);

      // GATILHO REATIVO: server detectou divergência sem classificação.
      // Resolve o bug do print do usuário: o snapshot pré-renderizado
      // (`temDivergenciaHoje`) podia estar desatualizado em relação aos
      // números digitados no form. Agora abrimos modal independente disso.
      if (!r.ok && 'divergencias' in r && r.code === 'DIVERGENCIA_DIARIA_DETECTADA') {
        setLinhasServidor(r.divergencias);
        setTotaisServidor({ falt: r.totalFaltante, exc: r.totalExcedente });
        setClassificacao('');
        setOrigemDivergencia('');
        setMotivoModal('');
        setResponsavelFechamentoModal(responsavel);
        setErroModal(null);
        dialogRef.current?.showModal();
        return r;
      }

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
      // Pré-emptivo: abre modal direto baseado no SNAPSHOT (já sabemos
      // que tem divergência). Evita um round-trip. Se snapshot estiver
      // desatualizado e não houver divergência live, o submit do modal
      // ainda pode falhar — mas isso é raro.
      setLinhasServidor([]); // usa linhasFaltanteHoje (snapshot)
      setTotaisServidor(null);
      setClassificacao('');
      setOrigemDivergencia('');
      setMotivoModal('');
      setResponsavelFechamentoModal(responsavel);
      setErroModal(null);
      dialogRef.current?.showModal();
    } else {
      // Submete; o gatilho reativo dentro de `enviar` abre o modal se
      // o servidor detectar divergência (form-live).
      void enviar(true);
    }
  }

  async function confirmarFechamentoComDivergencia(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!classificacao) {
      setErroModal('Selecione uma classificação para concluir.');
      return;
    }
    if (!origemDivergencia) {
      setErroModal('Selecione a origem provável da divergência.');
      return;
    }
    const motivo = motivoModal.trim();
    if (classificacao === 'outro' && !motivo) {
      setErroModal('Quando a classificação é "outro", descreva o motivo.');
      return;
    }
    const resp = responsavelFechamentoModal.trim();
    if (!resp) {
      setErroModal('Informe quem está autorizando o fechamento com divergência.');
      return;
    }
    const r = await enviar(true, {
      motivoDivergencia: motivo,
      responsavelFechamento: resp,
      classificacao,
      origemDivergencia,
    });
    if (r && !r.ok && r.code !== 'DIVERGENCIA_DIARIA_DETECTADA') {
      setErroModal(r.error);
    }
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
              {(totaisServidor?.falt ?? totalFaltanteHoje) > 0 && (
                <>
                  Faltando{' '}
                  <strong>
                    {totaisServidor?.falt ?? totalFaltanteHoje} peça(s)
                  </strong>
                </>
              )}
              {(totaisServidor?.exc ?? totalExcedenteHoje) > 0 && (
                <>
                  {(totaisServidor?.falt ?? totalFaltanteHoje) > 0 ? ' e ' : ''}
                  sobrando{' '}
                  <strong>
                    {totaisServidor?.exc ?? totalExcedenteHoje} peça(s)
                  </strong>
                </>
              )}
              . Para fechar o dia assim, classifique e descreva.
            </p>
            {(linhasServidor.length > 0 ? linhasServidor : linhasFaltanteHoje).length > 0 && (
              <ul className={styles.modalLista}>
                {/* Prioriza linhas vindas do server (form-live state); cai
                    pra snapshot pré-renderizado quando server não bateu ainda. */}
                {linhasServidor.length > 0
                  ? linhasServidor.map((l) => (
                      <li key={l.itemId}>
                        {l.nomeItem}:{' '}
                        {l.faltante > 0 && <strong>−{l.faltante}</strong>}
                        {l.faltante > 0 && l.excedente > 0 && ' / '}
                        {l.excedente > 0 && <strong>+{l.excedente}</strong>}
                      </li>
                    ))
                  : linhasFaltanteHoje.map((l) => (
                      <li key={l.itemId}>
                        {l.nomeItem}: <strong>−{l.faltante}</strong>
                      </li>
                    ))}
              </ul>
            )}
          </div>

          <fieldset className={styles.modalCampo}>
            <legend className={styles.modalLabel}>Classificação (obrigatório)</legend>
            <div className={styles.classificacaoGrid}>
              {CLASSIFICACOES.map((c) => (
                <label
                  key={c.valor}
                  className={`${styles.classificacaoItem} ${
                    classificacao === c.valor ? styles.classificacaoItemAtivo : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="classificacaoModal"
                    value={c.valor}
                    checked={classificacao === c.valor}
                    onChange={() => setClassificacao(c.valor)}
                    className={styles.classificacaoRadio}
                  />
                  <span className={styles.classificacaoRotulo}>{c.rotulo}</span>
                  <span className={styles.classificacaoDescricao}>{c.desc}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className={styles.modalCampo}>
            <span className={styles.modalLabel}>
              Origem provável da divergência (obrigatório)
            </span>
            <select
              className={styles.modalInput}
              value={origemDivergencia}
              onChange={(e) => setOrigemDivergencia(e.target.value as OrigemValor | '')}
              disabled={loading}
            >
              <option value="">Selecione onde a peça provavelmente sumiu…</option>
              {ORIGENS.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.modalCampo}>
            <span className={styles.modalLabel}>
              Descrição
              {classificacao === 'outro'
                ? ' (obrigatório para "Outro")'
                : ' (opcional)'}
            </span>
            <textarea
              className={styles.modalTextarea}
              rows={3}
              maxLength={500}
              placeholder='Ex.: "2 toalhas rasgaram na lavagem; 1 fronha esquecida no imóvel 302."'
              value={motivoModal}
              onChange={(e) => setMotivoModal(e.target.value)}
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
              disabled={
                loading ||
                !classificacao ||
                !origemDivergencia ||
                !responsavelFechamentoModal.trim() ||
                (classificacao === 'outro' && !motivoModal.trim())
              }
            >
              {loading ? 'Fechando…' : 'Confirmar fechamento com divergência'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
