import Link from 'next/link';
import { listarTodosLocais } from '@/app/_lib/localData';
import { LocalFormDialog } from '@/app/_components/LocalFormDialog';
import { LocalStatusToggle } from '@/app/_components/LocalStatusToggle';
import type { LocalTipo } from '@/domain/types/enums';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const fmtNum = new Intl.NumberFormat('pt-BR');

const TIPO_LABEL: Record<LocalTipo, string> = {
  deposito: 'Depósito',
  imovel: 'Imóvel',
  lavanderia: 'Lavanderia',
};

const TIPO_CLASS: Record<LocalTipo, string> = {
  deposito: 'tipoDeposito',
  imovel: 'tipoImovel',
  lavanderia: 'tipoLavanderia',
};

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function LocaisListagem({ searchParams }: PageProps) {
  const mostrarInativos = searchParams.inativos === 'true';

  const todos = await listarTodosLocais();
  const visiveis = mostrarInativos ? todos : todos.filter((l) => l.ativo);

  const totais = {
    total: todos.length,
    ativos: todos.filter((l) => l.ativo).length,
    inativos: todos.filter((l) => !l.ativo).length,
    depositosAtivos: todos.filter((l) => l.ativo && l.tipo === 'deposito').length,
    imoveisAtivos: todos.filter((l) => l.ativo && l.tipo === 'imovel').length,
    lavanderiasAtivas: todos.filter((l) => l.ativo && l.tipo === 'lavanderia').length,
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
            <Link href="/admin/lotes-lavanderia" className={styles.linkLateral}>
              Lotes
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
        <div className={styles.headerTop}>
          <div>
            <h1>Cadastro de Locais</h1>
            <p className={styles.subtitulo}>
              Depósitos, imóveis e lavanderias. Base única consumida pela operação, lotes e
              relatórios.
            </p>
          </div>
          <LocalFormDialog modo="criar" />
        </div>
      </header>

      <section className={styles.cards}>
        <Card titulo="Total cadastrado" valor={String(totais.total)} />
        <Card titulo="Ativos" valor={String(totais.ativos)} />
        <Card titulo="Inativos" valor={String(totais.inativos)} />
        <Card
          titulo="Depósitos ativos"
          valor={String(totais.depositosAtivos)}
          destaque={totais.depositosAtivos === 0}
          hint={totais.depositosAtivos === 0 ? 'Sem depósito a operação trava' : undefined}
        />
        <Card
          titulo="Imóveis ativos"
          valor={String(totais.imoveisAtivos)}
        />
        <Card
          titulo="Lavanderias ativas"
          valor={String(totais.lavanderiasAtivas)}
          destaque={totais.lavanderiasAtivas === 0}
          hint={totais.lavanderiasAtivas === 0 ? 'Sem lavanderia não cria lote' : undefined}
        />
      </section>

      <nav className={styles.filtros} aria-label="Exibição">
        <Link
          href="/admin/locais"
          className={`${styles.filtroItem} ${!mostrarInativos ? styles.filtroItemAtivo : ''}`}
        >
          Apenas ativos
        </Link>
        <Link
          href="/admin/locais?inativos=true"
          className={`${styles.filtroItem} ${mostrarInativos ? styles.filtroItemAtivo : ''}`}
        >
          Incluir inativos
        </Link>
      </nav>

      <section className={styles.secao}>
        <div className={styles.secaoHeader}>
          <h2>
            {fmtNum.format(visiveis.length)} local(is) —{' '}
            {mostrarInativos ? 'ativos e inativos' : 'ativos'}
          </h2>
        </div>

        {visiveis.length === 0 ? (
          <div className={styles.vazio}>
            Nenhum local nesse filtro. Use <strong>+ Novo local</strong> para cadastrar.
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Local</th>
                  <th>Tipo</th>
                  <th>Status</th>
                  <th className={styles.acoesCol}></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((local) => (
                  <tr key={local.id} className={!local.ativo ? styles.rowInativo : ''}>
                    <td>
                      <strong>{local.nome}</strong>
                    </td>
                    <td>
                      <span className={`${styles.badgeTipo} ${styles[TIPO_CLASS[local.tipo]] ?? ''}`}>
                        {TIPO_LABEL[local.tipo]}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`${styles.badgeStatus} ${local.ativo ? styles.statusAtivo : styles.statusInativo}`}
                      >
                        {local.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className={styles.acoesCol}>
                      <div className={styles.acoes}>
                        <LocalFormDialog
                          modo="editar"
                          local={local}
                          tamanhoBotao="pequeno"
                        />
                        <LocalStatusToggle id={local.id} ativo={local.ativo} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className={styles.rodape}>
        Locais inativos não aparecem nos formulários de operação, mas continuam resolvendo
        nomes em movimentações e lotes antigos — o histórico nunca quebra.
      </p>
    </main>
  );
}

function Card({
  titulo,
  valor,
  destaque,
  hint,
}: {
  titulo: string;
  valor: string;
  destaque?: boolean;
  hint?: string;
}) {
  return (
    <div className={`${styles.card} ${destaque ? styles.cardDestaque : ''}`}>
      <div className={styles.cardTitulo}>{titulo}</div>
      <div className={styles.cardValor}>{valor}</div>
      {hint && <div className={styles.cardHint}>{hint}</div>}
    </div>
  );
}
