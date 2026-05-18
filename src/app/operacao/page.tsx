import Link from 'next/link';
import { OperacaoHeader } from '@/app/_components/OperacaoHeader';
import { DisponibilidadeTable } from '@/app/_components/DisponibilidadeTable';
import { HistoricoTable } from '@/app/_components/HistoricoTable';
import {
  hojeISO,
  listarDiasAbertosAnteriores,
  obterControleDoDia,
  resumoControleDiario,
  divergenciaDoDia,
} from '@/app/_lib/controleDiarioData';
import {
  disponibilidadeDeTodos,
  historicoRecente,
  listarItensTodos,
  listarLocaisTodos,
} from '@/app/_lib/data';
import { listarLotesAbertos } from '@/app/_lib/loteData';
import { comLog } from '@/app/_lib/serverLog';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const fmtData = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

type EstadoDia = 'sem_envio' | 'envio_pendente_retorno' | 'divergencia' | 'ok';

function classificar(
  resumo: Awaited<ReturnType<typeof resumoControleDiario>>,
  divergencia: Awaited<ReturnType<typeof divergenciaDoDia>>,
  controleHoje: Awaited<ReturnType<typeof obterControleDoDia>>,
): EstadoDia {
  if (!controleHoje || controleHoje.enviado.length === 0) return 'sem_envio';
  // PRIORIDADE: aguardando retorno é sempre estado neutro/atenção,
  // nunca divergência. Mesmo que algum loader devolva temDivergencia=true
  // por bug ou cache stale, esse short-circuit garante que o operador
  // não vê alarme falso quando o retorno ainda não foi registrado.
  // Defensivo duplo: confiamos em divergencia.aguardandoRetorno e também
  // checamos `controleHoje.retorno.length === 0` localmente.
  const aguardandoRetorno =
    divergencia?.aguardandoRetorno === true || controleHoje.retorno.length === 0;
  if (aguardandoRetorno) return 'envio_pendente_retorno';
  if (divergencia?.temDivergencia) return 'divergencia';
  if (resumo?.temControleHoje && !resumo.temDivergenciaHoje) return 'ok';
  return 'ok';
}

function formatarDataBR(data: string): string {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
}

const ESTADO_META: Record<EstadoDia, { titulo: string; descricao: string; classe: string; icone: string }> = {
  sem_envio: {
    titulo: 'Dia ainda não começou',
    descricao: 'Registre o envio da manhã para abrir o controle do dia.',
    classe: 'estadoNeutro',
    icone: '○',
  },
  envio_pendente_retorno: {
    titulo: 'Envio feito · retorno pendente',
    descricao: 'No fim do dia, conte o que voltou pra fechar o controle.',
    classe: 'estadoAtencao',
    icone: '·',
  },
  divergencia: {
    titulo: 'Atenção: divergência no dia',
    descricao: 'A contagem do retorno não bate com o envio. Revise antes de fechar.',
    classe: 'estadoAlerta',
    icone: '!',
  },
  ok: {
    titulo: 'Dia em ordem',
    descricao: 'Envio e retorno batem. Nenhuma ação pendente.',
    classe: 'estadoOk',
    icone: '✓',
  },
};

export default async function OperacaoHome() {
  const data = hojeISO();
  // Cada loader em `comLog`: se falhar, server log da Vercel mostra qual
  // foi e com que erro. Sem isso, todas as falhas viram o mesmo digest
  // opaco e fica impossível distinguir "Supabase fora" de "tabela X
  // sem coluna Y".
  const rota = '/operacao';
  const [
    resumo,
    divergencia,
    controleHoje,
    disponibilidade,
    itensTodos,
    locaisTodos,
    historico,
    diasAbertosAnteriores,
    lotesPendentes,
  ] = await Promise.all([
    comLog({ event: 'loader_failed', rota, loader: 'resumoControleDiario' }, () => resumoControleDiario()),
    comLog({ event: 'loader_failed', rota, loader: 'divergenciaDoDia' }, () => divergenciaDoDia(data)),
    comLog({ event: 'loader_failed', rota, loader: 'obterControleDoDia' }, () => obterControleDoDia(data)),
    comLog({ event: 'loader_failed', rota, loader: 'disponibilidadeDeTodos' }, () => disponibilidadeDeTodos()),
    comLog({ event: 'loader_failed', rota, loader: 'listarItensTodos' }, () => listarItensTodos()),
    comLog({ event: 'loader_failed', rota, loader: 'listarLocaisTodos' }, () => listarLocaisTodos()),
    comLog({ event: 'loader_failed', rota, loader: 'historicoRecente' }, () => historicoRecente(8)),
    comLog({ event: 'loader_failed', rota, loader: 'listarDiasAbertosAnteriores' }, () => listarDiasAbertosAnteriores(data)),
    // Lotes abertos = enviados pra lavanderia mas ainda não totalmente
    // recebidos/encerrados. Filtro do service garante: encerradoEm IS NULL
    // E status in (aberto | retorno_parcial | com_divergencia). Status
    // 'concluido' (enviado=retornado, sem precisar fechar) NÃO entra.
    comLog({ event: 'loader_failed', rota, loader: 'listarLotesAbertos' }, () => listarLotesAbertos()),
  ]);
  // Bloqueio de início de novo dia: se há dia anterior aberto, o
  // operador precisa fechá-lo antes de tocar em qualquer coisa daily.
  // Lavanderia (bloco roxo) NÃO entra no bloqueio — é fluxo paralelo.
  const diaPendente = diasAbertosAnteriores[0] ?? null;
  const bloqueadoPorDiaAnterior = diaPendente !== null;
  const diaPendenteFormatado = diaPendente
    ? formatarDataBR(diaPendente.data)
    : null;
  // Contagem só pra UX — service já filtrou por status correto.
  const totalLotesPendentes = lotesPendentes.length;
  const estado = classificar(resumo, divergencia, controleHoje);
  const meta = ESTADO_META[estado];

  const totalEnviado = resumo?.temControleHoje ? resumo.totalEnviado : 0;
  const totalRetornado = resumo?.temControleHoje ? resumo.totalRetornado : 0;
  const totalFaltante = resumo?.temControleHoje ? resumo.totalFaltante : 0;
  const totalLimpo = resumo?.temControleHoje ? resumo.totalLimpoReaproveitado : 0;

  // Resumo das linhas faltantes pra banner forte — só quando hoje tem
  // controle ativo e diverge. Pega top 4 itens faltando com nome resolvido.
  const nomePorItem = new Map(itensTodos.map((i) => [i.id, i.nome]));
  // Aguardando retorno = só envio, sem retorno. Estado NEUTRO; nunca
  // dispara banner vermelho (antes, retorno=0 fazia todo enviado virar
  // "faltando", banner vermelho aparecia indevidamente).
  const aguardandoRetornoHoje =
    divergencia?.aguardandoRetorno === true ||
    (controleHoje !== null &&
      controleHoje.enviado.length > 0 &&
      controleHoje.retorno.length === 0);
  const mostrarBanner =
    !aguardandoRetornoHoje &&
    resumo?.temDivergenciaHoje === true &&
    divergencia?.temDivergencia === true;
  const faltantesTopo = mostrarBanner
    ? divergencia!.linhas
        .filter((l) => l.classe === 'faltando')
        .slice(0, 4)
        .map((l) => ({
          itemId: l.itemId,
          nome: nomePorItem.get(l.itemId) ?? String(l.itemId),
          faltante: l.divergencia,
        }))
    : [];
  const faltantesExtra = mostrarBanner
    ? Math.max(
        0,
        divergencia!.linhas.filter((l) => l.classe === 'faltando').length -
          faltantesTopo.length,
      )
    : 0;

  return (
    <>
      <OperacaoHeader />
      <main className={styles.main}>
        <div className={styles.container}>
          <p className={styles.dataHoje}>{fmtData.format(new Date(`${data}T12:00:00Z`))}</p>

          {bloqueadoPorDiaAnterior && diaPendenteFormatado && diaPendente && (
            <section className={styles.bannerBloqueio} role="alert">
              <div className={styles.bannerTopo}>
                <span className={styles.bannerIcone} aria-hidden>🚨</span>
                <div className={styles.bannerTextos}>
                  <h2 className={styles.bannerTitulo}>
                    Existe um controle diário anterior em aberto
                  </h2>
                  <p className={styles.bannerSub}>
                    Feche o dia <strong>{diaPendenteFormatado}</strong> antes de iniciar
                    novas movimentações do controle diário.
                  </p>
                </div>
              </div>
              <div className={styles.bannerAcoes}>
                <Link
                  href={`/operacao/retorno-diario?data=${diaPendente.data}`}
                  className={styles.bannerBotao}
                >
                  Abrir controle pendente →
                </Link>
                <Link
                  href="/admin/divergencias-diarias"
                  className={styles.bannerBotaoSecundario}
                >
                  Ver divergências
                </Link>
              </div>
            </section>
          )}

          {!bloqueadoPorDiaAnterior && mostrarBanner && (
            <section className={styles.bannerAlerta} role="alert">
              <div className={styles.bannerTopo}>
                <span className={styles.bannerIcone} aria-hidden>🚨</span>
                <div className={styles.bannerTextos}>
                  <h2 className={styles.bannerTitulo}>
                    Hoje faltam {divergencia!.totalFaltante} peça(s)
                  </h2>
                  <p className={styles.bannerSub}>
                    Verifique antes de fechar o dia. Peças abaixo não voltaram.
                  </p>
                </div>
              </div>
              <ul className={styles.bannerLista}>
                {faltantesTopo.map((l) => (
                  <li key={l.itemId}>
                    <span className={styles.bannerNome}>{l.nome}</span>
                    <span className={styles.bannerQtd}>−{l.faltante}</span>
                  </li>
                ))}
                {faltantesExtra > 0 && (
                  <li className={styles.bannerMais}>
                    + {faltantesExtra} outro(s) item(ns)
                  </li>
                )}
              </ul>
              <Link href="/operacao/retorno-diario" className={styles.bannerBotao}>
                Revisar retorno do dia →
              </Link>
            </section>
          )}

          <section className={`${styles.statusCard} ${styles[meta.classe]}`} role="status">
            <div className={styles.statusBadge} aria-hidden>{meta.icone}</div>
            <div className={styles.statusTexto}>
              <h2 className={styles.statusTitulo}>{meta.titulo}</h2>
              <p className={styles.statusSub}>{meta.descricao}</p>
            </div>
          </section>

          {/* Card neutro de "aguardando retorno": instrui sem alarmar.
              Substitui a lógica antiga que confundia retorno=0 com
              "todo enviado faltando" (alerta vermelho). Aparece só
              quando o operador já registrou envio mas ainda não tocou
              no retorno. */}
          {aguardandoRetornoHoje && (
            <section className={styles.cardAguardando} role="status">
              <div className={styles.cardAguardandoIcone} aria-hidden>·</div>
              <div className={styles.cardAguardandoTexto}>
                <h3 className={styles.cardAguardandoTitulo}>
                  Retorno do dia ainda não registrado
                </h3>
                <p className={styles.cardAguardandoSub}>
                  Registre o retorno no fim do dia para que o sistema calcule
                  divergências. Por enquanto, nada está faltando — só falta a
                  contagem do que voltou.
                </p>
              </div>
            </section>
          )}

          {/* ---------- Bloco 1: Controle diário (dourado) ---------- */}
          <section className={`${styles.bloco} ${styles.blocoControle}`} aria-label="Controle diário">
            <div className={styles.blocoHeader}>
              <span className={styles.blocoBadge}>Controle diário</span>
              <span className={styles.blocoDica}>Fecha o dia</span>
            </div>
            <div className={styles.blocoAcoes}>
              {bloqueadoPorDiaAnterior ? (
                <span
                  className={`${styles.cta} ${styles.ctaControleA} ${styles.ctaBloqueado}`}
                  aria-disabled="true"
                  title={`Feche o dia ${diaPendenteFormatado} antes de iniciar um novo`}
                >
                  <span className={styles.ctaIcone} aria-hidden>🔒</span>
                  <span className={styles.ctaTextos}>
                    <span className={styles.ctaTitulo}>Envio do dia</span>
                    <span className={styles.ctaSub}>Bloqueado · fechar dia anterior</span>
                  </span>
                </span>
              ) : (
                <Link
                  href="/operacao/envio-diario"
                  className={`${styles.cta} ${styles.ctaControleA}`}
                >
                  <span className={styles.ctaIcone} aria-hidden>↗</span>
                  <span className={styles.ctaTextos}>
                    <span className={styles.ctaTitulo}>Envio do dia</span>
                    <span className={styles.ctaSub}>Manhã · o que saiu</span>
                  </span>
                </Link>
              )}
              {/* Retorno do dia continua disponível mesmo bloqueado —
                  o link é redirecionado pro dia pendente quando há
                  bloqueio (operador usa pra fechar o dia velho). */}
              <Link
                href={
                  bloqueadoPorDiaAnterior && diaPendente
                    ? `/operacao/retorno-diario?data=${diaPendente.data}`
                    : '/operacao/retorno-diario'
                }
                className={`${styles.cta} ${styles.ctaControleB}`}
              >
                <span className={styles.ctaIcone} aria-hidden>↙</span>
                <span className={styles.ctaTextos}>
                  <span className={styles.ctaTitulo}>
                    {bloqueadoPorDiaAnterior ? 'Fechar dia pendente' : 'Retorno do dia'}
                  </span>
                  <span className={styles.ctaSub}>
                    {bloqueadoPorDiaAnterior && diaPendenteFormatado
                      ? `Dia ${diaPendenteFormatado}`
                      : 'Fim do dia · o que voltou'}
                  </span>
                </span>
              </Link>
            </div>
          </section>

          {/* ---------- Bloco 2: Lavanderia (roxo) ---------- */}
          <section className={`${styles.bloco} ${styles.blocoLavanderia}`} aria-label="Lavanderia">
            <div className={styles.blocoHeader}>
              <span className={styles.blocoBadge}>Lavanderia</span>
              <span className={styles.blocoDica}>Lotes externos</span>
            </div>
            <div className={styles.blocoAcoes}>
              <AcaoLink
                href="/operacao/acao/enviar-lavanderia"
                icone="↗"
                titulo="Enviar para lavanderia"
                sub="Sujo saindo do depósito"
              />
              <AcaoLink
                href="/operacao/acao/receber-lavanderia"
                icone="↙"
                titulo="Receber da lavanderia"
                sub="Limpo voltando pra estoque"
                badge={
                  totalLotesPendentes > 0
                    ? {
                        texto:
                          totalLotesPendentes === 1
                            ? '1 pendente'
                            : `${totalLotesPendentes} pendentes`,
                        // Pra leitor de tela / hover.
                        ariaLabel: `${totalLotesPendentes} lote(s) aguardando retorno`,
                      }
                    : undefined
                }
              />
            </div>
          </section>

          {/* Bloco "Imóveis" foi intencionalmente removido: a operação
           * real não controla estoque por imóvel, e a presença das ações
           * "Enviar/Receber do imóvel" gerava confusão na funcionária.
           * A rota dinâmica /operacao/acao/[acao] continua respondendo
           * para enviar-imovel/receber-imovel (não quebra bookmarks), e
           * o service MovimentacaoService segue suportando os tipos
           * saida_imovel/retorno_imovel para correções administrativas.
           */}

          {/* Bloco "Depósito" foi intencionalmente removido: entrada de
           * estoque agora é responsabilidade do admin (campo
           * `estoqueTotal` do material em /admin/materiais). Ajustes
           * manuais também saem da UI da funcionária — evitam erros e
           * centralizam a gestão. Os tipos de movimentação e actions
           * continuam no serviço para o admin usar quando precisar.
           */}

          {/* ---------- Resumo do dia (compactado) ---------- */}
          <section className={styles.resumo} aria-label="Resumo do dia">
            <h3 className={styles.resumoTitulo}>Resumo de hoje</h3>
            <div className={styles.stats}>
              <Stat label="Enviado" valor={totalEnviado} />
              <Stat label="Recebido" valor={totalRetornado} />
              <Stat label="Limpo reaproveitado" valor={totalLimpo} />
              <Stat label="Faltante" valor={totalFaltante} alerta={totalFaltante > 0} />
            </div>
          </section>

          {/* ---------- Disponibilidade (novo modelo admin-centrado) ---------- */}
          <section className={styles.card} aria-label="Disponibilidade">
            <div className={styles.cardHeader}>
              <h3>Disponibilidade por material</h3>
              <span className={styles.cardHeaderHint}>
                Total definido pelo admin · disponível = total − em uso − lavanderia
              </span>
            </div>
            <DisponibilidadeTable linhas={disponibilidade} />
          </section>

          {/* ---------- Últimos lançamentos ---------- */}
          <section className={styles.card} aria-label="Últimos lançamentos">
            <div className={styles.cardHeader}>
              <h3>Últimos lançamentos</h3>
              <span className={styles.cardHeaderHint}>{historico.length} mais recentes</span>
            </div>
            <HistoricoTable
              itens={itensTodos}
              locais={locaisTodos}
              movimentacoes={historico}
              permitirCancelar={false}
            />
          </section>
        </div>
      </main>
    </>
  );
}

function Stat({
  label,
  valor,
  alerta = false,
}: {
  label: string;
  valor: number;
  alerta?: boolean;
}) {
  return (
    <div className={`${styles.stat} ${alerta ? styles.statFaltante : ''}`}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValor}>{valor}</div>
    </div>
  );
}

function AcaoLink({
  href,
  icone,
  titulo,
  sub,
  badge,
}: {
  href: string;
  icone: string;
  titulo: string;
  sub: string;
  // Badge opcional renderizado no canto superior direito do card.
  // Quando ausente, o card aparece sem decoração extra.
  badge?: { texto: string; ariaLabel: string };
}) {
  return (
    <Link href={href} className={`${styles.acao} ${styles.acaoLavanderia}`}>
      <span className={styles.acaoIcone} aria-hidden>{icone}</span>
      <span className={styles.acaoTextos}>
        <span className={styles.acaoTitulo}>{titulo}</span>
        <span className={styles.acaoSub}>{sub}</span>
      </span>
      {badge && (
        <span
          className={styles.acaoBadge}
          role="status"
          aria-label={badge.ariaLabel}
        >
          {badge.texto}
        </span>
      )}
    </Link>
  );
}
