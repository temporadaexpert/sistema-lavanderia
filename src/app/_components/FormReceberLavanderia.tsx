'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  DistribuicaoItemRetorno,
  LoteResumo,
} from '@/application/services/LoteLavanderiaService';
import type {
  LinhaDivergencia,
  LinhaRetornoAnormal,
} from '@/domain/errors/DomainErrors';
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

  // Modal de anomalia (retorno absurdamente alto). Independente do modal
  // de divergência — abre antes, exige confirmação consciente do operador
  // e re-submete com `confirmacaoAnormalidade=true`.
  const [anomalias, setAnomalias] = useState<readonly LinhaRetornoAnormal[]>([]);
  const [anormalidadeConfirmada, setAnormalidadeConfirmada] = useState(false);
  const dialogAnomaliaRef = useRef<HTMLDialogElement>(null);

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
    // Trocou de lote → invalida confirmação prévia de anomalia (anomalia
    // é por submissão, não por sessão).
    setAnormalidadeConfirmada(false);
  }

  function aoMudarQtd(itemId: string, valor: string) {
    setQuantidades((atual) => ({ ...atual, [itemId]: valor }));
  }

  // Submete o form. Se `extras` for passado, inclui campos do modal de
  // classificação (2ª submissão após o operador justificar a divergência).
  // `confirmacaoAnormalidade` é flag separada do classificação — pode vir
  // sozinha (operador confirmou retorno alto sem haver divergência) ou
  // junto (cenário raro: retorno alto E divergência simultaneamente).
  async function submeter(
    extras?: {
      classificacao?: ClassValor;
      origemDivergencia?: OrigemValor | '';
      motivoDescricao?: string;
      responsavelFechamento?: string;
      confirmacaoAnormalidade?: boolean;
    },
  ): Promise<AcaoResultado> {
    const form = formRef.current;
    if (!form) {
      return { ok: false, code: 'INTERNAL', error: 'Formulário não inicializado.' };
    }
    const formData = new FormData(form);
    if (extras) {
      if (extras.classificacao) {
        formData.set('classificacao', extras.classificacao);
      }
      if (extras.motivoDescricao !== undefined) {
        formData.set('motivoDescricao', extras.motivoDescricao);
      }
      if (extras.responsavelFechamento !== undefined) {
        formData.set('responsavelFechamento', extras.responsavelFechamento);
      }
      if (extras.origemDivergencia !== undefined) {
        formData.set('origemDivergencia', extras.origemDivergencia);
      }
      if (extras.confirmacaoAnormalidade) {
        formData.set('confirmacaoAnormalidade', 'on');
      }
    }
    return registrarRetornoLoteAction(formData);
  }

  async function aoSubmeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResultado(null);
    setLoading(true);
    try {
      // Se o operador já confirmou anomalia nesta submissão, mantém a
      // flag — caso contrário cada re-submit dispararia o modal de novo.
      const r = await submeter(
        anormalidadeConfirmada ? { confirmacaoAnormalidade: true } : undefined,
      );
      // Anomalia (retorno muito acima do esperado) tem prioridade: o
      // operador precisa confirmar o número antes de qualquer outra
      // classificação. Após confirmar, o re-submit pode ainda cair em
      // divergência → outro modal.
      if (!r.ok && r.code === 'RETORNO_ANORMAL_DETECTADO' && 'anomalias' in r) {
        setAnomalias(r.anomalias);
        setErroModal(null);
        dialogAnomaliaRef.current?.showModal();
        return;
      }
      // Caminho do bug original: o sistema detectava divergência mas não
      // oferecia caminho pra concluir. Agora abrimos modal automaticamente.
      // (`'divergencias' in r` narrows o discriminated union — só a variante
      // DIVERGENCIA_DETECTADA tem o campo, e o `code: string` da variante
      // genérica não permite narrow só por igualdade de string literal.)
      if (!r.ok && r.code === 'DIVERGENCIA_DETECTADA' && 'divergencias' in r) {
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
        setAnormalidadeConfirmada(false);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function confirmarAnormalidade() {
    setLoading(true);
    setErroModal(null);
    setAnormalidadeConfirmada(true);
    try {
      const r = await submeter({ confirmacaoAnormalidade: true });
      // Após confirmar anomalia, ainda pode haver divergência (proposto
      // alto não exclui faltas em outros itens). Cai no fluxo do segundo
      // modal nesse caso.
      if (!r.ok && r.code === 'DIVERGENCIA_DETECTADA' && 'divergencias' in r) {
        dialogAnomaliaRef.current?.close();
        setAnomalias([]);
        setDivergencias(r.divergencias);
        setClassificacao('');
        setOrigemDivergencia('');
        setMotivoDescricao('');
        setResponsavelFechamento(
          (formRef.current?.elements.namedItem('responsavel') as HTMLInputElement | null)
            ?.value ?? '',
        );
        dialogRef.current?.showModal();
        return;
      }
      dialogAnomaliaRef.current?.close();
      setAnomalias([]);
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

  function fecharModalAnomalia() {
    if (loading) return;
    dialogAnomaliaRef.current?.close();
    setAnomalias([]);
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
        confirmacaoAnormalidade: anormalidadeConfirmada,
      });
      if (!r.ok) {
        setErroModal(r.error);
        return;
      }
      // Sucesso na 2ª submissão — fecha modal, limpa form, refresh.
      dialogRef.current?.close();
      setResultado(r);
      setDivergencias([]);
      setAnormalidadeConfirmada(false);
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

        {resultado?.ok && resultado.distribuicao && (
          <RedistribuicaoBanner distribuicao={resultado.distribuicao} />
        )}
      </form>

      {/* Modal âmbar de ANOMALIA. Não bloqueia perda real — bloqueia
          erro de digitação grosseiro (ex.: 250 em vez de 25). Operador
          revisa o número, e confirma OU volta. Estilo cosmético âmbar
          (não vermelho) — alerta de atenção, não de erro fatal. */}
      <dialog ref={dialogAnomaliaRef} className={styles.modal}>
        <div className={styles.modalForm}>
          <header className={styles.modalHeader}>
            <h3 className={styles.modalTitulo}>
              <span className={styles.modalIconeAtencao} aria-hidden>?</span>
              Retorno acima do esperado
            </h3>
            <button
              type="button"
              onClick={fecharModalAnomalia}
              className={styles.modalFecharX}
              aria-label="Fechar"
              disabled={loading}
            >
              ×
            </button>
          </header>

          <div className={styles.modalAvisoAtencao}>
            <p>
              Atenção: a quantidade informada está bem acima da pendência
              total disponível. Confirme se o número está correto antes de
              prosseguir — pode ser erro de digitação.
            </p>
            <ul className={styles.modalLista}>
              {anomalias.map((a) => (
                <li key={a.itemId}>
                  <strong>{a.nomeItem}</strong>: você informou{' '}
                  <strong>{a.proposto}</strong>, mas a pendência total é{' '}
                  {a.pendenciaTotal} (limite aceitável: {a.limiteAceitavel}).
                  {' '}Se prosseguir, <strong>{a.excedenteProjetado}</strong>{' '}
                  ficaria como excedente operacional não conciliado.
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.modalAcoes}>
            <button
              type="button"
              onClick={fecharModalAnomalia}
              className={styles.modalBotaoSecundario}
              disabled={loading}
            >
              Voltar e revisar
            </button>
            <button
              type="button"
              onClick={confirmarAnormalidade}
              className={styles.modalBotaoPrimario}
              disabled={loading}
            >
              {loading ? 'Confirmando…' : 'Confirmo, prosseguir'}
            </button>
          </div>
        </div>
      </dialog>

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

// Aviso informativo (azul-claro, NÃO vermelho) que aparece quando o
// retorno foi redistribuído — operador devolveu mais peças do que a
// pendência atual do lote, e o sistema abateu em pendências anteriores
// do mesmo item ou registrou como excedente avulso. Só renderiza linhas
// que tiveram redistribuição efetiva (anterior ou excedente > 0).
function RedistribuicaoBanner({
  distribuicao,
}: {
  distribuicao: readonly DistribuicaoItemRetorno[];
}) {
  const linhasComRedistribuicao = distribuicao.filter(
    (d) => d.abatidoEmAnteriores > 0 || d.excedente > 0,
  );
  if (linhasComRedistribuicao.length === 0) return null;
  return (
    <div className={styles.infoRedistribuicao} role="status" aria-live="polite">
      <strong>Distribuição entre lotes:</strong>
      <ul className={styles.infoRedistribuicaoLista}>
        {linhasComRedistribuicao.map((linha) => (
          <li key={linha.itemId}>
            {textoDistribuicao(linha)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function textoDistribuicao(linha: DistribuicaoItemRetorno): string {
  // Extrai códigos dos lotes anteriores (alocações com loteId != null que
  // não correspondem ao "quitado lote atual"). O service ordena alocações
  // como [atual?, ...anteriores, excedente?], então pulamos a primeira
  // alocação não-nula quando há quitação no atual.
  const codigosAnteriores: string[] = [];
  let pulouAtual = linha.quitadoLoteAtual === 0; // se atual=0, não há lote a pular
  for (const a of linha.alocacoes) {
    if (a.loteId == null) continue;
    if (!pulouAtual) {
      pulouAtual = true;
      continue;
    }
    if (a.loteCodigo) codigosAnteriores.push(a.loteCodigo);
  }

  const partes: string[] = [];
  partes.push(
    `${linha.quantidadeRetornada} unidade(s) de ${linha.nomeItem} retornadas`,
  );
  if (linha.quitadoLoteAtual > 0) {
    partes.push(`${linha.quitadoLoteAtual} quitaram este envio`);
  }
  if (linha.abatidoEmAnteriores > 0) {
    partes.push(
      codigosAnteriores.length > 0
        ? `${linha.abatidoEmAnteriores} compensaram pendência anterior do(s) lote(s) ${codigosAnteriores.join(', ')}`
        : `${linha.abatidoEmAnteriores} compensaram pendência anterior`,
    );
  }
  if (linha.excedente > 0) {
    partes.push(
      `${linha.excedente} ficaram como excedente operacional não conciliado (auditável)`,
    );
  }
  return partes.join(' · ') + '.';
}
