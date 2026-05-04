import Link from 'next/link';
import {
  filtrarLotesParaRomaneio,
  listarLotes,
  type FiltroStatusRomaneio,
} from '@/app/_lib/loteData';
import { hojeISO } from '@/app/_lib/controleDiarioData';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const fmtNum = new Intl.NumberFormat('pt-BR');

function parseStatus(raw: unknown): FiltroStatusRomaneio {
  if (raw === 'aberto' || raw === 'encerrado') return raw;
  return 'todos';
}

function parseDataYmd(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fallback;
  if (Number.isNaN(Date.parse(raw))) return fallback;
  return raw;
}

interface Props {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function RomaneiosLavanderiaPage({ searchParams }: Props) {
  const hoje = hojeISO();
  // Default: hoje em ambas as datas — operador procura "o que mandei hoje"
  // sem precisar mexer no filtro. Se quiser histórico, expande pra trás.
  const dataInicial = parseDataYmd(searchParams.dataInicial, hoje);
  const dataFinal = parseDataYmd(searchParams.dataFinal, hoje);
  const status = parseStatus(searchParams.status);
  const responsavel =
    typeof searchParams.responsavel === 'string' ? searchParams.responsavel : '';

  const todos = await listarLotes();
  const lotes = filtrarLotesParaRomaneio(todos, {
    dataInicial,
    dataFinal,
    status,
    responsavel,
  });

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <span className={styles.badge}>Romaneios</span>
        <h1>Romaneios de envio para lavanderia</h1>
        <p className={styles.subtitulo}>
          Reimprima qualquer romaneio já gerado. A consulta lê os lotes existentes
          (data/lotes.json) — não cria nem altera nada.
        </p>
      </header>

      <form className={styles.filtros} action="" method="get">
        <label className={styles.campo}>
          <span className={styles.label}>Data inicial</span>
          <input
            type="date"
            name="dataInicial"
            defaultValue={dataInicial}
            className={styles.input}
          />
        </label>
        <label className={styles.campo}>
          <span className={styles.label}>Data final</span>
          <input
            type="date"
            name="dataFinal"
            defaultValue={dataFinal}
            className={styles.input}
          />
        </label>
        <label className={styles.campo}>
          <span className={styles.label}>Status</span>
          <select name="status" defaultValue={status} className={styles.input}>
            <option value="todos">Todos</option>
            <option value="aberto">Apenas abertos</option>
            <option value="encerrado">Apenas encerrados</option>
          </select>
        </label>
        <label className={styles.campo}>
          <span className={styles.label}>Responsável (opcional)</span>
          <input
            type="text"
            name="responsavel"
            defaultValue={responsavel}
            placeholder="Ana, Bruno…"
            className={styles.input}
            maxLength={120}
          />
        </label>
        <div className={styles.acoes}>
          <button type="submit" className={styles.botaoFiltrar}>
            Buscar
          </button>
          <Link href="/admin/romaneios-lavanderia" className={styles.botaoLimpar}>
            Limpar
          </Link>
        </div>
      </form>

      <section className={styles.resultadoSecao}>
        <div className={styles.resultadoHeader}>
          <h2>{lotes.length} romaneio(s) encontrado(s)</h2>
          <span className={styles.dica}>
            Período: {dataInicial} até {dataFinal} · Status: {status}
          </span>
        </div>

        {lotes.length === 0 ? (
          <div className={styles.vazio}>
            Nenhum romaneio nesse filtro. Tente ampliar o período ou trocar o status.
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Data envio</th>
                  <th>Responsável</th>
                  <th>Origem → Destino</th>
                  <th className={styles.num}>Peças</th>
                  <th>Status</th>
                  <th className={styles.acoesCol}></th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((r) => {
                  const totalPecas = r.totalEnviado;
                  const statusLabel = r.encerrado
                    ? 'Encerrado'
                    : r.status === 'concluido'
                      ? 'Concluído'
                      : r.status === 'retorno_parcial'
                        ? 'Retorno parcial'
                        : r.status === 'com_divergencia'
                          ? 'Com divergência'
                          : 'Aberto';
                  const statusClasse = r.encerrado
                    ? styles.statusEncerrado
                    : r.status === 'concluido'
                      ? styles.statusConcluido
                      : styles.statusAberto;
                  return (
                    <tr key={r.lote.id}>
                      <td>
                        <code className={styles.codigo}>{r.lote.codigo}</code>
                      </td>
                      <td>{fmtDataHora.format(new Date(r.lote.dataEnvio))}</td>
                      <td>{r.lote.responsavel}</td>
                      <td>
                        <span className={styles.muted}>depósito → lavanderia</span>
                      </td>
                      <td className={styles.num}>{fmtNum.format(totalPecas)}</td>
                      <td>
                        <span className={`${styles.badgeStatus} ${statusClasse}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className={styles.acoesCol}>
                        <Link
                          href={`/romaneio/lavanderia/${r.lote.id}`}
                          className={styles.botaoImprimir}
                          target="_blank"
                          rel="noopener"
                        >
                          🖨 Imprimir
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

      <p className={styles.rodape}>
        Reimpressão é apenas leitura: nenhum lote é recriado, nenhuma movimentação
        gerada, nenhuma métrica do dashboard alterada.
      </p>
    </main>
  );
}
