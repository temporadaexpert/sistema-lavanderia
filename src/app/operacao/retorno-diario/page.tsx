import { listarItens, listarItensTodos } from '@/app/_lib/data';
import { OperacaoHeader } from '@/app/_components/OperacaoHeader';
import {
  hojeISO,
  obterControleDoDia,
  divergenciaDoDia,
} from '@/app/_lib/controleDiarioData';
import { FormRetornoDiario } from '@/app/_components/FormRetornoDiario';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const fmtData = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
});

interface Props {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function RetornoDiarioPage({ searchParams }: Props) {
  // Aceita ?data=YYYY-MM-DD pra acessar/fechar um dia pendente específico.
  const dataParam = typeof searchParams.data === 'string' ? searchParams.data : '';
  const dataAlvo =
    /^\d{4}-\d{2}-\d{2}$/.test(dataParam) && !Number.isNaN(Date.parse(dataParam))
      ? dataParam
      : hojeISO();
  const dataHoje = dataAlvo;
  const [itens, itensTodos, controleAtual, divergencia] = await Promise.all([
    listarItens(),
    listarItensTodos(),
    obterControleDoDia(dataHoje),
    divergenciaDoDia(dataHoje),
  ]);

  // Catálogo completo para resolver nomes no alerta de divergência:
  // um item pode ter sido inativado depois do envio do dia. Os
  // contadores abaixo (`opcoes`) continuam com ativos apenas.
  const nomePorItem = new Map(itensTodos.map((i) => [i.id, i.nome]));

  const valoresIniciais = new Map<string, { sujo: number; limpo: number }>();
  for (const r of controleAtual?.retorno ?? []) {
    valoresIniciais.set(r.itemId, {
      sujo: r.recebidoSujo,
      limpo: r.recebidoLimpo,
    });
  }

  const opcoes = itens.map((i) => ({ id: i.id, nome: i.nome, categoria: i.categoria }));
  const temEnvioHoje = (controleAtual?.enviado.length ?? 0) > 0;
  const jaFechado =
    controleAtual?.status === 'fechado' ||
    controleAtual?.status === 'fechado_com_divergencia';

  const faltantes = divergencia?.linhas.filter((l) => l.classe === 'faltando') ?? [];
  const excedentes = divergencia?.linhas.filter((l) => l.classe === 'excedente') ?? [];

  // Resumo para o modal de fechamento — só as linhas com faltante,
  // já com nome humano resolvido.
  const linhasFaltanteParaModal = faltantes.map((l) => ({
    itemId: l.itemId,
    nomeItem: nomePorItem.get(l.itemId) ?? String(l.itemId),
    faltante: l.divergencia,
  }));

  return (
    <>
      <OperacaoHeader voltarHref="/operacao" voltarLabel="Voltar" />
      <main className={styles.main}>
        <div className={styles.container}>
          <section className={styles.heroAcao}>
            <span className={styles.heroBadge}>Fim do dia · retorno</span>
            <h1 className={styles.heroTitulo}>O que voltou hoje?</h1>
            <p className={styles.heroSub}>
              {fmtData.format(new Date(`${dataHoje}T12:00:00Z`))} · separe o que voltou
              <strong> sujo</strong> do que voltou <strong>limpo e não usado</strong>.
            </p>
          </section>

          {!temEnvioHoje && (
            <div className={styles.avisoAmarelo} role="note">
              <strong>Envio não registrado hoje.</strong> Sem envio como base, qualquer
              contagem aparece como excesso. Registre o envio antes, se esqueceu.
            </div>
          )}

          {divergencia?.temDivergencia && temEnvioHoje && (
            <div className={styles.avisoVermelho} role="alert">
              <div className={styles.avisoTitulo}>
                <span className={styles.avisoIcone}>!</span>
                <span>Divergência no dia</span>
              </div>
              <p className={styles.avisoResumo}>
                {faltantes.length > 0 && (
                  <>
                    Faltam <strong>{divergencia.totalFaltante} peça(s)</strong>.
                  </>
                )}
                {excedentes.length > 0 && (
                  <>
                    {' '}Excesso: <strong>{divergencia.totalExcedente} peça(s)</strong>.
                  </>
                )}
              </p>
              <ul className={styles.avisoLista}>
                {faltantes.map((l) => (
                  <li key={`f-${l.itemId}`} className={styles.avisoLinhaFaltando}>
                    <strong>{nomePorItem.get(l.itemId) ?? l.itemId}</strong>: enviou{' '}
                    {l.enviado}, voltou {l.totalRetornado} ·{' '}
                    <span className={styles.destaque}>faltam {l.divergencia}</span>
                  </li>
                ))}
                {excedentes.map((l) => (
                  <li key={`e-${l.itemId}`} className={styles.avisoLinhaExcedente}>
                    <strong>{nomePorItem.get(l.itemId) ?? l.itemId}</strong>: enviou{' '}
                    {l.enviado}, voltou {l.totalRetornado} ·{' '}
                    <span className={styles.destaque}>excesso {-l.divergencia}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Estado neutro: envio existe, retorno ainda não registrado.
              Antes esse caso disparava o alerta vermelho (todo enviado
              "faltando"). Agora a projeção devolve aguardandoRetorno=true
              e o operador vê instrução clara, sem cor de alarme. */}
          {divergencia?.aguardandoRetorno && temEnvioHoje && (
            <div className={styles.avisoNeutro} role="status">
              <span aria-hidden>·</span>
              Retorno do dia ainda não registrado. Conte abaixo o que
              voltou para que a divergência seja calculada.
            </div>
          )}

          {divergencia &&
            !divergencia.aguardandoRetorno &&
            !divergencia.temDivergencia &&
            temEnvioHoje && (
              <div className={styles.avisoVerde}>
                <span className={styles.avisoCheck}>✓</span>
                Contagem bate com o envio do dia.
              </div>
            )}

          <FormRetornoDiario
            dataHoje={dataHoje}
            itens={opcoes}
            valoresIniciais={valoresIniciais}
            responsavelInicial={controleAtual?.responsavelRetorno ?? null}
            jaFechado={jaFechado}
            temDivergenciaHoje={divergencia?.temDivergencia ?? false}
            totalFaltanteHoje={divergencia?.totalFaltante ?? 0}
            totalExcedenteHoje={divergencia?.totalExcedente ?? 0}
            linhasFaltanteHoje={linhasFaltanteParaModal}
          />

          {divergencia && divergencia.totalSujo > 0 && (
            <div className={styles.boxLavanderia}>
              <div className={styles.boxLavanderiaNum}>{divergencia.totalSujo}</div>
              <div className={styles.boxLavanderiaTexto}>
                <strong>peça(s) sujas prontas</strong>
                <span>Envie à lavanderia pelo módulo de lotes quando estiver pronto.</span>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
