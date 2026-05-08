import Link from 'next/link';
import { notFound } from 'next/navigation';
import { detalheLote, avaliarRiscoLote } from '@/app/_lib/loteData';
import { divergenciaPorLoteComContato } from '@/app/_lib/divergenciaData';
import { contatosPorLote } from '@/app/_lib/contatoData';
import { MOTIVO_LABEL } from '@/app/_lib/motivos';
import { EncerrarLoteDialog } from '@/app/_components/EncerrarLoteDialog';
import { CancelarLoteDuplicadoDialog } from '@/app/_components/CancelarLoteDuplicadoDialog';
import { RegistrarContatoDialog } from '@/app/_components/RegistrarContatoDialog';
import { LoteId } from '@/domain/types/ids';
import type {
  LoteStatus,
  MovimentacaoTipo,
  TipoContatoLavanderia,
} from '@/domain/types/enums';
import type {
  PrioridadeDivergencia,
  RecomendacaoAcao,
} from '@/application/services/DivergenciaService';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<LoteStatus, string> = {
  aberto: 'Aberto',
  retorno_parcial: 'Retorno parcial',
  concluido: 'Concluído',
  com_divergencia: 'Com divergência',
  encerrado_com_pendencia: 'Encerrado com pendência',
};
const STATUS_CLASS: Record<LoteStatus, string> = {
  aberto: 'statusAberto',
  retorno_parcial: 'statusParcial',
  concluido: 'statusConcluido',
  com_divergencia: 'statusDivergencia',
  encerrado_com_pendencia: 'statusEncerrado',
};
const STATUS_DESCRICAO: Record<LoteStatus, string> = {
  aberto: 'Nenhum retorno registrado ainda.',
  retorno_parcial: 'Lavanderia devolveu parte. Ainda há peças pendentes.',
  concluido: 'Todas as peças enviadas foram retornadas.',
  com_divergencia:
    'Pelo menos um item retornou em quantidade maior que o enviado, ou retornou um item que não estava no envio.',
  encerrado_com_pendencia:
    'Lote foi encerrado administrativamente com baixa de pendência registrada via ajuste.',
};

const TIPO_LABEL: Record<MovimentacaoTipo, string> = {
  entrada_deposito: 'Entrada depósito',
  saida_imovel: 'Saída imóvel',
  retorno_imovel: 'Retorno imóvel',
  envio_lavanderia: 'Envio',
  retorno_lavanderia: 'Retorno',
  ajuste: 'Ajuste',
};

const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const PRIORIDADE_LABEL: Record<PrioridadeDivergencia, string> = {
  critica: 'Crítica',
  excesso: 'Excesso',
  atencao: 'Atenção',
  aguardando: 'Aguardando',
  encerrado_baixado: 'Encerrada',
  ok: 'Ok',
};

const PRIORIDADE_DESCRICAO: Record<PrioridadeDivergencia, string> = {
  critica: 'Lote com divergência crítica: muito tempo em aberto ou valor alto.',
  excesso: 'Retorno excedeu o envio — provável erro de lançamento a investigar.',
  atencao: 'Divergência começando a ficar velha. Hora de cobrar a lavanderia.',
  aguardando: 'Pendência dentro do prazo esperado — aguardar retorno.',
  encerrado_baixado: 'Decisão administrativa já tomada, baixa registrada.',
  ok: 'Sem pendências.',
};

const RECOMENDACAO_LABEL: Record<RecomendacaoAcao, string> = {
  nenhuma: '',
  aguardar_retorno: 'Aguardar retorno',
  cobrar_lavanderia: 'Cobrar lavanderia',
  encerrar_com_baixa: 'Encerrar com baixa',
  verificar_lancamento: 'Verificar lançamento',
};

const RECOMENDACAO_DETALHE: Record<RecomendacaoAcao, string> = {
  nenhuma: '',
  aguardar_retorno: 'Prazo de devolução ainda dentro do esperado. Nenhuma ação imediata.',
  cobrar_lavanderia:
    'Entre em contato com a lavanderia. Confirme a data da próxima devolução e o motivo da demora.',
  encerrar_com_baixa:
    'Peças não vão mais retornar. Use o botão "Encerrar lote" para registrar a baixa com motivo — o saldo da lavanderia é ajustado automaticamente.',
  verificar_lancamento:
    'Houve retorno maior que o envio registrado. Revise as movimentações desse lote e verifique se algum lançamento ficou duplicado ou fora do lote certo.',
};

const TIPO_CONTATO_LABEL: Record<TipoContatoLavanderia, string> = {
  whatsapp: 'WhatsApp',
  telefone: 'Telefone',
  email: 'E-mail',
  presencial: 'Presencial',
  outro: 'Outro',
};

const TIPO_CONTATO_CLASS: Record<TipoContatoLavanderia, string> = {
  whatsapp: 'chipWhatsapp',
  telefone: 'chipTelefone',
  email: 'chipEmail',
  presencial: 'chipPresencial',
  outro: 'chipOutro',
};

function formatarPromessa(iso: string): string {
  const ymd = iso.slice(0, 10);
  const [ano, mes, dia] = ymd.split('-');
  return `${dia}/${mes}/${ano}`;
}

interface PageProps {
  params: { id: string };
}

export default async function LoteDetalhe({ params }: PageProps) {
  const loteId = LoteId(params.id);
  const [detalhe, divergencia, contatos, risco] = await Promise.all([
    detalheLote(loteId),
    divergenciaPorLoteComContato(loteId),
    contatosPorLote(loteId),
    avaliarRiscoLote(loteId),
  ]);
  if (!detalhe) notFound();

  const { lote, status } = detalhe;
  const podeEncerrar = !detalhe.encerrado && detalhe.pendenciaEfetiva > 0;
  const valorPendenteTotal = divergencia?.valorPendente ?? 0;
  const mostrarPrioridade =
    divergencia &&
    divergencia.prioridade !== 'ok' &&
    divergencia.prioridade !== 'encerrado_baixado';

  // Valor pendente por item, para a tabela — indexa direto por itemId.
  const valorPendentePorItem = new Map<string, { valorPendente: number | null; preco: number | null }>();
  if (divergencia) {
    for (const i of divergencia.itens) {
      valorPendentePorItem.set(i.itemId, {
        valorPendente: i.valorPendente,
        preco: i.precoEfetivo,
      });
    }
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerNav}>
          <Link href="/admin/lotes-lavanderia" className={styles.voltar}>
            ← Lotes
          </Link>
          <Link
            href={`/romaneio/lavanderia/${lote.id}`}
            className={styles.linkRomaneio}
            target="_blank"
            rel="noopener"
          >
            🖨 Imprimir romaneio
          </Link>
        </div>
        <div className={styles.headerTop}>
          <div>
            <h1>
              Lote <code className={styles.codigo}>{lote.codigo}</code>
            </h1>
            <p className={styles.subtitulo}>
              Enviado em {fmtDataHora.format(new Date(lote.dataEnvio))} por {lote.responsavel}
            </p>
          </div>
          <span className={`${styles.badge} ${styles[STATUS_CLASS[status]] ?? ''}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
      </header>

      {detalhe.encerrado && lote.encerradoEm && lote.motivoFechamento && (
        <div className={styles.bannerEncerrado} role="note">
          <div className={styles.bannerEncerradoTitulo}>
            Lote encerrado administrativamente
          </div>
          <dl className={styles.bannerEncerradoInfo}>
            <div>
              <dt>Motivo</dt>
              <dd>{MOTIVO_LABEL[lote.motivoFechamento]}</dd>
            </div>
            <div>
              <dt>Encerrado em</dt>
              <dd>{fmtDataHora.format(new Date(lote.encerradoEm))}</dd>
            </div>
            <div>
              <dt>Por</dt>
              <dd>{lote.encerradoPor ?? '—'}</dd>
            </div>
            {lote.motivoDescricao && (
              <div className={styles.bannerInfoFull}>
                <dt>Descrição</dt>
                <dd>{lote.motivoDescricao}</dd>
              </div>
            )}
            <div className={styles.bannerInfoFull}>
              <dt>Baixa realizada</dt>
              <dd>
                {detalhe.totalAjustado} peça(s) baixada(s) do saldo da lavanderia via ajuste
                vinculado ao lote.
              </dd>
            </div>
          </dl>
        </div>
      )}

      {divergencia?.estatisticaContato.promessaVencida && (
        <div className={styles.bannerPromessaVencida} role="alert">
          <div className={styles.bannerVencidaTopo}>
            <span className={styles.seloVencidaGrande}>PROMESSA VENCIDA</span>
            <span className={styles.bannerVencidaResumo}>
              há <strong>{divergencia.estatisticaContato.diasAtrasoPromessa} dia(s)</strong>
              {divergencia.estatisticaContato.dataPromessaVencida && (
                <>
                  {' '}· prometida para{' '}
                  <strong>
                    {formatarPromessa(divergencia.estatisticaContato.dataPromessaVencida)}
                  </strong>
                </>
              )}
            </span>
          </div>
          <p className={styles.bannerVencidaRecomendacao}>
            <strong>Cobrar imediatamente</strong> e considerar baixa se não houver retorno
            iminente. A lavanderia não cumpriu o prazo combinado.
          </p>
        </div>
      )}

      {mostrarPrioridade && divergencia && (
        <div
          className={`${styles.prioBanner} ${styles[`prio_${divergencia.prioridade}`] ?? ''}`}
          role="note"
        >
          <div className={styles.prioBannerTopo}>
            <span className={`${styles.prioSelo} ${styles[`prioSelo_${divergencia.prioridade}`] ?? ''}`}>
              {PRIORIDADE_LABEL[divergencia.prioridade]}
            </span>
            <span className={styles.prioBannerResumo}>
              {divergencia.diasDesdeEnvio} dia(s) em aberto · {' '}
              {divergencia.pendenciaEfetiva > 0 && (
                <>
                  <strong>{divergencia.pendenciaEfetiva}</strong> peça(s) pendente(s) ·{' '}
                </>
              )}
              {divergencia.excessoTotal > 0 && (
                <>
                  <strong>+{divergencia.excessoTotal}</strong> em excesso ·{' '}
                </>
              )}
              {valorPendenteTotal > 0
                ? fmtBRL.format(valorPendenteTotal)
                : divergencia.custoParcial
                  ? 'valor sem preço'
                  : fmtBRL.format(0)}
              {divergencia.custoParcial && <span className={styles.parcialMark}>*</span>}
            </span>
          </div>
          <p className={styles.prioBannerDescricao}>
            {PRIORIDADE_DESCRICAO[divergencia.prioridade]}
          </p>
          {divergencia.recomendacao !== 'nenhuma' && (
            <div className={styles.recomendacaoBox}>
              <div className={styles.recomendacaoTitulo}>
                <span className={styles.recomendacaoLabel}>Recomendação</span>
                <strong>{RECOMENDACAO_LABEL[divergencia.recomendacao]}</strong>
              </div>
              <p className={styles.recomendacaoDetalhe}>
                {RECOMENDACAO_DETALHE[divergencia.recomendacao]}
              </p>

              {/* Situação atual da cobrança + ação rápida */}
              <div className={styles.cobrancaStatus}>
                {divergencia.estatisticaContato.nuncaCobrado ? (
                  <span className={styles.cobrancaAlerta}>
                    Nenhuma cobrança registrada ainda.
                  </span>
                ) : (
                  <span className={styles.cobrancaInfo}>
                    Última cobrança há{' '}
                    <strong>
                      {divergencia.estatisticaContato.diasDesdeUltimoContato} dia(s)
                    </strong>{' '}
                    por{' '}
                    {divergencia.estatisticaContato.ultimo &&
                      TIPO_CONTATO_LABEL[divergencia.estatisticaContato.ultimo.tipo]}
                    {divergencia.estatisticaContato.promessaRetornoProxima && (
                      <>
                        {' '}· promessa:{' '}
                        <strong>
                          {formatarPromessa(
                            divergencia.estatisticaContato.promessaRetornoProxima,
                          )}
                        </strong>
                      </>
                    )}
                  </span>
                )}
                <RegistrarContatoDialog
                  loteId={lote.id}
                  loteCodigo={lote.codigo}
                  tamanhoBotao="pequeno"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {!detalhe.encerrado && status !== 'concluido' && (
        <div
          className={`${styles.alertBanner} ${
            status === 'com_divergencia' ? styles.alertBannerDivergencia : styles.alertBannerPendencia
          }`}
          role="note"
        >
          <div className={styles.alertBannerTexto}>
            <strong>{STATUS_LABEL[status]}:</strong> {STATUS_DESCRICAO[status]}
            {detalhe.pendenciaEfetiva > 0 && (
              <>
                {' '}Pendência atual: <strong>{detalhe.pendenciaEfetiva} peça(s)</strong>.
              </>
            )}
          </div>
          {podeEncerrar && (
            <EncerrarLoteDialog
              loteId={lote.id}
              loteCodigo={lote.codigo}
              pendenciaEfetiva={detalhe.pendenciaEfetiva}
              possuiDivergencia={detalhe.possuiDivergencia}
              risco={risco}
            />
          )}
        </div>
      )}

      {/* Cancelamento por duplicação/erro grave — disponível em QUALQUER
          estado do lote, exceto se já foi cancelado como duplicado
          (idempotente). Admin pode descobrir DEPOIS de ter encerrado
          como perda que era duplicado e querer reverter o "Perdas no mês". */}
      {lote.motivoFechamento !== 'duplicado' && (
        <div className={styles.acoesDestrutivas}>
          <CancelarLoteDuplicadoDialog
            loteId={lote.id}
            loteCodigo={lote.codigo}
            jaEncerrado={detalhe.encerrado}
            totalEnviado={detalhe.totalEnviado}
          />
        </div>
      )}

      <section className={styles.cards}>
        <Card titulo="Enviado" valor={`${detalhe.totalEnviado} peça(s)`} />
        <Card titulo="Retornado" valor={`${detalhe.totalRetornado} peça(s)`} />
        <Card
          titulo="Baixado por ajuste"
          valor={`${detalhe.totalAjustado} peça(s)`}
          destaque={detalhe.totalAjustado > 0}
        />
        <Card
          titulo="Pendência efetiva"
          valor={`${detalhe.pendenciaEfetiva} peça(s)`}
          destaque={detalhe.pendenciaEfetiva !== 0}
        />
        {divergencia && (
          <Card
            titulo="Valor estimado pendente"
            valor={fmtBRL.format(valorPendenteTotal)}
            destaque={valorPendenteTotal > 0}
            parcial={divergencia.custoParcial}
          />
        )}
      </section>

      <section className={styles.secao}>
        <div className={styles.secaoHeader}>
          <h2>Informações do lote</h2>
        </div>
        <dl className={styles.infoGrid}>
          <div>
            <dt>Origem</dt>
            <dd>{detalhe.origemNome}</dd>
          </div>
          <div>
            <dt>Destino</dt>
            <dd>{detalhe.destinoNome}</dd>
          </div>
          <div>
            <dt>Data de envio</dt>
            <dd>{fmtDataHora.format(new Date(lote.dataEnvio))}</dd>
          </div>
          <div>
            <dt>Responsável pelo envio</dt>
            <dd>{lote.responsavel}</dd>
          </div>
          <div className={styles.infoFull}>
            <dt>Observação</dt>
            <dd>{lote.observacao ?? <span className={styles.muted}>—</span>}</dd>
          </div>
        </dl>
      </section>

      <section className={styles.secao}>
        <div className={styles.secaoHeader}>
          <h2>Itens — pendência por item</h2>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Item</th>
                <th className={styles.num}>Enviado</th>
                <th className={styles.num}>Retornado</th>
                <th className={styles.num}>Pendência</th>
                <th className={styles.num}>Baixado</th>
                <th className={styles.num}>Efetiva</th>
                <th className={styles.num}>Valor pendente</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {detalhe.itens.map((linha) => {
                const ok = linha.pendenciaEfetiva === 0 && linha.pendencia >= 0;
                const divergencia = linha.totalRetornado > linha.totalEnviado;
                const pendenteEfetiva = linha.pendenciaEfetiva > 0;
                const baixada = linha.baixadoPorAjuste > 0;
                return (
                  <tr
                    key={linha.itemId}
                    className={
                      divergencia
                        ? styles.rowDivergencia
                        : pendenteEfetiva
                          ? styles.rowPendencia
                          : ''
                    }
                  >
                    <td>{linha.nomeItem}</td>
                    <td className={styles.num}>{linha.totalEnviado}</td>
                    <td className={styles.num}>{linha.totalRetornado}</td>
                    <td className={styles.num}>
                      {linha.pendencia > 0 ? (
                        <span className={styles.alerta}>{linha.pendencia}</span>
                      ) : linha.pendencia === 0 ? (
                        0
                      ) : (
                        <span className={styles.alerta}>
                          +{Math.abs(linha.pendencia)} (excedente)
                        </span>
                      )}
                    </td>
                    <td className={styles.num}>
                      {linha.baixadoPorAjuste > 0 ? (
                        <span className={styles.baixado}>{linha.baixadoPorAjuste}</span>
                      ) : (
                        <span className={styles.muted}>0</span>
                      )}
                    </td>
                    <td className={styles.num}>
                      {pendenteEfetiva ? (
                        <span className={styles.alerta}>{linha.pendenciaEfetiva}</span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className={styles.num}>
                      {(() => {
                        const info = valorPendentePorItem.get(linha.itemId);
                        if (!info || linha.pendenciaEfetiva === 0) {
                          return <span className={styles.muted}>—</span>;
                        }
                        if (info.valorPendente == null) {
                          return <span className={styles.semPreco}>sem preço</span>;
                        }
                        return <span className={styles.alerta}>{fmtBRL.format(info.valorPendente)}</span>;
                      })()}
                    </td>
                    <td>
                      {divergencia ? (
                        <span className={`${styles.badge} ${styles.statusDivergencia}`}>
                          Divergência
                        </span>
                      ) : pendenteEfetiva ? (
                        <span className={`${styles.badge} ${styles.statusParcial}`}>
                          Pendente
                        </span>
                      ) : baixada ? (
                        <span className={`${styles.badge} ${styles.statusEncerrado}`}>
                          Baixada
                        </span>
                      ) : ok ? (
                        <span className={`${styles.badge} ${styles.statusConcluido}`}>Ok</span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!detalhe.encerrado && detalhe.pendenciaEfetiva > 0 && (
          <p className={styles.dica}>
            Para receber o que ainda falta, volte para a <Link href="/operacao/acao/receber-lavanderia">tela de receber da lavanderia</Link> e
            escolha <strong>Receber da lavanderia</strong>; esse lote aparecerá com a pendência
            pré-preenchida. Se a pendência não vai mais retornar, use <strong>Encerrar lote</strong>
            {' '}acima para registrar a baixa com motivo.
          </p>
        )}
      </section>

      <section className={styles.secao}>
        <div className={styles.secaoHeaderFlex}>
          <div>
            <h2>Histórico de cobranças</h2>
            <p className={styles.secaoSub}>
              {contatos.length === 0
                ? 'Nenhuma cobrança registrada para este lote.'
                : `${contatos.length} registro(s) · ordem do mais recente ao mais antigo.`}
            </p>
          </div>
          {!detalhe.encerrado && (
            <RegistrarContatoDialog
              loteId={lote.id}
              loteCodigo={lote.codigo}
              tamanhoBotao="primario"
            />
          )}
        </div>

        {contatos.length === 0 ? (
          <div className={styles.vazio}>
            Nenhuma cobrança registrada. Quando entrar em contato com a lavanderia sobre este
            lote, use <strong>Registrar cobrança</strong> para deixar rastro — ajuda a escalar
            corretamente a decisão quando o lote ficar crítico.
          </div>
        ) : (
          <ol className={styles.timeline}>
            {contatos.map((c) => (
              <li key={c.id} className={styles.timelineItem}>
                <div className={styles.timelineTopo}>
                  <span
                    className={`${styles.tipoChip} ${styles[TIPO_CONTATO_CLASS[c.tipo]] ?? ''}`}
                  >
                    {TIPO_CONTATO_LABEL[c.tipo]}
                  </span>
                  <span className={styles.timelineData}>
                    {fmtDataHora.format(new Date(c.dataHora))} · por {c.responsavel}
                  </span>
                </div>
                {c.observacao && (
                  <p className={styles.timelineObservacao}>{c.observacao}</p>
                )}
                <div className={styles.timelineMeta}>
                  {c.promessaRetornoData && (
                    <span className={styles.timelinePromessa}>
                      Promessa de retorno:{' '}
                      <strong>{formatarPromessa(c.promessaRetornoData)}</strong>
                    </span>
                  )}
                  {c.proximaAcao && (
                    <span className={styles.timelineProxima}>
                      Próxima ação: {c.proximaAcao}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={styles.secao}>
        <div className={styles.secaoHeader}>
          <h2>Movimentações vinculadas ao lote</h2>
        </div>
        {detalhe.movimentacoes.length === 0 ? (
          <div className={styles.vazio}>Nenhuma movimentação.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Data/hora</th>
                  <th>Tipo</th>
                  <th>Item</th>
                  <th className={styles.num}>Qtd</th>
                  <th>Responsável</th>
                  <th>Observação</th>
                </tr>
              </thead>
              <tbody>
                {detalhe.movimentacoes.map((m) => {
                  const nomeItem =
                    detalhe.itens.find((i) => i.itemId === m.itemId)?.nomeItem ?? m.itemId;
                  return (
                    <tr key={m.id} className={m.tipo === 'ajuste' ? styles.rowAjuste : ''}>
                      <td>{fmtDataHora.format(new Date(m.dataHora))}</td>
                      <td>{TIPO_LABEL[m.tipo]}</td>
                      <td>{nomeItem}</td>
                      <td className={styles.num}>{m.quantidade}</td>
                      <td>{m.responsavel}</td>
                      <td className={styles.muted}>{m.observacao ? m.observacao : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Card({
  titulo,
  valor,
  destaque,
  parcial,
}: {
  titulo: string;
  valor: string;
  destaque?: boolean;
  parcial?: boolean;
}) {
  return (
    <div className={`${styles.card} ${destaque ? styles.cardDestaque : ''}`}>
      <div className={styles.cardTitulo}>{titulo}</div>
      <div className={styles.cardValor}>
        {valor}
        {parcial && <span className={styles.parcialMark}>*</span>}
      </div>
    </div>
  );
}
