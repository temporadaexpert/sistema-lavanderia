import { carregarDadosCorrecao, ymdSP } from '@/app/_lib/correcaoAdminData';
import { CorrigirEnvioLavanderiaDialog } from '@/app/_components/CorrigirEnvioLavanderiaDialog';
import { CorrigirRetornoLavanderiaDialog } from '@/app/_components/CorrigirRetornoLavanderiaDialog';
import { CorrigirMovSimplesDialog } from '@/app/_components/CorrigirMovSimplesDialog';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams?: Promise<{ data?: string }>;
}

// Página admin para CORREÇÃO DE LANÇAMENTOS. 4 fluxos editáveis:
// envio/retorno lavanderia + saída/retorno imóvel. Filtra por data
// (default: hoje em SP). Cada operação tem botão "Corrigir" que abre
// modal — service registra correção em correcoes_admin com auditoria
// completa (anterior/novo/motivo/admin) e cancela+regrava as movs.
export default async function CorrecoesPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const dataAtual = sp.data && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) ? sp.data : ymdSP();
  const dados = await carregarDadosCorrecao(dataAtual);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.titulo}>Correções de lançamentos</h1>
        <p className={styles.sub}>
          Corrija quantidades digitadas erradas pela equipe operacional. Toda
          alteração é registrada como auditoria com motivo, admin responsável
          e ids das movimentações canceladas/criadas. Movimentações originais
          NÃO são apagadas — ficam no log marcadas como canceladas.
        </p>
      </header>

      <form className={styles.filtros} method="get">
        <label className={styles.filtroCampo}>
          <span className={styles.filtroLabel}>Data</span>
          <input
            type="date"
            name="data"
            defaultValue={dataAtual}
            className={styles.filtroInput}
          />
        </label>
        <button type="submit" className={styles.botaoCorrigir}>
          Filtrar
        </button>
      </form>

      <SecaoEnviosLavanderia envios={dados.enviosLavanderia} />
      <SecaoRetornosLavanderia retornos={dados.retornosLavanderia} />
      <SecaoMovsImovel movs={dados.movsImovel} />
      <SecaoHistorico historico={dados.historicoCorrecoes} />
    </main>
  );
}

function SecaoEnviosLavanderia({
  envios,
}: {
  readonly envios: Awaited<ReturnType<typeof carregarDadosCorrecao>>['enviosLavanderia'];
}) {
  return (
    <section className={styles.secao}>
      <h2 className={styles.secaoTitulo}>Envios para lavanderia</h2>
      <p className={styles.secaoSub}>
        Lotes criados nesta data. Editar quantidade cancela a mov original e
        cria uma nova com mesmo lote, herdando snapshot de preço (sem
        distorcer custo histórico).
      </p>
      {envios.length === 0 ? (
        <div className={styles.vazio}>Sem envios nesta data.</div>
      ) : (
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Lote</th>
              <th>Responsável</th>
              <th>Itens</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {envios.map((e) => (
              <tr key={e.loteId}>
                <td>
                  {e.loteCodigo}
                  {e.encerrado ? <em> (encerrado)</em> : ''}
                </td>
                <td>{e.responsavel}</td>
                <td>
                  {e.itens.map((i) => `${i.nomeItem}: ${i.quantidade}`).join(' · ')}
                </td>
                <td>
                  <CorrigirEnvioLavanderiaDialog
                    loteId={e.loteId}
                    loteCodigo={e.loteCodigo}
                    encerrado={e.encerrado}
                    itens={e.itens.map((i) => ({
                      itemId: i.itemId,
                      nomeItem: i.nomeItem,
                      quantidade: i.quantidade,
                    }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SecaoRetornosLavanderia({
  retornos,
}: {
  readonly retornos: Awaited<ReturnType<typeof carregarDadosCorrecao>>['retornosLavanderia'];
}) {
  return (
    <section className={styles.secao}>
      <h2 className={styles.secaoTitulo}>Retornos da lavanderia</h2>
      <p className={styles.secaoSub}>
        Operações de recebimento agrupadas por id. Inclui o fan-out
        cross-lote (peças que voltaram pra lotes anteriores) e excedente
        operacional não conciliado.
      </p>
      {retornos.length === 0 ? (
        <div className={styles.vazio}>Sem retornos nesta data.</div>
      ) : (
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Operação</th>
              <th>Lote-âncora</th>
              <th>Responsável</th>
              <th>Itens</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {retornos.map((r) => (
              <tr key={r.operacaoId}>
                <td>{r.dataRetorno.slice(11, 16)}</td>
                <td>{r.loteAtualCodigo ?? '—'}</td>
                <td>{r.responsavel}</td>
                <td>
                  {r.itens
                    .map((i) => `${i.nomeItem}: ${i.quantidadeTotal}`)
                    .join(' · ')}
                </td>
                <td>
                  <CorrigirRetornoLavanderiaDialog
                    operacaoId={r.operacaoId}
                    loteAtualCodigo={r.loteAtualCodigo}
                    itens={r.itens}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SecaoMovsImovel({
  movs,
}: {
  readonly movs: Awaited<ReturnType<typeof carregarDadosCorrecao>>['movsImovel'];
}) {
  const saidas = movs.filter((m) => m.tipo === 'saida_imovel');
  const retornos = movs.filter((m) => m.tipo === 'retorno_imovel');
  return (
    <>
      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>Envios para casas/unidades</h2>
        <p className={styles.secaoSub}>
          Saídas do depósito para imóveis. Cada movimentação é independente
          (1 mov = 1 evento).
        </p>
        {saidas.length === 0 ? (
          <div className={styles.vazio}>Sem envios nesta data.</div>
        ) : (
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Imóvel</th>
                <th>Responsável</th>
                <th>Item</th>
                <th className={styles.qtdCol}>Qtd</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {saidas.map((m) => (
                <tr key={m.movId}>
                  <td>{m.dataHora.slice(11, 16)}</td>
                  <td>{m.imovelNome}</td>
                  <td>{m.responsavel}</td>
                  <td>{m.nomeItem}</td>
                  <td className={styles.qtdCol}>{m.quantidade}</td>
                  <td>
                    <CorrigirMovSimplesDialog
                      movId={m.movId}
                      nomeItem={m.nomeItem}
                      quantidade={m.quantidade}
                      tipo="saida_imovel"
                      imovelNome={m.imovelNome}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>Retornos das casas/unidades</h2>
        {retornos.length === 0 ? (
          <div className={styles.vazio}>Sem retornos nesta data.</div>
        ) : (
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Imóvel</th>
                <th>Responsável</th>
                <th>Item</th>
                <th className={styles.qtdCol}>Qtd</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {retornos.map((m) => (
                <tr key={m.movId}>
                  <td>{m.dataHora.slice(11, 16)}</td>
                  <td>{m.imovelNome}</td>
                  <td>{m.responsavel}</td>
                  <td>{m.nomeItem}</td>
                  <td className={styles.qtdCol}>{m.quantidade}</td>
                  <td>
                    <CorrigirMovSimplesDialog
                      movId={m.movId}
                      nomeItem={m.nomeItem}
                      quantidade={m.quantidade}
                      tipo="retorno_imovel"
                      imovelNome={m.imovelNome}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function SecaoHistorico({
  historico,
}: {
  readonly historico: Awaited<ReturnType<typeof carregarDadosCorrecao>>['historicoCorrecoes'];
}) {
  return (
    <section className={styles.secao}>
      <h2 className={styles.secaoTitulo}>Histórico de correções (este dia)</h2>
      <p className={styles.secaoSub}>
        Trilha de auditoria. Movs canceladas continuam visíveis no log
        (riscadas) com motivo e admin responsável.
      </p>
      {historico.length === 0 ? (
        <div className={styles.vazio}>Sem correções nesta data.</div>
      ) : (
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Tipo</th>
              <th>Item</th>
              <th>Anterior</th>
              <th>Nova</th>
              <th>Diferença</th>
              <th>Admin</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {historico.map((c) => (
              <tr key={c.id}>
                <td>{c.corrigidoEm.slice(11, 16)}</td>
                <td>{c.tipoBloco}</td>
                <td>{c.nomeItemSnapshot}</td>
                <td className={styles.qtdCol}>{c.quantidadeAnterior}</td>
                <td className={styles.qtdCol}>{c.quantidadeNova}</td>
                <td className={styles.qtdCol}>
                  <span
                    className={
                      c.diferenca > 0
                        ? styles.diferencaPositiva
                        : c.diferenca < 0
                          ? styles.diferencaNegativa
                          : ''
                    }
                  >
                    {c.diferenca > 0 ? `+${c.diferenca}` : c.diferenca}
                  </span>
                </td>
                <td>{c.adminResponsavel}</td>
                <td>{c.motivo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
