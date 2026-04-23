import Link from 'next/link';
import { OperacaoForm } from './_components/OperacaoForm';
import type { PendenciaLinha } from './_components/FormReceberLavanderia';
import { SaldoTable } from './_components/SaldoTable';
import { HistoricoTable } from './_components/HistoricoTable';
import {
  historicoRecente,
  listarItens,
  listarLocais,
  saldoNoDeposito,
} from './_lib/data';
import { listarLotesAbertos, detalheLote } from './_lib/loteData';
import styles from './page.module.css';

// Server component: faz fan-out paralelo nos loaders e renderiza a tela
// operacional. router.refresh() do form dispara uma nova execução desta
// função — é isso que mantém saldo e histórico em dia.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const [itens, locais, deposito, historico, lotesAbertos] = await Promise.all([
    listarItens(),
    listarLocais(),
    saldoNoDeposito(),
    historicoRecente(15),
    listarLotesAbertos(),
  ]);

  // Carrega pendências de cada lote aberto em paralelo para que o form de
  // retorno não precise chamar outra API no cliente. Em sistemas com muitos
  // lotes abertos, vira um endpoint dedicado; para o volume atual, fan-out
  // é suficiente.
  const detalhes = await Promise.all(
    lotesAbertos.map((r) => detalheLote(r.lote.id)),
  );
  const pendenciasPorLote: Record<string, PendenciaLinha[]> = {};
  for (const d of detalhes) {
    if (!d) continue;
    pendenciasPorLote[d.lote.id] = d.itens
      .filter((i) => i.pendencia > 0)
      .map((i) => ({ itemId: i.itemId, nomeItem: i.nomeItem, pendencia: i.pendencia }));
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <h1>Sistema de Lavanderia</h1>
            <p>Contexto operacional — registro de movimentações do dia a dia.</p>
          </div>
          <div className={styles.navAdmin}>
            <Link href="/admin" className={`${styles.linkAdmin} ${styles.linkAdminPrimario}`}>
              Painel admin →
            </Link>
            <Link href="/admin/lotes-lavanderia" className={styles.linkAdmin}>
              Lotes
            </Link>
            <Link href="/admin/lavanderia" className={styles.linkAdmin}>
              Custos
            </Link>
            <Link href="/admin/perdas" className={styles.linkAdmin}>
              Perdas
            </Link>
          </div>
        </div>
      </header>

      <div className={styles.grid}>
        <section className={`${styles.card} ${styles.cardOperacao}`} aria-label="Área operacional">
          <div className={styles.cardHeader}>
            <span className={styles.badgeOperacao}>Operação</span>
            <h2>Registrar operação</h2>
          </div>
          <OperacaoForm
            itens={itens}
            locais={locais}
            lotesAbertos={lotesAbertos}
            pendenciasPorLote={pendenciasPorLote}
          />
        </section>

        <div className={styles.rightColumn} aria-label="Acompanhamento">
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.badgeAcompanhamento}>Acompanhamento</span>
              <h2>Saldo atual por item</h2>
            </div>
            <SaldoTable itens={itens} local={deposito.local} saldos={deposito.saldos} />
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.badgeAcompanhamento}>Acompanhamento</span>
              <h2>Histórico recente</h2>
            </div>
            <HistoricoTable itens={itens} locais={locais} movimentacoes={historico} />
          </section>
        </div>
      </div>
    </main>
  );
}
