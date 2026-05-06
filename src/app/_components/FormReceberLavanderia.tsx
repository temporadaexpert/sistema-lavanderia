'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoteResumo } from '@/application/services/LoteLavanderiaService';
import type { LinhaDivergencia } from '@/domain/errors/DomainErrors';
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

// 6 classificações que o operador pode escolher quando há divergência.
// 5 fecham o lote com motivo correspondente; `retorno_parcial` mantém
// o lote aberto (mais peças virão).
const CLASSIFICACOES = [
  {
    valor: 'perda',
    rotulo: 'Perda',
    descricao: 'Peças confirmadamente perdidas pela lavanderia.',
  },
  {
    valor: 'dano',
    rotulo: 'Dano',
    descricao: 'Peças voltaram danificadas e foram descartadas.',
  },
  {
    valor: 'extravio',
    rotulo: 'Extravio',
    descricao: 'Peças sumiram (em rota, no imóvel, etc).',
  },
  {
    valor: 'erro_operacional',
    rotulo: 'Erro operacional',
    descricao: 'Contagem ou registro errado em algum ponto.',
  },
  {
    valor: 'retorno_parcial',
    rotulo: 'Retorno parcial',
    descricao: 'Mais peças virão — não fechar lote agora.',
  },
  { valor: 'outro', rotulo: 'Outro', descricao: 'Descreva no campo abaixo.' },
] as const;

type ClassValor = (typeof CLASSIFICACOES)[number]['valor'];

// 4 origens prováveis da divergência (valor → label visível). Obrigatório
// quando classificação fecha o lote (não-retorno_parcial). Aceita null pra
// "retorno_parcial" porque ainda não há divergência consolidada.
const ORIGENS = [
  { valor: 'lavanderia', rotulo: 'Lavanderia' },
  { valor: 'imovel', rotulo: 'Imóvel' },
  { valor: 'operacao', rotulo: 'Operação interna' },
  { valor: 'desconhecida', rotulo: 'Desconhecida' },
] as const;

type OrigemValor = (typeof ORIGENS)[number]['valor'];

export function FormReceberLavanderia({ lotesAbertos, pendenciasPorLote }: Props) {
  const [loteSelecionado, setLoteSelecionado] = useState<string>('');
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Estado do modal de classificação (aparece quando o submit volta com
  // code='DIVERGENCIA_DETECTADA'). Operador escolhe motivo + descrição
  // + responsável de fechamento, e re-submete via `submeter(extras)`.
  const [divergencias, setDivergencias] = useState<readonly LinhaDivergencia[]>([]);
  const [classificacao, setClassificacao] = useState<ClassValor | ''>('');
  const [origemDivergencia, setOrigemDivergencia] = useState<OrigemValor | ''>('');
  const [motivoDescricao, setMotivoDescricao] = useState('');
  const [responsavelFechamento, setResponsavelFechamento] = useState('');
  const [erroModal, setErroModal] = useState<string | null>(null);

  // Origem é exigida quando a classificação FECHA o lote (5 das 6 opções).
  // Para 'retorno_parcial' fica opcional — nada de divergência consolidada
  // ainda. UI esconde/mostra "obrigatório" baseado nisso.
  const origemObrigatoria =
    classificacao !== '' && classificacao !== 'retorno_parcial';

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

  // Submete o form. Se `extras` for passado, inclui campos do modal de
  // classificação (2ª submissão após o operador justificar a divergência).
  async function submeter(
    extras?: {
      classificacao: ClassValor;
      origemDivergencia: OrigemValor | '';
      motivoDescricao: string;
      responsavelFechamento: string;
    },
  ): Promise<AcaoResultado> {
    const form = formRef.current;
    if (!form) {
      return { ok: false, code: 'INTERNAL', error: 'Formulário não inicializado.' };
    }
    const formData = new FormData(form);
    if (extras) {
      formData.set('classificacao', extras.classificacao);
      formData.set('motivoDescricao', extras.motivoDescricao);
      formData.set('responsavelFechamento', extras.responsavelFechamento);
      // Origem só vai quando preenchida — string vazia = service trata como null.
      formData.set('origemDivergencia', extras.origemDivergencia);
    }
    return registrarRetornoLoteAction(formData);
  }

  async function aoSubmeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResultado(null);
    setLoading(true);
    try {
      const r = await submeter();
      // Caminho do bug original: o sistema detectava divergência mas não
      // oferecia caminho pra concluir. Agora abrimos modal automaticamente.
      // (`'divergencias' in r` narrows o discriminated union — só a variante
      // DIVERGENCIA_DETECTADA tem o campo, e o `code: string` da variante
      // genérica não permite narrow só por igualdade de string literal.)
      if (!r.ok && 'divergencias' in r) {
        setDivergencias(r.divergencias);
        setClassificacao('');
        setOrigemDivergencia('');
        setMotivoDescricao('');
        setResponsavelFechamento(
          (formRef.current?.elements.namedItem('responsavel') as HTMLInputElement | null)
            ?.value ?? '',
        );
        setErroModal(null);
        dialogRef.current?.showModal();
        return; // não exibe `resultado` — o modal substitui o feedback
      }
      setResultado(r);
      if (r.ok) {
        setLoteSelecionado('');
        setQuantidades({});
        formRef.current?.reset();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function confirmarComJustificativa(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!classificacao) {
      setErroModal('Selecione uma classificação para concluir.');
      return;
    }
    if (classificacao === 'outro' && !motivoDescricao.trim()) {
      setErroModal('Quando a classificação é "outro", descreva o motivo.');
      return;
    }
    if (origemObrigatoria && !origemDivergencia) {
      setErroModal(
        'Selecione a origem provável da divergência (lavanderia, imóvel, operação ou desconhecida).',
      );
      return;
    }
    if (!responsavelFechamento.trim()) {
      setErroModal('Informe quem está autorizando a conclusão.');
      return;
    }
    setLoading(true);
    setErroModal(null);
    try {
      const r = await submeter({
        classificacao,
        origemDivergencia,
        motivoDescricao: motivoDescricao.trim(),
        responsavelFechamento: responsavelFechamento.trim(),
      });
      if (!r.ok) {
        setErroModal(r.error);
        return;
      }
      // Sucesso na 2ª submissão — fecha modal, limpa form, refresh.
      dialogRef.current?.close();
      setResultado(r);
      setDivergencias([]);
      setLoteSelecionado('');
      setQuantidades({});
      formRef.current?.reset();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  function fecharModal() {
    if (loading) return;
    dialogRef.current?.close();
    setErroModal(null);
  }

  if (lotesAbertos.length === 0) {
    return (
      <div className={styles.vazio}>
        Nenhum lote aberto ou com retorno parcial. Crie um lote em <strong>Enviar para lavanderia</strong> para poder registrar retornos.
      </div>
    );
  }

  return (
    <>
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

      {/* Modal de classificação obrigatório quando há divergência sem
          motivo. O operador NÃO pode avançar sem escolher uma das 6
          opções. Após confirmação, o submit re-roda com `classificacao`
          e o service registra retorno + (se aplicável) fecha o lote. */}
      <dialog ref={dialogRef} className={styles.modal}>
        <form onSubmit={confirmarComJustificativa} className={styles.modalForm}>
          <header className={styles.modalHeader}>
            <h3 className={styles.modalTitulo}>
              <span className={styles.modalIconeAlerta} aria-hidden>!</span>
              Divergência detectada
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
              {divergencias.reduce((s, l) => s + l.diferenca, 0)} peça(s) faltando
              em {divergencias.length} item(ns). Para concluir, escolha o que aconteceu:
            </p>
            <ul className={styles.modalLista}>
              {divergencias.map((l) => (
                <li key={l.itemId}>
                  <strong>{l.nomeItem}</strong>: enviado {l.enviado}, retornado {l.retornado}
                  {' '}· <span className={styles.destaque}>faltam {l.diferenca}</span>
                </li>
              ))}
            </ul>
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
                    name="classificacao"
                    value={c.valor}
                    checked={classificacao === c.valor}
                    onChange={() => setClassificacao(c.valor)}
                    className={styles.classificacaoRadio}
                  />
                  <span className={styles.classificacaoRotulo}>{c.rotulo}</span>
                  <span className={styles.classificacaoDescricao}>{c.descricao}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className={styles.modalCampo}>
            <span className={styles.modalLabel}>
              Origem provável da divergência
              {origemObrigatoria ? ' (obrigatório)' : ' (opcional)'}
            </span>
            <select
              className={styles.modalInput}
              value={origemDivergencia}
              onChange={(e) => setOrigemDivergencia(e.target.value as OrigemValor | '')}
              disabled={loading}
            >
              <option value="">
                {origemObrigatoria
                  ? 'Selecione onde a peça provavelmente sumiu…'
                  : 'Não aplicável (retorno parcial)'}
              </option>
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
              placeholder="Detalhe o que aconteceu — fica gravado para auditoria e cobrança."
              value={motivoDescricao}
              onChange={(e) => setMotivoDescricao(e.target.value)}
            />
          </label>

          <label className={styles.modalCampo}>
            <span className={styles.modalLabel}>Quem está autorizando</span>
            <input
              type="text"
              className={styles.modalInput}
              maxLength={120}
              placeholder="Nome do gestor / supervisor (ou seu próprio)"
              value={responsavelFechamento}
              onChange={(e) => setResponsavelFechamento(e.target.value)}
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
                !responsavelFechamento.trim() ||
                (origemObrigatoria && !origemDivergencia)
              }
            >
              {loading ? 'Concluindo…' : 'Confirmar retorno com divergência'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function formatarData(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
