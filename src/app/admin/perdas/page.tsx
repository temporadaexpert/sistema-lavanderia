import Link from 'next/link';
import { PERIODOS, parsePeriodo, resolverPeriodo } from '@/app/_lib/periodo';
import { MOTIVO_LABEL } from '@/app/_lib/motivos';
import { relatorioPerdas } from '@/app/_lib/perdaData';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = new Intl.NumberFormat('pt-BR');
const fmtData = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

function fmtMes(ym: string): string {
  const [ano, mes] = ym.split('-');
  const idx = parseInt(mes ?? '1', 10) - 1;
  return `${MESES_ABREV[idx] ?? mes}/${ano}`;
}

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function RelatorioPerdas({ searchParams }: PageProps) {
  const periodoKey = parsePeriodo(searchParams.periodo);
  const periodo = resolverPeriodo(periodoKey);
  const { resumo, porMotivo, porItem, porLote, mensal } = await relatorioPerdas(periodo);

  const semDados = resumo.totalPecas === 0;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Relatório de Perdas</h1>
        <p className={styles.intervalo}>
          {periodo.label} <span className={styles.muted}>· {periodo.rotuloIntervalo}</span>
        </p>
      </header>

      <nav className={styles.filtros} aria-label="Filtro de período">
        {PERIODOS.map((p) => (
          <Link
            key={p.key}
            href={`/admin/perdas?periodo=${p.key}`}
            className={`${styles.filtroItem} ${p.key === periodoKey ? styles.filtroItemAtivo : ''}`}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      <section className={styles.cards} aria-label="Resumo de perdas">
        <Card
          titulo="Peças perdidas"
          valor={fmtNum.format(resumo.totalPecas)}
          destaque={resumo.totalPecas > 0}
        />
        <Card
          titulo="Valor estimado"
          valor={fmtBRL.format(resumo.valorEstimado)}
          destaque={resumo.valorEstimado > 0}
          parcial={resumo.custoParcial}
        />
        <Card
          titulo="Lotes encerrados"
          valor={fmtNum.format(resumo.lotesEncerrados)}
        />
        <Card
          titulo="Média por lote"
          valor={
            resumo.lotesEncerrados > 0
              ? `${resumo.mediaPecasPorLote.toFixed(1)} peça(s)`
              : '—'
          }
        />
        <Card
          titulo="Motivo mais frequente"
          valor={
            resumo.motivoMaisFrequente
              ? `${MOTIVO_LABEL[resumo.motivoMaisFrequente.motivo]} (${resumo.motivoMaisFrequente.pecas})`
              : '—'
          }
        />
        <Card
          titulo="Item com maior perda"
          valor={
            resumo.itemMaiorPerda
              ? `${resumo.itemMaiorPerda.nome} (${resumo.itemMaiorPerda.pecas})`
              : '—'
          }
        />
      </section>

      {resumo.custoParcial && (
        <div className={styles.aviso} role="note">
          <strong>Custo parcial.</strong> {resumo.itensSemValorUnitario} item(ns) com baixa no
          período sem <code>valorUnitario</code> cadastrado — os totais de valor excluem esses
          itens. Cadastre o preço para precisão financeira das perdas.
        </div>
      )}

      {semDados && (
        <div className={styles.vazioGeral}>
          Nenhuma perda registrada no período selecionado. Perdas aparecem aqui quando um lote
          é encerrado com motivo no admin de lotes.
        </div>
      )}

      {!semDados && (
        <>
          <section className={styles.secao}>
            <div className={styles.secaoHeader}>
              <h2>Perdas por motivo</h2>
              <span className={styles.secaoSub}>
                Agrupa as baixas por motivo declarado no encerramento.
              </span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Motivo</th>
                    <th className={styles.num}>Peças perdidas</th>
                    <th className={styles.num}>Valor estimado</th>
                    <th className={styles.num}>Lotes afetados</th>
                  </tr>
                </thead>
                <tbody>
                  {porMotivo.map((m) => (
                    <tr key={m.motivo}>
                      <td>
                        <span className={`${styles.badgeMotivo} ${styles[`motivo_${m.motivo}`] ?? ''}`}>
                          {MOTIVO_LABEL[m.motivo]}
                        </span>
                      </td>
                      <td className={styles.num}>{fmtNum.format(m.pecas)}</td>
                      <td className={styles.num}>
                        {fmtBRL.format(m.valor)}
                        {m.custoParcial && <span className={styles.parcialMark}>*</span>}
                      </td>
                      <td className={styles.num}>{fmtNum.format(m.lotesAfetados)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.secao}>
            <div className={styles.secaoHeader}>
              <h2>Perdas por item</h2>
              <span className={styles.secaoSub}>Ordenado por valor estimado perdido.</span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className={styles.num}>Qtd perdida</th>
                    <th className={styles.num}>Valor unitário</th>
                    <th className={styles.num}>Valor estimado</th>
                    <th className={styles.num}>Lotes</th>
                  </tr>
                </thead>
                <tbody>
                  {porItem.map((i) => (
                    <tr key={i.itemId}>
                      <td>
                        {i.nomeItem}
                        {i.valorUnitario == null && (
                          <span className={styles.badgeSemPreco}>sem preço</span>
                        )}
                      </td>
                      <td className={styles.num}>{fmtNum.format(i.pecas)}</td>
                      <td className={styles.num}>
                        {i.valorUnitario != null ? (
                          fmtBRL.format(i.valorUnitario)
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                      <td className={styles.num}>
                        {i.valor != null ? (
                          fmtBRL.format(i.valor)
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                      <td className={styles.num}>{fmtNum.format(i.lotesAfetados)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.secao}>
            <div className={styles.secaoHeader}>
              <h2>Lotes encerrados com baixa</h2>
              <span className={styles.secaoSub}>
                Ordenado por impacto financeiro (valor estimado da baixa).
              </span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Lote</th>
                    <th>Encerrado em</th>
                    <th>Responsável</th>
                    <th>Motivo</th>
                    <th className={styles.num}>Itens</th>
                    <th className={styles.num}>Peças</th>
                    <th className={styles.num}>Valor estimado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {porLote.map((pl) => (
                    <tr key={pl.lote.id}>
                      <td>
                        <code className={styles.codigo}>{pl.lote.codigo}</code>
                      </td>
                      <td>{fmtData.format(new Date(pl.encerradoEm))}</td>
                      <td>{pl.encerradoPor || <span className={styles.muted}>—</span>}</td>
                      <td>
                        <span className={`${styles.badgeMotivo} ${styles[`motivo_${pl.motivo}`] ?? ''}`}>
                          {MOTIVO_LABEL[pl.motivo]}
                        </span>
                      </td>
                      <td className={styles.num}>{fmtNum.format(pl.itensDistintos)}</td>
                      <td className={styles.num}>{fmtNum.format(pl.pecas)}</td>
                      <td className={styles.num}>
                        {fmtBRL.format(pl.valor)}
                        {pl.custoParcial && <span className={styles.parcialMark}>*</span>}
                      </td>
                      <td>
                        <Link
                          href={`/admin/lotes-lavanderia/${pl.lote.id}`}
                          className={styles.detalheLink}
                        >
                          Ver →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.secao}>
            <div className={styles.secaoHeader}>
              <h2>Perdas por mês</h2>
              <span className={styles.secaoSub}>
                Agrupamento por data de encerramento (ordem cronológica).
              </span>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th className={styles.num}>Peças perdidas</th>
                    <th className={styles.num}>Valor estimado</th>
                    <th className={styles.num}>Lotes encerrados</th>
                  </tr>
                </thead>
                <tbody>
                  {mensal.map((m) => (
                    <tr key={m.mes}>
                      <td>{fmtMes(m.mes)}</td>
                      <td className={styles.num}>{fmtNum.format(m.pecas)}</td>
                      <td className={styles.num}>
                        {fmtBRL.format(m.valor)}
                        {m.custoParcial && <span className={styles.parcialMark}>*</span>}
                      </td>
                      <td className={styles.num}>{fmtNum.format(m.lotesEncerrados)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mensal.some((m) => m.custoParcial) && (
              <p className={styles.nota}>
                <span className={styles.parcialMark}>*</span> Mês contém itens sem valor unitário —
                total parcial.
              </p>
            )}
          </section>
        </>
      )}
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
        {parcial && <span className={styles.parcialMark} title="Valor parcial">*</span>}
      </div>
    </div>
  );
}
