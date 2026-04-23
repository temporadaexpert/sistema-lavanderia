import Link from 'next/link';
import {
  categoriasExistentes,
  listarTodosMateriais,
  unidadesExistentes,
} from '@/app/_lib/materialData';
import { MaterialFormDialog } from '@/app/_components/MaterialFormDialog';
import { MaterialStatusToggle } from '@/app/_components/MaterialStatusToggle';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = new Intl.NumberFormat('pt-BR');

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function MateriaisListagem({ searchParams }: PageProps) {
  const mostrarInativos = searchParams.inativos === 'true';

  const [todos, categorias, unidades] = await Promise.all([
    listarTodosMateriais(),
    categoriasExistentes(),
    unidadesExistentes(),
  ]);

  const visiveis = mostrarInativos ? todos : todos.filter((i) => i.ativo);
  const totais = {
    total: todos.length,
    ativos: todos.filter((i) => i.ativo).length,
    inativos: todos.filter((i) => !i.ativo).length,
    semPreco: todos.filter((i) => i.ativo && i.valorUnitario == null).length,
    semEstoqueMinimo: todos.filter((i) => i.ativo && i.estoqueMinimo == null).length,
  };

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <h1>Cadastro de Materiais</h1>
            <p className={styles.subtitulo}>
              Base única do sistema. Cada material aparece aqui, na operação e nos relatórios.
            </p>
          </div>
          <MaterialFormDialog
            modo="criar"
            categoriasConhecidas={categorias}
            unidadesConhecidas={unidades}
          />
        </div>
      </header>

      <section className={styles.cards}>
        <Card titulo="Total cadastrado" valor={String(totais.total)} />
        <Card titulo="Ativos" valor={String(totais.ativos)} />
        <Card titulo="Inativos" valor={String(totais.inativos)} />
        <Card
          titulo="Ativos sem preço"
          valor={String(totais.semPreco)}
          destaque={totais.semPreco > 0}
          hint="Impacta custo estimado"
        />
        <Card
          titulo="Ativos sem estoque mín."
          valor={String(totais.semEstoqueMinimo)}
          hint="Não aparecem em alertas"
        />
      </section>

      <nav className={styles.filtros} aria-label="Exibição">
        <Link
          href="/admin/materiais"
          className={`${styles.filtroItem} ${!mostrarInativos ? styles.filtroItemAtivo : ''}`}
        >
          Apenas ativos
        </Link>
        <Link
          href="/admin/materiais?inativos=true"
          className={`${styles.filtroItem} ${mostrarInativos ? styles.filtroItemAtivo : ''}`}
        >
          Incluir inativos
        </Link>
      </nav>

      <section className={styles.secao}>
        <div className={styles.secaoHeader}>
          <h2>
            {visiveis.length} material(is) — {mostrarInativos ? 'ativos e inativos' : 'ativos'}
          </h2>
        </div>

        {visiveis.length === 0 ? (
          <div className={styles.vazio}>
            Nenhum material nesse filtro. Use o botão <strong>+ Novo material</strong> para cadastrar.
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Categoria</th>
                  <th className={styles.num}>Unidade</th>
                  <th className={styles.num}>Valor unitário</th>
                  <th className={styles.num}>Estoque mín.</th>
                  <th>Status</th>
                  <th className={styles.acoesCol}></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((item) => (
                  <tr key={item.id} className={!item.ativo ? styles.rowInativo : ''}>
                    <td>
                      <div className={styles.nomeCelula}>
                        <strong>{item.nome}</strong>
                      </div>
                    </td>
                    <td>{item.categoria}</td>
                    <td className={styles.num}>{item.unidade}</td>
                    <td className={styles.num}>
                      {item.valorUnitario != null ? (
                        fmtBRL.format(item.valorUnitario)
                      ) : (
                        <span className={styles.semValor}>— sem preço</span>
                      )}
                    </td>
                    <td className={styles.num}>
                      {item.estoqueMinimo != null ? (
                        `${fmtNum.format(item.estoqueMinimo)} ${item.unidade}`
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`${styles.badgeStatus} ${item.ativo ? styles.statusAtivo : styles.statusInativo}`}
                      >
                        {item.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className={styles.acoesCol}>
                      <div className={styles.acoes}>
                        <MaterialFormDialog
                          modo="editar"
                          item={item}
                          categoriasConhecidas={categorias}
                          unidadesConhecidas={unidades}
                          tamanhoBotao="pequeno"
                        />
                        <MaterialStatusToggle id={item.id} ativo={item.ativo} />
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
        Itens inativos não aparecem nos formulários de operação, mas o histórico de movimentações
        que os envolve continua intacto — o log é imutável.
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
