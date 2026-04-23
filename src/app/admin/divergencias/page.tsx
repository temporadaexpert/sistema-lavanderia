import Link from 'next/link';
import { listarDivergencias } from '@/app/_lib/divergenciaData';
import type {
  DivergenciaLote,
  PrioridadeDivergencia,
  RecomendacaoAcao,
} from '@/application/services/DivergenciaService';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = new Intl.NumberFormat('pt-BR');
const fmtData = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

const PRIORIDADE_LABEL: Record<PrioridadeDivergencia, string> = {
  critica: 'Crítica',
  excesso: 'Excesso',
  atencao: 'Atenção',
  aguardando: 'Aguardando',
  encerrado_baixado: 'Encerrado',
  ok: 'Ok',
};

const PRIORIDADE_CLASS: Record<PrioridadeDivergencia, string> = {
  critica: 'prioCritica',
  excesso: 'prioExcesso',
  atencao: 'prioAtencao',
  aguardando: 'prioAguardando',
  encerrado_baixado: 'prioEncerrado',
  ok: 'prioOk',
};

const RECOMENDACAO_LABEL: Record<RecomendacaoAcao, string> = {
  nenhuma: '—',
  aguardar_retorno: 'Aguardar retorno',
  cobrar_lavanderia: 'Cobrar lavanderia',
  encerrar_com_baixa: 'Encerrar com baixa',
  verificar_lancamento: 'Verificar lançamento',
};

interface FiltroConfig {
  readonly key: string;
  readonly label: string;
  readonly predicate: (d: DivergenciaLote) => boolean;
}

const FILTROS: readonly FiltroConfig[] = [
  {
    key: 'ativos',
    label: 'Ativos',
    predicate: (d) =>
      d.prioridade === 'critica' ||
      d.prioridade === 'atencao' ||
      d.prioridade === 'aguardando' ||
      d.prioridade === 'excesso',
  },
  { key: 'critica', label: 'Críticas', predicate: (d) => d.prioridade === 'critica' },
  { key: 'atencao', label: 'Atenção', predicate: (d) => d.prioridade === 'atencao' },
  {
    key: 'aguardando',
    label: 'Aguardando',
    predicate: (d) => d.prioridade === 'aguardando',
  },
  { key: 'excesso', label: 'Excesso', predicate: (d) => d.prioridade === 'excesso' },
  {
    key: 'encerrado_baixado',
    label: 'Encerrados',
    predicate: (d) => d.prioridade === 'encerrado_baixado',
  },
  { key: 'todos', label: 'Todos', predicate: () => true },
];

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function DivergenciasListagem({ searchParams }: PageProps) {
  const filtroKey = typeof searchParams.filtro === 'string' ? searchParams.filtro : 'ativos';
  const filtroAtivo = FILTROS.find((f) => f.key === filtroKey) ?? FILTROS[0]!;

  const todas = await listarDivergencias();
  const lista = todas.filter(filtroAtivo.predicate);

  const totais = {
    criticas: todas.filter((d) => d.prioridade === 'critica').length,
    atencao: todas.filter((d) => d.prioridade === 'atencao').length,
    aguardando: todas.filter((d) => d.prioridade === 'aguardando').length,
    excesso: todas.filter((d) => d.prioridade === 'excesso').length,
    encerrados: todas.filter((d) => d.prioridade === 'encerrado_baixado').length,
    valorAtivo: todas
      .filter(
        (d) =>
          d.prioridade === 'critica' ||
          d.prioridade === 'atencao' ||
          d.prioridade === 'aguardando',
      )
      .reduce((s, d) => s + d.valorPendente, 0),
    pecasAtivas: todas
      .filter(
        (d) =>
          d.prioridade === 'critica' ||
          d.prioridade === 'atencao' ||
          d.prioridade === 'aguardando',
      )
      .reduce((s, d) => s + d.pendenciaEfetiva, 0),
    custoParcial: todas.some(
      (d) =>
        d.custoParcial &&
        (d.prioridade === 'critica' ||
          d.prioridade === 'atencao' ||
          d.prioridade === 'aguardando'),
    ),
  };

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <h1>Divergências de Lavanderia</h1>
          <p className={styles.subtitulo}>
            Priorização por tempo em aberto e valor estimado pendente. Ação recomendada por
            lote, com link direto para o detalhe.
          </p>
        </div>
      </header>

      <section className={styles.cards}>
        <Card
          titulo="Críticas"
          valor={fmtNum.format(totais.criticas)}
          cor="danger"
          destaque={totais.criticas > 0}
        />
        <Card
          titulo="Atenção"
          valor={fmtNum.format(totais.atencao)}
          cor="warn"
          destaque={totais.atencao > 0}
        />
        <Card titulo="Aguardando" valor={fmtNum.format(totais.aguardando)} cor="info" />
        <Card
          titulo="Excesso"
          valor={fmtNum.format(totais.excesso)}
          cor="excesso"
          destaque={totais.excesso > 0}
        />
        <Card
          titulo="Peças pendentes"
          valor={`${fmtNum.format(totais.pecasAtivas)} peça(s)`}
        />
        <Card
          titulo="Valor estimado pendente"
          valor={fmtBRL.format(totais.valorAtivo)}
          parcial={totais.custoParcial}
          destaque={totais.valorAtivo > 0}
        />
      </section>

      {totais.custoParcial && (
        <div className={styles.aviso} role="note">
          <strong>Custo parcial.</strong> Há itens pendentes sem <code>valorUnitario</code>{' '}
          cadastrado — o total financeiro exclui esses itens. Ajuste o cadastro em
          {' '}<Link href="/admin/materiais">Materiais</Link>.
        </div>
      )}

      <nav className={styles.filtros} aria-label="Filtro de prioridade">
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
          <h2>
            {fmtNum.format(lista.length)} lote(s) — {filtroAtivo.label.toLowerCase()}
          </h2>
        </div>

        {lista.length === 0 ? (
          <div className={styles.vazio}>Nenhuma divergência neste filtro.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Envio</th>
                  <th className={styles.num}>Dias</th>
                  <th>Prioridade</th>
                  <th>Item crítico</th>
                  <th className={styles.num}>Env.</th>
                  <th className={styles.num}>Ret.</th>
                  <th className={styles.num}>Baix.</th>
                  <th className={styles.num}>Pend.</th>
                  <th className={styles.num}>Valor pendente</th>
                  <th>Ação recomendada</th>
                  <th>Responsável</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lista.flatMap((d) => linhasDoLote(d))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className={styles.rodape}>
        Prioridade: <strong>crítica</strong> (≥14 dias em aberto ou ≥R$500 pendente),{' '}
        <strong>atenção</strong> (≥7 dias ou ≥R$200), <strong>aguardando</strong> (dentro do
        prazo), <strong>excesso</strong> (retorno maior que envio — verificar lançamento),{' '}
        <strong>encerrado</strong> (baixa já registrada).
      </p>
    </main>
  );
}

// Cada lote vira N linhas (uma por item divergente) mais uma linha-cabeçalho.
// Em lotes com 1 item só, fica compacto. Em lotes com 2+ itens, agrupa
// visualmente por lote com rowSpan nas colunas compartilhadas.
function linhasDoLote(d: DivergenciaLote) {
  const itensRelevantes = d.itens.filter(
    (i) => i.pendenciaEfetiva > 0 || i.excesso > 0,
  );

  // Se o lote não tem item relevante (ok/encerrado sem pendência), mostra
  // uma linha única resumindo o lote.
  const itens = itensRelevantes.length === 0 ? d.itens.slice(0, 1) : itensRelevantes;

  return itens.map((item, idx) => {
    const primeiraLinha = idx === 0;
    const rowSpan = itens.length;
    return (
      <tr
        key={`${d.lote.id}-${item.itemId}`}
        className={styles[PRIORIDADE_CLASS[d.prioridade] + 'Row'] ?? ''}
      >
        {primeiraLinha && (
          <>
            <td rowSpan={rowSpan} className={styles.colLote}>
              <code className={styles.codigo}>{d.lote.codigo}</code>
            </td>
            <td rowSpan={rowSpan}>{fmtData.format(new Date(d.lote.dataEnvio))}</td>
            <td rowSpan={rowSpan} className={styles.num}>
              <span className={d.diasDesdeEnvio >= 14 ? styles.diasCritico : d.diasDesdeEnvio >= 7 ? styles.diasAtencao : ''}>
                {fmtNum.format(d.diasDesdeEnvio)}
              </span>
            </td>
            <td rowSpan={rowSpan}>
              <span className={`${styles.badge} ${styles[PRIORIDADE_CLASS[d.prioridade]] ?? ''}`}>
                {PRIORIDADE_LABEL[d.prioridade]}
              </span>
            </td>
          </>
        )}
        <td>{item.nomeItem}</td>
        <td className={styles.num}>{fmtNum.format(item.enviado)}</td>
        <td className={styles.num}>{fmtNum.format(item.retornado)}</td>
        <td className={styles.num}>{fmtNum.format(item.baixado)}</td>
        <td
          className={`${styles.num} ${
            item.pendenciaEfetiva > 0 ? styles.pendenteDestaque : ''
          } ${item.excesso > 0 ? styles.excessoDestaque : ''}`}
        >
          {item.excesso > 0
            ? `+${fmtNum.format(item.excesso)}`
            : fmtNum.format(item.pendenciaEfetiva)}
        </td>
        <td className={styles.num}>
          {item.valorPendente != null ? (
            fmtBRL.format(item.valorPendente)
          ) : item.pendenciaEfetiva > 0 ? (
            <span className={styles.semValor}>sem preço</span>
          ) : (
            <span className={styles.muted}>—</span>
          )}
        </td>
        {primeiraLinha && (
          <>
            <td rowSpan={rowSpan} className={styles.recomendacao}>
              {RECOMENDACAO_LABEL[d.recomendacao]}
            </td>
            <td rowSpan={rowSpan}>{d.lote.responsavel}</td>
            <td rowSpan={rowSpan}>
              <Link
                href={`/admin/lotes-lavanderia/${d.lote.id}`}
                className={styles.detalheLink}
              >
                Ver →
              </Link>
            </td>
          </>
        )}
      </tr>
    );
  });
}

function Card({
  titulo,
  valor,
  cor,
  destaque,
  parcial,
}: {
  titulo: string;
  valor: string;
  cor?: 'danger' | 'warn' | 'info' | 'excesso';
  destaque?: boolean;
  parcial?: boolean;
}) {
  const corClasse = cor ? styles[`card_${cor}`] : '';
  return (
    <div className={`${styles.card} ${corClasse ?? ''} ${destaque ? styles.cardDestaque : ''}`}>
      <div className={styles.cardTitulo}>{titulo}</div>
      <div className={styles.cardValor}>
        {valor}
        {parcial && <span className={styles.parcialMark}>*</span>}
      </div>
    </div>
  );
}
