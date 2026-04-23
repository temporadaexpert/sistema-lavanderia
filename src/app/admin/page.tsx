import Link from 'next/link';
import { dashboardSnapshot } from '@/app/_lib/dashboardData';
import type {
  AlertaEstoqueBaixo,
  AlertaLotePendente,
  UltimoLancamento,
} from '@/application/services/DashboardAdminService';
import type { MovimentacaoTipo } from '@/domain/types/enums';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = new Intl.NumberFormat('pt-BR');
const fmtDataCurta = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const fmtMesCabecalho = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
});

const TIPO_LABEL: Record<MovimentacaoTipo, string> = {
  entrada_deposito: 'Entrada depósito',
  saida_imovel: 'Saída imóvel',
  retorno_imovel: 'Retorno imóvel',
  envio_lavanderia: 'Envio lavanderia',
  retorno_lavanderia: 'Retorno lavanderia',
  ajuste: 'Ajuste',
};

const TIPO_CLASS: Record<MovimentacaoTipo, string> = {
  entrada_deposito: 'tipoEntrada',
  saida_imovel: 'tipoSaida',
  retorno_imovel: 'tipoRetorno',
  envio_lavanderia: 'tipoEnvio',
  retorno_lavanderia: 'tipoRetornoLav',
  ajuste: 'tipoAjuste',
};

const STATUS_LOTE_LABEL: Record<AlertaLotePendente['status'], string> = {
  aberto: 'Aberto',
  retorno_parcial: 'Parcial',
  com_divergencia: 'Divergência',
};

export default async function AdminDashboard() {
  const snap = await dashboardSnapshot();
  const mesReferencia = fmtMesCabecalho.format(new Date(snap.inicioMes));
  const hojeFormatado = fmtDataCurta.format(new Date(snap.agora));

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <div className={styles.badge}>Painel administrativo</div>
            <h1 className={styles.titulo}>Visão consolidada</h1>
            <p className={styles.subtitulo}>
              {capitalizar(mesReferencia)} · atualizado em {hojeFormatado}
            </p>
          </div>
          <Link href="/" className={styles.linkOperacao}>
            Ir para operação →
          </Link>
        </div>
      </header>

      <section className={styles.impostometro} aria-label="Acumulado de lavanderia">
        <div className={styles.impostometroMes}>
          <div className={styles.impostometroLabel}>Acumulado de lavanderia no mês</div>
          <div className={styles.impostometroValor}>
            {fmtBRL.format(snap.lavanderia.valorMes)}
            {snap.lavanderia.custoParcialMes && (
              <span className={styles.parcialMark} title="Custo parcial — há itens sem preço">
                *
              </span>
            )}
          </div>
          <div className={styles.impostometroRodape}>
            {fmtNum.format(snap.lavanderia.pecasMes)} peça(s) enviadas no mês
          </div>
        </div>

        <div className={styles.impostometroHoje}>
          <div className={styles.impostometroLabel}>Hoje</div>
          <div className={styles.impostometroValorHoje}>
            {fmtBRL.format(snap.lavanderia.valorHoje)}
            {snap.lavanderia.custoParcialHoje && (
              <span className={styles.parcialMark}>*</span>
            )}
          </div>
          <div className={styles.impostometroRodape}>
            {fmtNum.format(snap.lavanderia.pecasHoje)} peça(s)
          </div>
        </div>
      </section>

      {(snap.lavanderia.custoParcialMes || snap.perdas.custoParcial) && (
        <div className={styles.aviso} role="note">
          <strong>Custo parcial.</strong> Há itens movimentados no período sem{' '}
          <code>valorUnitario</code> cadastrado — os totais financeiros excluem esses itens.
        </div>
      )}

      <section className={styles.kpis} aria-label="Indicadores principais">
        <KPI
          titulo="Peças hoje"
          valor={fmtNum.format(snap.lavanderia.pecasHoje)}
          hint="enviadas à lavanderia"
        />
        <KPI
          titulo="Peças no mês"
          valor={fmtNum.format(snap.lavanderia.pecasMes)}
          hint="enviadas à lavanderia"
        />
        <KPI
          titulo="Lotes com pendência"
          valor={fmtNum.format(snap.pendencia.totalLotes)}
          hint={`${fmtNum.format(snap.pendencia.pecasPendentes)} peça(s) em aberto`}
          destaque={snap.pendencia.totalLotes > 0}
        />
        <KPI
          titulo="Perdas no mês"
          valor={fmtNum.format(snap.perdas.pecasMes)}
          hint={`${fmtNum.format(snap.perdas.lotesEncerradosMes)} lote(s) encerrado(s)`}
          destaque={snap.perdas.pecasMes > 0}
        />
        <KPI
          titulo="Valor perdido no mês"
          valor={fmtBRL.format(snap.perdas.valorMes)}
          hint={snap.perdas.custoParcial ? 'valor parcial' : 'estimado'}
          destaque={snap.perdas.valorMes > 0}
          parcial={snap.perdas.custoParcial}
        />
      </section>

      <section className={styles.duasColunas}>
        <article className={styles.bloco}>
          <div className={styles.blocoHeader}>
            <h2>Últimos lançamentos</h2>
            <Link href="/" className={styles.blocoLink}>
              Ver operação →
            </Link>
          </div>
          <UltimosLancamentos lancamentos={snap.ultimasMovimentacoes} />
        </article>

        <article className={styles.bloco}>
          <div className={styles.blocoHeader}>
            <h2>Alertas</h2>
            <span className={styles.blocoHint}>
              {snap.alertasEstoque.length + snap.alertasLotes.length} total
            </span>
          </div>
          <Alertas
            estoque={snap.alertasEstoque}
            lotes={snap.alertasLotes}
            depositoNome={snap.depositoPrincipalNome}
          />
        </article>
      </section>

      <section className={styles.atalhos} aria-label="Atalhos">
        <h2 className={styles.atalhosTitulo}>Atalhos</h2>
        <div className={styles.atalhosGrid}>
          <AtalhoCard
            href="/"
            titulo="Operação"
            descricao="Registrar envios, retornos e ajustes do dia a dia."
          />
          <AtalhoCard
            href="/admin/lotes-lavanderia"
            titulo="Lotes de lavanderia"
            descricao={
              snap.pendencia.totalLotes > 0
                ? `${snap.pendencia.totalLotes} pendente(s) · ${fmtNum.format(snap.pendencia.pecasPendentes)} peça(s)`
                : 'Sem lotes pendentes.'
            }
            destaque={snap.pendencia.totalLotes > 0}
          />
          <AtalhoCard
            href="/admin/lavanderia"
            titulo="Relatório de custos"
            descricao={`Mês: ${fmtBRL.format(snap.lavanderia.valorMes)}`}
          />
          <AtalhoCard
            href="/admin/perdas"
            titulo="Relatório de perdas"
            descricao={
              snap.perdas.pecasMes > 0
                ? `${fmtNum.format(snap.perdas.pecasMes)} peça(s) · ${fmtBRL.format(snap.perdas.valorMes)}`
                : 'Nenhuma perda no mês.'
            }
            destaque={snap.perdas.pecasMes > 0}
          />
          <AtalhoCard
            href="/admin/materiais"
            titulo="Materiais"
            descricao={
              snap.materiais.total > 0
                ? `${snap.materiais.ativos} ativo(s) · ${snap.materiais.total} cadastrado(s)`
                : 'Cadastre o primeiro material.'
            }
          />
          <AtalhoCard
            href="/admin/locais"
            titulo="Locais"
            descricao={
              snap.locais.total > 0
                ? `${snap.locais.ativos} ativo(s) · ${snap.locais.total} cadastrado(s)`
                : 'Cadastre depósito, imóvel ou lavanderia.'
            }
            destaque={snap.locais.ativos === 0}
          />
        </div>
      </section>
    </main>
  );
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function KPI({
  titulo,
  valor,
  hint,
  destaque,
  parcial,
}: {
  titulo: string;
  valor: string;
  hint: string;
  destaque?: boolean;
  parcial?: boolean;
}) {
  return (
    <div className={`${styles.kpi} ${destaque ? styles.kpiDestaque : ''}`}>
      <div className={styles.kpiTitulo}>{titulo}</div>
      <div className={styles.kpiValor}>
        {valor}
        {parcial && <span className={styles.parcialMark}>*</span>}
      </div>
      <div className={styles.kpiHint}>{hint}</div>
    </div>
  );
}

function UltimosLancamentos({ lancamentos }: { lancamentos: readonly UltimoLancamento[] }) {
  if (lancamentos.length === 0) {
    return <div className={styles.vazio}>Nenhuma movimentação registrada ainda.</div>;
  }
  return (
    <ul className={styles.lista}>
      {lancamentos.map((l) => (
        <li key={l.id} className={styles.listaItem}>
          <div className={styles.listaItemTopo}>
            <span className={`${styles.tipoChip} ${styles[TIPO_CLASS[l.tipo]] ?? ''}`}>
              {TIPO_LABEL[l.tipo]}
            </span>
            <span className={styles.listaItemData}>
              {fmtDataHora.format(new Date(l.dataHora))}
            </span>
          </div>
          <div className={styles.listaItemConteudo}>
            <strong>{l.nomeItem}</strong>
            <span className={styles.qtd}>{fmtNum.format(l.quantidade)}</span>
          </div>
          <div className={styles.listaItemRodape}>
            {l.nomeOrigem && <span>{l.nomeOrigem}</span>}
            {l.nomeOrigem && l.nomeDestino && <span aria-hidden> → </span>}
            {l.nomeDestino && <span>{l.nomeDestino}</span>}
            {l.codigoLote && (
              <>
                <span aria-hidden> · </span>
                <code className={styles.codigoInline}>{l.codigoLote}</code>
              </>
            )}
            <span aria-hidden> · </span>
            <span>{l.responsavel}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Alertas({
  estoque,
  lotes,
  depositoNome,
}: {
  estoque: readonly AlertaEstoqueBaixo[];
  lotes: readonly AlertaLotePendente[];
  depositoNome: string | null;
}) {
  if (estoque.length === 0 && lotes.length === 0) {
    return <div className={styles.vazio}>Nenhum alerta no momento.</div>;
  }
  return (
    <div className={styles.alertasWrapper}>
      {lotes.length > 0 && (
        <div>
          <div className={styles.alertaGrupoTitulo}>
            Lotes com pendência <span className={styles.alertaContador}>{lotes.length}</span>
          </div>
          <ul className={styles.alertaLista}>
            {lotes.map((l) => (
              <li key={l.loteId} className={styles.alertaItem}>
                <Link href={`/admin/lotes-lavanderia/${l.loteId}`} className={styles.alertaLink}>
                  <div className={styles.alertaLinhaPrincipal}>
                    <code className={styles.codigoInline}>{l.codigo}</code>
                    <span
                      className={`${styles.statusChip} ${styles[`statusLote_${l.status}`] ?? ''}`}
                    >
                      {STATUS_LOTE_LABEL[l.status]}
                    </span>
                  </div>
                  <div className={styles.alertaLinhaDetalhe}>
                    <span>
                      <strong>{fmtNum.format(l.pendenciaEfetiva)}</strong> peça(s) pendente(s)
                    </span>
                    <span aria-hidden> · </span>
                    <span>
                      enviado em {fmtDataCurta.format(new Date(l.dataEnvio))} por {l.responsavel}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {estoque.length > 0 && (
        <div>
          <div className={styles.alertaGrupoTitulo}>
            Estoque abaixo do mínimo
            <span className={styles.alertaContador}>{estoque.length}</span>
            {depositoNome && <span className={styles.alertaSub}>em {depositoNome}</span>}
          </div>
          <ul className={styles.alertaLista}>
            {estoque.map((a) => (
              <li key={a.itemId} className={styles.alertaItem}>
                <div className={styles.alertaLinhaPrincipal}>
                  <strong>{a.nome}</strong>
                  <span className={styles.alertaEstoqueBadge}>
                    {fmtNum.format(a.saldoAtual)} / {fmtNum.format(a.estoqueMinimo)}
                  </span>
                </div>
                <div className={styles.barra}>
                  <span
                    className={styles.barraFill}
                    style={{ width: `${Math.min(100, a.razao * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AtalhoCard({
  href,
  titulo,
  descricao,
  destaque,
  desabilitado,
}: {
  href?: string;
  titulo: string;
  descricao: string;
  destaque?: boolean;
  desabilitado?: boolean;
}) {
  const className = `${styles.atalho} ${destaque ? styles.atalhoDestaque : ''} ${
    desabilitado ? styles.atalhoDesabilitado : ''
  }`;
  const conteudo = (
    <>
      <div className={styles.atalhoTitulo}>{titulo}</div>
      <div className={styles.atalhoDescricao}>{descricao}</div>
      {!desabilitado && <span className={styles.atalhoSeta}>→</span>}
    </>
  );
  if (desabilitado || !href) {
    return (
      <div className={className} aria-disabled>
        {conteudo}
      </div>
    );
  }
  return (
    <Link href={href} className={className}>
      {conteudo}
    </Link>
  );
}
