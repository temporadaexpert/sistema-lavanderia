import Link from 'next/link';
import { dashboardSnapshot } from '@/app/_lib/dashboardData';
import {
  divergenciaDoDia,
  hojeISO,
  listarDiasAbertosAnteriores,
  listarDivergenciasDiarias,
  obterControleDoDia,
  resumoControleDiario,
} from '@/app/_lib/controleDiarioData';
import { listarItensTodos } from '@/app/_lib/data';
import {
  listarDivergenciasComContato,
  resumoDivergencias,
  type DivergenciaComContato,
} from '@/app/_lib/divergenciaData';
import type {
  AlertaEstoqueBaixo,
  AlertaLotePendente,
  UltimoLancamento,
} from '@/application/services/DashboardAdminService';
import type {
  PrioridadeDivergencia,
  ResumoDivergencias,
} from '@/application/services/DivergenciaService';
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

export default async function AdminDashboard() {
  const hoje = hojeISO();
  const [
    snap,
    divergencias,
    resumoDiv,
    resumoControle,
    controleHoje,
    divergenciaHoje,
    divergenciasAbertas,
    diasAnterioresAbertos,
    itensTodos,
  ] = await Promise.all([
    dashboardSnapshot(),
    listarDivergenciasComContato(),
    resumoDivergencias(),
    resumoControleDiario(),
    obterControleDoDia(hoje),
    divergenciaDoDia(hoje),
    // Todos os dias com divergência não-resolvida (fechado_com_divergencia
    // ou ainda aberto mostrando discrepância).
    listarDivergenciasDiarias(),
    listarDiasAbertosAnteriores(hoje),
    listarItensTodos(),
  ]);
  const nomeItemPorId = new Map(itensTodos.map((i) => [i.id, i.nome]));
  const diaAnteriorPendente = diasAnterioresAbertos[0] ?? null;
  const criticasSemContato = divergencias.filter(
    (d) =>
      (d.prioridade === 'critica' || d.prioridade === 'excesso') &&
      d.estatisticaContato.nuncaCobrado,
  ).length;
  const promessasVencidas = divergencias.filter(
    (d) => d.estatisticaContato.promessaVencida,
  );
  const mesReferencia = fmtMesCabecalho.format(new Date(snap.inicioMes));
  const hojeFormatado = fmtDataCurta.format(new Date(snap.agora));

  // Top 5 lotes ativos mais urgentes (críticas/excesso/atenção primeiro,
  // depois aguardando). Exclui encerrados e ok.
  const topDivergencias = divergencias
    .filter(
      (d) =>
        d.prioridade === 'critica' ||
        d.prioridade === 'excesso' ||
        d.prioridade === 'atencao' ||
        d.prioridade === 'aguardando',
    )
    .slice(0, 5);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <div className={styles.badge}>Painel administrativo</div>
          <h1 className={styles.titulo}>Visão consolidada</h1>
          <p className={styles.subtitulo}>
            {capitalizar(mesReferencia)} · atualizado em {hojeFormatado}
          </p>
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

      {/* Controle diário sobe pra aqui: logo depois dos KPIs, acima do
          fold — o gestor vê status do dia antes de rolar para lançamentos
          e alertas. Fonte: data/controles-diarios.json via
          c.controleDiario (não mistura com movimentações/lavanderia). */}
      <ControleDiarioSection
        resumo={resumoControle}
        controleHoje={controleHoje}
        divergenciaHoje={divergenciaHoje}
        divergenciasAbertas={divergenciasAbertas.length}
        diaAnteriorPendente={diaAnteriorPendente}
        nomeItemPorId={nomeItemPorId}
      />

      <section className={styles.duasColunas}>
        <article className={styles.bloco}>
          <div className={styles.blocoHeader}>
            <h2>Últimos lançamentos</h2>
            <Link href="/operacao" className={styles.blocoLink}>
              Ver operação →
            </Link>
          </div>
          <UltimosLancamentos lancamentos={snap.ultimasMovimentacoes} />
        </article>

        <article className={styles.bloco}>
          <div className={styles.blocoHeader}>
            <h2>Alertas priorizados</h2>
            <Link href="/admin/divergencias" className={styles.blocoLink}>
              Ver todas as divergências →
            </Link>
          </div>
          <AlertasPriorizados
            resumo={resumoDiv}
            topDivergencias={topDivergencias}
            estoque={snap.alertasEstoque}
            depositoNome={snap.depositoPrincipalNome}
            criticasSemContato={criticasSemContato}
            promessasVencidas={promessasVencidas}
          />
        </article>
      </section>

      <AdminDashboardAtalhos snap={snap} resumoDiv={resumoDiv} />
    </main>
  );
}

// Extraído pra ler melhor: mostra tudo que o admin precisa saber sobre
// controle diário em um bloco só — status/responsáveis/divergência.
function ControleDiarioSection({
  resumo,
  controleHoje,
  divergenciaHoje,
  divergenciasAbertas,
  diaAnteriorPendente,
  nomeItemPorId,
}: {
  resumo: Awaited<ReturnType<typeof resumoControleDiario>>;
  controleHoje: Awaited<ReturnType<typeof obterControleDoDia>>;
  divergenciaHoje: Awaited<ReturnType<typeof divergenciaDoDia>>;
  divergenciasAbertas: number;
  diaAnteriorPendente: Awaited<
    ReturnType<typeof listarDiasAbertosAnteriores>
  >[number] | null;
  nomeItemPorId: ReadonlyMap<string, string>;
}) {
  // Sem controleHoje E sem histórico: empty state claro.
  if (!controleHoje && !resumo) {
    return (
      <section className={styles.bloco} aria-label="Controle diário do depósito">
        <div className={styles.blocoHeader}>
          <h2>Controle diário do depósito</h2>
          <Link href="/operacao" className={styles.blocoLink}>
            Abrir controle →
          </Link>
        </div>
        {diaAnteriorPendente && (
          <WarningDiaAnterior pendente={diaAnteriorPendente} />
        )}
        <p className={styles.controleVazio}>
          Nenhum controle diário iniciado hoje.
        </p>
      </section>
    );
  }

  // Sem controleHoje mas tem histórico (último dia foi ontem ou antes):
  // ainda mostra a seção pra destacar o estado "ninguém começou hoje".
  if (!controleHoje) {
    return (
      <section className={styles.bloco} aria-label="Controle diário do depósito">
        <div className={styles.blocoHeader}>
          <h2>Controle diário do depósito</h2>
          <Link href="/operacao" className={styles.blocoLink}>
            Abrir controle →
          </Link>
        </div>
        {diaAnteriorPendente && (
          <WarningDiaAnterior pendente={diaAnteriorPendente} />
        )}
        <p className={styles.controleVazio}>
          Nenhum controle diário iniciado hoje. Último registro:{' '}
          <strong>
            {resumo
              ? fmtDataCurta.format(new Date(`${resumo.dataReferencia}T12:00:00Z`))
              : '—'}
          </strong>
          .
        </p>
      </section>
    );
  }

  // Se há controleHoje mas resumoDashboard voltou null (edge case: repo
  // vazio logo após um reset, com insert de hoje no meio), ainda assim
  // renderiza com valores zerados.
  const totalEnviado = resumo?.totalEnviado ?? 0;
  const totalRetornado = resumo?.totalRetornado ?? 0;
  const totalLimpoReap = resumo?.totalLimpoReaproveitado ?? 0;
  const totalFaltante = resumo?.totalFaltante ?? 0;
  const dataRef = resumo?.dataReferencia ?? controleHoje.data;
  const temControleHoje = resumo?.temControleHoje ?? true;

  // Fonte da verdade: controleHoje (quando existe). Se não há registro
  // hoje, mostra aviso e usa o último dia como referência para histórico.
  const estatusChip = statusDoDia(controleHoje, divergenciaHoje);
  const responsavelEnvio = controleHoje?.responsavelEnvio ?? null;
  const responsavelRetorno = controleHoje?.responsavelRetorno ?? null;
  const responsavelFechamento = controleHoje?.responsavelFechamento ?? null;
  const motivo = controleHoje?.motivoDivergencia ?? null;

  const linhasFaltantes =
    divergenciaHoje?.linhas.filter((l) => l.classe === 'faltando') ?? [];
  const linhasExcedentes =
    divergenciaHoje?.linhas.filter((l) => l.classe === 'excedente') ?? [];

  return (
    <section className={styles.bloco} aria-label="Controle diário do depósito">
      <div className={styles.blocoHeader}>
        <div className={styles.controleTituloLinha}>
          <h2>Controle diário do depósito</h2>
          <span className={`${styles.controleChip} ${styles[estatusChip.classe]}`}>
            {estatusChip.label}
          </span>
        </div>
        <Link
          href={
            divergenciasAbertas > 0
              ? '/admin/divergencias-diarias'
              : '/operacao'
          }
          className={styles.blocoLink}
        >
          {divergenciasAbertas > 0
            ? `${divergenciasAbertas} com divergência →`
            : 'Abrir controle →'}
        </Link>
      </div>

      {diaAnteriorPendente && (
        <WarningDiaAnterior pendente={diaAnteriorPendente} />
      )}

      <div className={styles.controleGrid}>
        <div className={styles.controleStat}>
          <div className={styles.controleStatLabel}>Referência</div>
          <div className={styles.controleStatValor}>
            {fmtDataCurta.format(new Date(`${dataRef}T12:00:00Z`))}
            {temControleHoje && <span className={styles.controleBadge}>hoje</span>}
          </div>
        </div>
        <div className={styles.controleStat}>
          <div className={styles.controleStatLabel}>Enviado hoje</div>
          <div className={styles.controleStatValor}>{fmtNum.format(totalEnviado)}</div>
        </div>
        <div className={styles.controleStat}>
          <div className={styles.controleStatLabel}>Retornado hoje</div>
          <div className={styles.controleStatValor}>{fmtNum.format(totalRetornado)}</div>
        </div>
        <div className={styles.controleStat}>
          <div className={styles.controleStatLabel}>Limpo reaproveitado</div>
          <div className={styles.controleStatValor}>
            {fmtNum.format(totalLimpoReap)}
          </div>
        </div>
        <div
          className={`${styles.controleStat} ${
            totalFaltante > 0 ? styles.controleStatAlerta : ''
          }`}
        >
          <div className={styles.controleStatLabel}>Faltante</div>
          <div className={styles.controleStatValor}>{fmtNum.format(totalFaltante)}</div>
        </div>
      </div>

      {(responsavelEnvio || responsavelRetorno || responsavelFechamento) && (
        <div className={styles.controleResp}>
          {responsavelEnvio && (
            <span>
              <strong>Envio:</strong> {responsavelEnvio}
            </span>
          )}
          {responsavelRetorno && (
            <span>
              <strong>Retorno:</strong> {responsavelRetorno}
            </span>
          )}
          {responsavelFechamento && (
            <span>
              <strong>Fechou com divergência:</strong> {responsavelFechamento}
            </span>
          )}
        </div>
      )}

      {linhasFaltantes.length + linhasExcedentes.length > 0 && (
        <div className={styles.controleDivergencia}>
          <div className={styles.controleDivergenciaTitulo}>Itens com divergência hoje</div>
          <ul>
            {linhasFaltantes.map((l) => (
              <li key={`f-${l.itemId}`}>
                <strong>−{l.divergencia}</strong>{' '}
                {nomeItemPorId.get(l.itemId) ?? l.itemId}
              </li>
            ))}
            {linhasExcedentes.map((l) => (
              <li key={`e-${l.itemId}`}>
                <strong>+{-l.divergencia}</strong>{' '}
                {nomeItemPorId.get(l.itemId) ?? l.itemId}
              </li>
            ))}
          </ul>
          {motivo && (
            <p className={styles.controleMotivo}>
              <strong>Motivo registrado:</strong> {motivo}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// Classifica o status do dia em chip visual. Prioridade: divergência >
// fechado > aberto > sem registro.
// Aviso vermelho no topo da seção de controle diário quando há dia
// anterior aberto. Reforço visual pro gestor cobrar fechamento.
function WarningDiaAnterior({
  pendente,
}: {
  pendente: Awaited<ReturnType<typeof listarDiasAbertosAnteriores>>[number];
}) {
  const [ano, mes, dia] = pendente.data.split('-');
  const dataBR = `${dia}/${mes}/${ano}`;
  return (
    <div className={styles.controleWarning} role="alert">
      <div className={styles.controleWarningTopo}>
        <span aria-hidden>🚨</span>
        <strong>Controle diário anterior em aberto: {dataBR}</strong>
      </div>
      <p className={styles.controleWarningSub}>
        Responsável:{' '}
        {pendente.responsavelEnvio ?? pendente.responsavelRetorno ?? '—'}. A
        funcionária não pode iniciar novos dias até fechar esse.
      </p>
      <Link
        href={`/operacao/retorno-diario?data=${pendente.data}`}
        className={styles.controleWarningLink}
      >
        Abrir controle pendente →
      </Link>
    </div>
  );
}

function statusDoDia(
  controle: Awaited<ReturnType<typeof obterControleDoDia>>,
  divergencia: Awaited<ReturnType<typeof divergenciaDoDia>>,
): { label: string; classe: string } {
  if (!controle) return { label: 'Sem registro hoje', classe: 'controleChipNeutro' };
  if (controle.status === 'fechado_com_divergencia') {
    return { label: 'Fechado com divergência', classe: 'controleChipAlerta' };
  }
  if (controle.status === 'fechado') {
    return { label: 'Fechado', classe: 'controleChipOk' };
  }
  // aberto
  if (divergencia?.aguardandoRetorno) {
    // Estado neutro: tem envio, retorno ainda não conferido. NÃO é
    // divergência — é só pendência de fechamento natural do dia.
    return { label: 'Aberto · aguardando retorno', classe: 'controleChipInfo' };
  }
  if (divergencia?.temDivergencia) {
    return { label: 'Aberto · divergência', classe: 'controleChipAlerta' };
  }
  return { label: 'Aberto', classe: 'controleChipInfo' };
}

function AdminDashboardAtalhos({
  snap,
  resumoDiv,
}: {
  snap: Awaited<ReturnType<typeof dashboardSnapshot>>;
  resumoDiv: ResumoDivergencias;
}) {
  return (
    <section className={styles.atalhos} aria-label="Atalhos">
        <h2 className={styles.atalhosTitulo}>Atalhos</h2>
        <div className={styles.atalhosGrid}>
          <AtalhoCard
            href="/operacao"
            titulo="Tela operacional"
            descricao="Central da funcionária: controle diário, lavanderia, imóveis, depósito."
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
            href="/admin/divergencias"
            titulo="Divergências"
            descricao={
              resumoDiv.criticas + resumoDiv.excesso > 0
                ? `${resumoDiv.criticas} crítica(s) · ${resumoDiv.atencao} atenção · ${fmtBRL.format(resumoDiv.valorPendenteTotal)}`
                : resumoDiv.atencao + resumoDiv.aguardando > 0
                  ? `${resumoDiv.atencao + resumoDiv.aguardando} em andamento · ${fmtBRL.format(resumoDiv.valorPendenteTotal)}`
                  : 'Nenhuma divergência ativa.'
            }
            destaque={resumoDiv.criticas + resumoDiv.excesso > 0}
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

function AlertasPriorizados({
  resumo,
  topDivergencias,
  estoque,
  depositoNome,
  criticasSemContato,
  promessasVencidas,
}: {
  resumo: ResumoDivergencias;
  topDivergencias: readonly DivergenciaComContato[];
  estoque: readonly AlertaEstoqueBaixo[];
  depositoNome: string | null;
  criticasSemContato: number;
  promessasVencidas: readonly DivergenciaComContato[];
}) {
  const totalAtivos =
    resumo.criticas + resumo.atencao + resumo.aguardando + resumo.excesso;
  const semAlertas = totalAtivos === 0 && estoque.length === 0;

  if (semAlertas) {
    return <div className={styles.vazio}>Nenhum alerta ativo no momento.</div>;
  }

  return (
    <div className={styles.alertasWrapper}>
      {/* Cabeçalho com contagem por prioridade */}
      {totalAtivos > 0 && (
        <div className={styles.prioResumo}>
          {resumo.criticas > 0 && (
            <span className={`${styles.prioBadge} ${styles.prioCritica}`}>
              {resumo.criticas} crítica(s)
            </span>
          )}
          {resumo.excesso > 0 && (
            <span className={`${styles.prioBadge} ${styles.prioExcesso}`}>
              {resumo.excesso} com excesso
            </span>
          )}
          {resumo.atencao > 0 && (
            <span className={`${styles.prioBadge} ${styles.prioAtencao}`}>
              {resumo.atencao} atenção
            </span>
          )}
          {resumo.aguardando > 0 && (
            <span className={`${styles.prioBadge} ${styles.prioAguardando}`}>
              {resumo.aguardando} aguardando
            </span>
          )}
          {promessasVencidas.length > 0 && (
            <span className={`${styles.prioBadge} ${styles.prioPromessaVencida}`}>
              {promessasVencidas.length} promessa(s) vencida(s)
            </span>
          )}
          {criticasSemContato > 0 && (
            <span className={`${styles.prioBadge} ${styles.prioSemContato}`}>
              {criticasSemContato} sem cobrança
            </span>
          )}
          <span className={styles.prioValor}>
            {fmtBRL.format(resumo.valorPendenteTotal)}
            {resumo.custoParcial && <span className={styles.parcialMark}>*</span>}
            <span className={styles.prioValorLabel}> em aberto</span>
          </span>
        </div>
      )}

      {promessasVencidas.length > 0 && (
        <div className={styles.bannerPromessasVencidas}>
          <div className={styles.bannerPromessasTitulo}>
            ⚠ Promessas vencidas
            <span className={styles.bannerPromessasContador}>
              {promessasVencidas.length}
            </span>
          </div>
          <p className={styles.bannerPromessasDesc}>
            A lavanderia prometeu e não cumpriu. Cobrar imediatamente.
          </p>
          <ul className={styles.alertaLista}>
            {promessasVencidas.slice(0, 5).map((d) => (
              <li key={d.lote.id} className={styles.alertaItemVencida}>
                <Link
                  href={`/admin/lotes-lavanderia/${d.lote.id}`}
                  className={styles.alertaLink}
                >
                  <div className={styles.alertaLinhaPrincipal}>
                    <code className={styles.codigoInline}>{d.lote.codigo}</code>
                    <span className={styles.flagVencida}>
                      {d.estatisticaContato.diasAtrasoPromessa}d de atraso
                    </span>
                  </div>
                  <div className={styles.alertaLinhaDetalhe}>
                    <span>
                      <strong>{fmtNum.format(d.pendenciaEfetiva)}</strong> peça(s) ·
                      {' '}
                      {d.valorPendente > 0 ? fmtBRL.format(d.valorPendente) : 'sem preço'}
                    </span>
                    <span aria-hidden> · </span>
                    <span>
                      {d.estatisticaContato.ultimo
                        ? `último contato há ${d.estatisticaContato.diasDesdeUltimoContato} dia(s)`
                        : 'nunca cobrado'}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topDivergencias.length > 0 && (
        <div>
          <div className={styles.alertaGrupoTitulo}>
            Top divergências <span className={styles.alertaContador}>{topDivergencias.length}</span>
          </div>
          <ul className={styles.alertaLista}>
            {topDivergencias.map((d) => (
              <li key={d.lote.id} className={styles.alertaItem}>
                <Link
                  href={`/admin/lotes-lavanderia/${d.lote.id}`}
                  className={styles.alertaLink}
                >
                  <div className={styles.alertaLinhaPrincipal}>
                    <code className={styles.codigoInline}>{d.lote.codigo}</code>
                    <span
                      className={`${styles.statusChip} ${styles[PRIORIDADE_CLASS[d.prioridade]] ?? ''}`}
                    >
                      {PRIORIDADE_LABEL[d.prioridade]}
                    </span>
                    {d.estatisticaContato.promessaVencida && (
                      <span className={styles.flagVencida}>
                        VENCIDA {d.estatisticaContato.diasAtrasoPromessa}d
                      </span>
                    )}
                    {!d.estatisticaContato.promessaVencida &&
                      d.estatisticaContato.nuncaCobrado &&
                      (d.prioridade === 'critica' ||
                        d.prioridade === 'atencao' ||
                        d.prioridade === 'excesso') && (
                        <span className={styles.flagSemContato}>nunca cobrado</span>
                      )}
                  </div>
                  <div className={styles.alertaLinhaDetalhe}>
                    <span>
                      <strong>{fmtNum.format(d.pendenciaEfetiva)}</strong> peça(s) ·
                      {' '}
                      {d.valorPendente > 0
                        ? fmtBRL.format(d.valorPendente)
                        : d.custoParcial
                          ? 'sem preço'
                          : 'R$ 0,00'}
                    </span>
                    <span aria-hidden> · </span>
                    <span>
                      {fmtNum.format(d.diasDesdeEnvio)} dia(s) em aberto
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
