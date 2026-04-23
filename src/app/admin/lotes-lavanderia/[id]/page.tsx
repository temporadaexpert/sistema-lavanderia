import Link from 'next/link';
import { notFound } from 'next/navigation';
import { detalheLote } from '@/app/_lib/loteData';
import { MOTIVO_LABEL } from '@/app/_lib/motivos';
import { EncerrarLoteDialog } from '@/app/_components/EncerrarLoteDialog';
import { LoteId } from '@/domain/types/ids';
import type {
  LoteStatus,
  MovimentacaoTipo,
} from '@/domain/types/enums';
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

interface PageProps {
  params: { id: string };
}

export default async function LoteDetalhe({ params }: PageProps) {
  const detalhe = await detalheLote(LoteId(params.id));
  if (!detalhe) notFound();

  const { lote, status } = detalhe;
  const podeEncerrar = !detalhe.encerrado && detalhe.pendenciaEfetiva > 0;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerNav}>
          <Link href="/admin/lotes-lavanderia" className={styles.voltar}>
            ← Lotes
          </Link>
          <span className={styles.badgeAdmin}>Admin</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
            <Link href="/admin" className={styles.muted} style={{ textDecoration: 'none', fontSize: 13 }}>
              Painel
            </Link>
            <Link href="/admin/materiais" className={styles.muted} style={{ textDecoration: 'none', fontSize: 13 }}>
              Materiais
            </Link>
            <Link href="/admin/locais" className={styles.muted} style={{ textDecoration: 'none', fontSize: 13 }}>
              Locais
            </Link>
            <Link href="/" className={styles.muted} style={{ textDecoration: 'none', fontSize: 13 }}>
              Operação
            </Link>
          </div>
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
            />
          )}
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
            Para receber o que ainda falta, volte para a <Link href="/">tela operacional</Link> e
            escolha <strong>Receber da lavanderia</strong>; esse lote aparecerá com a pendência
            pré-preenchida. Se a pendência não vai mais retornar, use <strong>Encerrar lote</strong>
            {' '}acima para registrar a baixa com motivo.
          </p>
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

function Card({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`${styles.card} ${destaque ? styles.cardDestaque : ''}`}>
      <div className={styles.cardTitulo}>{titulo}</div>
      <div className={styles.cardValor}>{valor}</div>
    </div>
  );
}
