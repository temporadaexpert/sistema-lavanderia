import Link from 'next/link';
import { PERIODOS, parsePeriodo, resolverPeriodo } from '@/app/_lib/periodo';
import { relatorioLavanderia } from '@/app/_lib/adminData';
import type { DetalheItemLavanderia } from '@/application/services/RelatorioLavanderiaService';
import styles from './page.module.css';

const ORDENS = ['volume', 'custo', 'diferenca'] as const;
type Ordem = (typeof ORDENS)[number];

const ORDEM_LABEL: Record<Ordem, string> = {
  volume: 'Volume',
  custo: 'Custo',
  diferenca: 'Diferença',
};

const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = new Intl.NumberFormat('pt-BR');

function sinalPecas(n: number): string {
  if (n === 0) return '0';
  return (n > 0 ? '+' : '') + fmtNum.format(n);
}
function sinalValor(n: number): string {
  if (n === 0) return fmtBRL.format(0);
  const prefix = n > 0 ? '+ ' : '- ';
  return prefix + fmtBRL.format(Math.abs(n));
}
function fmtMesRotulo(ym: string): string {
  const [ano, mes] = ym.split('-');
  const idx = parseInt(mes ?? '1', 10) - 1;
  return `${MESES_ABREV[idx] ?? mes}/${ano}`;
}
function ordenar(detalhes: DetalheItemLavanderia[], ordem: Ordem): DetalheItemLavanderia[] {
  const copia = [...detalhes];
  if (ordem === 'volume') {
    copia.sort((a, b) => b.totalEnviado - a.totalEnviado);
  } else if (ordem === 'custo') {
    copia.sort((a, b) => (b.custoEnviado ?? 0) - (a.custoEnviado ?? 0));
  } else {
    copia.sort((a, b) => Math.abs(b.diferencaPecas) - Math.abs(a.diferencaPecas));
  }
  return copia;
}

// searchParams é síncrono nesta versão do Next (14.2). Na 15+ é Promise —
// quando migrarmos, basta await aqui.
interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export const dynamic = 'force-dynamic';

export default async function LavanderiaRelatorio({ searchParams }: PageProps) {
  const periodoKey = parsePeriodo(searchParams.periodo);
  const periodo = resolverPeriodo(periodoKey);
  const ordemRaw = searchParams.ordem;
  const ordem: Ordem =
    typeof ordemRaw === 'string' && (ORDENS as readonly string[]).includes(ordemRaw)
      ? (ordemRaw as Ordem)
      : 'volume';

  const { resumo, detalhes, mensal } = await relatorioLavanderia(periodo);
  const detalhesOrdenados = ordenar(detalhes, ordem);

  const hrefComPeriodo = (p: string) => `/admin/lavanderia?periodo=${p}&ordem=${ordem}`;
  const hrefComOrdem = (o: string) => `/admin/lavanderia?periodo=${periodoKey}&ordem=${o}`;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerNav}>
          <Link href="/admin" className={styles.voltar}>
            ← Painel
          </Link>
          <span className={styles.badgeAdmin}>Admin</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
            <Link href="/admin/materiais" className={styles.muted} style={{ textDecoration: 'none', fontSize: 13 }}>
              Materiais
            </Link>
            <Link href="/admin/locais" className={styles.muted} style={{ textDecoration: 'none', fontSize: 13 }}>
              Locais
            </Link>
            <Link href="/admin/lotes-lavanderia" className={styles.muted} style={{ textDecoration: 'none', fontSize: 13 }}>
              Lotes
            </Link>
            <Link href="/admin/perdas" className={styles.muted} style={{ textDecoration: 'none', fontSize: 13 }}>
              Perdas
            </Link>
            <Link href="/" className={styles.muted} style={{ textDecoration: 'none', fontSize: 13 }}>
              Operação
            </Link>
          </div>
        </div>
        <h1>Relatório de Lavanderia</h1>
        <p className={styles.intervalo}>
          {periodo.label} <span className={styles.muted}>· {periodo.rotuloIntervalo}</span>
        </p>
      </header>

      <nav className={styles.filtros} aria-label="Filtro de período">
        {PERIODOS.map((p) => (
          <Link
            key={p.key}
            href={hrefComPeriodo(p.key)}
            className={`${styles.filtroItem} ${p.key === periodoKey ? styles.filtroItemAtivo : ''}`}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      <section className={styles.cards} aria-label="Resumo do período">
        <Card titulo="Peças enviadas" valor={fmtNum.format(resumo.totalEnviado)} />
        <Card titulo="Peças retornadas" valor={fmtNum.format(resumo.totalRetornado)} />
        <Card
          titulo="Diferença de peças"
          valor={sinalPecas(resumo.diferencaPecas)}
          destaque={resumo.diferencaPecas !== 0}
        />
        <Card
          titulo="Custo enviado"
          valor={fmtBRL.format(resumo.custoEnviado)}
          parcial={resumo.custoParcial}
        />
        <Card
          titulo="Custo retornado"
          valor={fmtBRL.format(resumo.custoRetornado)}
          parcial={resumo.custoParcial}
        />
        <Card
          titulo="Diferença estimada"
          valor={sinalValor(resumo.diferencaCusto)}
          destaque={resumo.diferencaCusto !== 0}
          parcial={resumo.custoParcial}
        />
      </section>

      {resumo.custoParcial && (
        <div className={styles.aviso} role="note">
          <strong>Custo parcial.</strong> {resumo.itensSemValorUnitario} item(ns) com movimentação
          no período sem <code>valorUnitario</code> cadastrado — os totais de custo excluem esses
          itens. Cadastre o valor para precisão financeira.
        </div>
      )}

      <section className={styles.secao}>
        <div className={styles.secaoHeader}>
          <h2>Detalhe por item</h2>
          <div className={styles.ordemNav} aria-label="Ordenação">
            <span className={styles.ordemLabel}>Ordenar por:</span>
            {ORDENS.map((o) => (
              <Link
                key={o}
                href={hrefComOrdem(o)}
                className={`${styles.ordemItem} ${o === ordem ? styles.ordemItemAtivo : ''}`}
              >
                {ORDEM_LABEL[o]}
              </Link>
            ))}
          </div>
        </div>

        {detalhesOrdenados.length === 0 ? (
          <div className={styles.vazio}>Nenhuma movimentação de lavanderia no período.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className={styles.num}>Enviado</th>
                  <th className={styles.num}>Retornado</th>
                  <th className={styles.num}>Diferença</th>
                  <th className={styles.num}>Valor unit.</th>
                  <th className={styles.num}>Custo env.</th>
                  <th className={styles.num}>Custo ret.</th>
                  <th className={styles.num}>Diferença est.</th>
                </tr>
              </thead>
              <tbody>
                {detalhesOrdenados.map((d) => {
                  const semPreco = d.valorUnitario == null;
                  return (
                    <tr key={d.itemId}>
                      <td>
                        {d.nomeItem}
                        {semPreco && (
                          <span className={styles.badgeSemPreco} title="Sem valorUnitario cadastrado">
                            sem preço
                          </span>
                        )}
                      </td>
                      <td className={styles.num}>{fmtNum.format(d.totalEnviado)}</td>
                      <td className={styles.num}>{fmtNum.format(d.totalRetornado)}</td>
                      <td
                        className={`${styles.num} ${d.diferencaPecas !== 0 ? styles.alerta : ''}`}
                      >
                        {sinalPecas(d.diferencaPecas)}
                      </td>
                      <td className={styles.num}>
                        {d.valorUnitario != null ? (
                          fmtBRL.format(d.valorUnitario)
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                      <td className={styles.num}>
                        {d.custoEnviado != null ? (
                          fmtBRL.format(d.custoEnviado)
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                      <td className={styles.num}>
                        {d.custoRetornado != null ? (
                          fmtBRL.format(d.custoRetornado)
                        ) : (
                          <span className={styles.muted}>—</span>
                        )}
                      </td>
                      <td
                        className={`${styles.num} ${
                          d.diferencaCusto != null && d.diferencaCusto !== 0 ? styles.alerta : ''
                        }`}
                      >
                        {d.diferencaCusto != null ? (
                          sinalValor(d.diferencaCusto)
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
        )}
      </section>

      <section className={styles.secao}>
        <div className={styles.secaoHeader}>
          <h2>Resumo mensal</h2>
        </div>

        {mensal.length === 0 ? (
          <div className={styles.vazio}>Sem dados mensais no período.</div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th className={styles.num}>Enviado</th>
                    <th className={styles.num}>Retornado</th>
                    <th className={styles.num}>Diferença</th>
                    <th className={styles.num}>Custo env.</th>
                    <th className={styles.num}>Custo ret.</th>
                    <th className={styles.num}>Diferença est.</th>
                  </tr>
                </thead>
                <tbody>
                  {mensal.map((m) => (
                    <tr key={m.mes}>
                      <td>{fmtMesRotulo(m.mes)}</td>
                      <td className={styles.num}>{fmtNum.format(m.totalEnviado)}</td>
                      <td className={styles.num}>{fmtNum.format(m.totalRetornado)}</td>
                      <td className={`${styles.num} ${m.diferencaPecas !== 0 ? styles.alerta : ''}`}>
                        {sinalPecas(m.diferencaPecas)}
                      </td>
                      <td className={styles.num}>
                        {fmtBRL.format(m.custoEnviado)}
                        {m.custoParcial && <span className={styles.parcialMark}>*</span>}
                      </td>
                      <td className={styles.num}>
                        {fmtBRL.format(m.custoRetornado)}
                        {m.custoParcial && <span className={styles.parcialMark}>*</span>}
                      </td>
                      <td className={`${styles.num} ${m.diferencaCusto !== 0 ? styles.alerta : ''}`}>
                        {sinalValor(m.diferencaCusto)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {mensal.some((m) => m.custoParcial) && (
              <p className={styles.nota}>
                <span className={styles.parcialMark}>*</span> Mês contém itens sem valor unitário —
                totais de custo parciais.
              </p>
            )}
          </>
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
        {parcial && <span className={styles.parcialMark} title="Custo parcial">*</span>}
      </div>
    </div>
  );
}
