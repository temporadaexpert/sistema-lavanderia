import Link from 'next/link';
import { listarLotes } from '@/app/_lib/loteData';
import type { LoteResumo } from '@/application/services/LoteLavanderiaService';
import type { LoteStatus } from '@/domain/types/enums';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<LoteStatus, string> = {
  aberto: 'Aberto',
  retorno_parcial: 'Retorno parcial',
  concluido: 'Concluído',
  com_divergencia: 'Com divergência',
  encerrado_com_pendencia: 'Encerrado',
};

const STATUS_CLASS: Record<LoteStatus, string> = {
  aberto: 'statusAberto',
  retorno_parcial: 'statusParcial',
  concluido: 'statusConcluido',
  com_divergencia: 'statusDivergencia',
  encerrado_com_pendencia: 'statusEncerrado',
};

const FILTROS: readonly { key: string; label: string; predicate: (r: LoteResumo) => boolean }[] = [
  { key: 'todos', label: 'Todos', predicate: () => true },
  {
    key: 'abertos',
    label: 'Abertos / parciais',
    predicate: (r) =>
      !r.encerrado &&
      (r.status === 'aberto' || r.status === 'retorno_parcial' || r.status === 'com_divergencia'),
  },
  { key: 'concluidos', label: 'Concluídos', predicate: (r) => r.status === 'concluido' },
  {
    key: 'divergencia',
    label: 'Com divergência',
    predicate: (r) => r.status === 'com_divergencia',
  },
  { key: 'encerrados', label: 'Encerrados', predicate: (r) => r.encerrado },
];

const fmtData = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function LotesLavanderiaListagem({ searchParams }: PageProps) {
  const filtroKey = typeof searchParams.filtro === 'string' ? searchParams.filtro : 'todos';
  const filtroAtivo = FILTROS.find((f) => f.key === filtroKey) ?? FILTROS[0]!;

  const todos = await listarLotes();
  const lista = todos.filter(filtroAtivo.predicate);

  const totais = {
    total: todos.length,
    abertos: todos.filter((r) => !r.encerrado && r.status === 'aberto').length,
    parciais: todos.filter((r) => !r.encerrado && r.status === 'retorno_parcial').length,
    concluidos: todos.filter((r) => r.status === 'concluido').length,
    divergencia: todos.filter((r) => !r.encerrado && r.status === 'com_divergencia').length,
    encerrados: todos.filter((r) => r.encerrado).length,
    // Pendência ATIVA: só conta lotes não encerrados. Lotes encerrados
    // tiveram a pendência baixada via ajuste e não representam mais perda
    // em aberto — entram em relatório histórico, não em pendência atual.
    pendenciaAcumulada: todos
      .filter((r) => !r.encerrado)
      .reduce((s, r) => s + Math.max(r.pendenciaEfetiva, 0), 0),
  };

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerNav}>
          <Link href="/admin" className={styles.voltar}>
            ← Painel
          </Link>
          <span className={styles.badgeAdmin}>Admin</span>
          <div className={styles.linksLateral}>
            <Link href="/admin/materiais" className={styles.linkLateral}>
              Materiais
            </Link>
            <Link href="/admin/locais" className={styles.linkLateral}>
              Locais
            </Link>
            <Link href="/admin/lavanderia" className={styles.linkLateral}>
              Relatório de custos
            </Link>
            <Link href="/admin/perdas" className={styles.linkLateral}>
              Perdas
            </Link>
            <Link href="/" className={styles.linkLateral}>
              Operação
            </Link>
          </div>
        </div>
        <h1>Lotes de Lavanderia</h1>
        <p className={styles.subtitulo}>Controle por remessa — envio, retorno, pendência, encerramento</p>
      </header>

      <section className={styles.cards}>
        <Card titulo="Total de lotes" valor={String(totais.total)} />
        <Card titulo="Abertos" valor={String(totais.abertos)} destaque={totais.abertos > 0} />
        <Card titulo="Parciais" valor={String(totais.parciais)} destaque={totais.parciais > 0} />
        <Card titulo="Concluídos" valor={String(totais.concluidos)} />
        <Card
          titulo="Com divergência"
          valor={String(totais.divergencia)}
          destaque={totais.divergencia > 0}
        />
        <Card titulo="Encerrados" valor={String(totais.encerrados)} />
        <Card
          titulo="Pendência em aberto"
          valor={`${totais.pendenciaAcumulada} peça(s)`}
          destaque={totais.pendenciaAcumulada > 0}
        />
      </section>

      <nav className={styles.filtros} aria-label="Filtro de status">
        {FILTROS.map((f) => (
          <Link
            key={f.key}
            href={`?filtro=${f.key}`}
            className={`${styles.filtroItem} ${f.key === filtroAtivo.key ? styles.filtroItemAtivo : ''}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <section className={styles.secao}>
        <div className={styles.secaoHeader}>
          <h2>{lista.length} lote(s) — {filtroAtivo.label.toLowerCase()}</h2>
        </div>
        {lista.length === 0 ? (
          <div className={styles.vazio}>Nenhum lote nesse filtro.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Data envio</th>
                  <th>Responsável</th>
                  <th className={styles.num}>Enviado</th>
                  <th className={styles.num}>Retornado</th>
                  <th className={styles.num}>Pendente</th>
                  <th>Status</th>
                  <th>Observação</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => {
                  const pendenteExibicao = r.encerrado ? 0 : r.pendenciaEfetiva;
                  return (
                    <tr key={r.lote.id} className={r.encerrado ? styles.rowEncerrado : ''}>
                      <td>
                        <code className={styles.codigo}>{r.lote.codigo}</code>
                      </td>
                      <td>{fmtData.format(new Date(r.lote.dataEnvio))}</td>
                      <td>{r.lote.responsavel}</td>
                      <td className={styles.num}>{r.totalEnviado}</td>
                      <td className={styles.num}>{r.totalRetornado}</td>
                      <td
                        className={`${styles.num} ${
                          pendenteExibicao > 0 ? styles.alerta : ''
                        }`}
                      >
                        {r.encerrado && r.pendenciaTotal > 0 ? (
                          <span className={styles.muted} title="Pendência baixada via encerramento">
                            0 (baixado: {r.totalAjustado})
                          </span>
                        ) : r.pendenciaTotal > 0 ? (
                          r.pendenciaEfetiva
                        ) : r.pendenciaTotal === 0 ? (
                          0
                        ) : (
                          `+${Math.abs(r.pendenciaTotal)}`
                        )}
                      </td>
                      <td>
                        <span
                          className={`${styles.badge} ${styles[STATUS_CLASS[r.status]] ?? ''}`}
                        >
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className={styles.observacao}>
                        {r.lote.observacao ? r.lote.observacao : <span className={styles.muted}>—</span>}
                      </td>
                      <td>
                        <Link
                          href={`/admin/lotes-lavanderia/${r.lote.id}`}
                          className={styles.detalheLink}
                        >
                          Ver detalhe →
                        </Link>
                      </td>
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
