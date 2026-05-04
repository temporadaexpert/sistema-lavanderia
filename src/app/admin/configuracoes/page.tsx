import { getContainer } from '@/infrastructure/singleton';
import { LimparTestesForm } from '@/app/_components/LimparTestesForm';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesPage() {
  const c = await getContainer();
  const [movs, lotes, contatos, controles, itens, locais] = await Promise.all([
    c.movimentacoes.listar({ incluirCanceladas: true }),
    c.lotes.listar(),
    c.contatosLavanderia.listar(),
    c.controlesDiarios.listar(),
    c.itens.listar(),
    c.locais.listar(),
  ]);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <span className={styles.badge}>Administração</span>
        <h1 className={styles.titulo}>Configurações</h1>
        <p className={styles.sub}>
          Ações administrativas sensíveis. Altere aqui apenas o estritamente necessário —
          limpeza de testes antes do go-live, ajustes de base.
        </p>
      </header>

      <section className={`${styles.secao} ${styles.secaoDanger}`} aria-label="Zona perigosa">
        <div className={styles.secaoHeader}>
          <h2 className={`${styles.secaoTitulo} ${styles.secaoTituloDanger}`}>
            Limpar dados operacionais de teste
          </h2>
          <p className={styles.secaoSub}>
            Use antes do início da operação real para zerar a base de demonstração.
          </p>
        </div>

        <p className={styles.secaoSub}>
          <strong>Será removido:</strong>
        </p>
        <ul className={styles.lista}>
          <li>Todas as movimentações (inclusive canceladas).</li>
          <li>Todos os lotes de lavanderia (envios, retornos, encerramentos).</li>
          <li>Divergências e perdas (são projeções — somem junto).</li>
          <li>Histórico de cobranças/contatos com a lavanderia.</li>
          <li>Controles diários do depósito (envio/retorno diário).</li>
        </ul>

        <p className={styles.secaoSub}>
          <strong>Será preservado:</strong>
        </p>
        <ul className={styles.lista}>
          <li>Materiais cadastrados ({itens.length}).</li>
          <li>Locais cadastrados ({locais.length}).</li>
          <li>Senha de administrador e sessão.</li>
          <li>Configurações de sistema.</li>
        </ul>

        <LimparTestesForm
          contagens={{
            movimentacoes: movs.length,
            lotes: lotes.length,
            contatos: contatos.length,
            controlesDiarios: controles.length,
            itens: itens.length,
            locais: locais.length,
          }}
        />
      </section>

      <section className={styles.secao}>
        <div className={styles.secaoHeader}>
          <h2 className={styles.secaoTitulo}>Cancelamento de lançamentos</h2>
          <p className={styles.secaoSub}>
            Para corrigir um lançamento errado feito pela equipe, use o botão{' '}
            <strong>Cancelar</strong> ao lado da linha correspondente na tela operacional
            (histórico) ou no detalhe do lote. O lançamento permanece no histórico como
            cancelado com motivo e responsável registrados — sem impactar saldo, relatórios
            ou dashboard.
          </p>
          <p className={styles.secaoSub}>
            Lançamentos ligados a lote de lavanderia (envio/retorno/baixa de encerramento)
            NÃO podem ser cancelados isoladamente — use o fluxo do próprio lote para corrigir.
          </p>
        </div>
      </section>
    </main>
  );
}
