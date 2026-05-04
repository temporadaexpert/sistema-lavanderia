import Link from 'next/link';
import { notFound } from 'next/navigation';
import { detalheLote } from '@/app/_lib/loteData';
import { LoteId } from '@/domain/types/ids';
import type { LoteStatus } from '@/domain/types/enums';
import type { LoteDetalhe, LoteItemDetalhe } from '@/application/services/LoteLavanderiaService';
import { BotaoImprimir } from '@/app/_components/BotaoImprimir';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const STATUS_LABEL: Record<LoteStatus, string> = {
  aberto: 'Aberto',
  retorno_parcial: 'Retorno parcial',
  concluido: 'Concluído',
  com_divergencia: 'Com divergência',
  encerrado_com_pendencia: 'Encerrado com pendência',
};

interface PageProps {
  params: { id: string };
}

export default async function RomaneioPage({ params }: PageProps) {
  const lote = await detalheLote(LoteId(params.id));
  if (!lote) notFound();

  const totalPecas = lote.itens.reduce((s, i) => s + i.totalEnviado, 0);
  const statusLabel = STATUS_LABEL[lote.status];

  return (
    <>
      {/* Barra de ações — NÃO imprime */}
      <div className={styles.barraAcoes}>
        <Link href="/operacao" className={styles.voltar}>
          ← Voltar
        </Link>
        <div className={styles.infoBarra}>
          <span className={styles.codigo}>{lote.lote.codigo}</span>
          <span className={styles.statusBarra}>{statusLabel}</span>
        </div>
        <BotaoImprimir />
      </div>

      {/* Folha A4 com as duas vias */}
      <main className={styles.folha}>
        <ViaRomaneio via="depósito" lote={lote} totalPecas={totalPecas} />
        <div className={styles.linhaCorte} aria-hidden>
          <span className={styles.tesoura}>✂</span>
          <span className={styles.corteTexto}>cortar aqui</span>
        </div>
        <ViaRomaneio via="lavanderia" lote={lote} totalPecas={totalPecas} />
      </main>
    </>
  );
}

function ViaRomaneio({
  via,
  lote,
  totalPecas,
}: {
  via: 'depósito' | 'lavanderia';
  lote: LoteDetalhe;
  totalPecas: number;
}) {
  const viaLabel = via === 'depósito' ? 'VIA DEPÓSITO' : 'VIA LAVANDERIA';
  const encerrado = lote.encerrado;
  return (
    <section className={styles.via}>
      <header className={styles.cabecalho}>
        <div className={styles.marca}>
          <div className={styles.monograma}>TE</div>
          <div className={styles.textosMarca}>
            <div className={styles.empresa}>Temporada Expert</div>
            <div className={styles.produto}>TE Lavanderia Control</div>
          </div>
        </div>
        <div className={`${styles.viaBadge} ${via === 'depósito' ? styles.viaDeposito : styles.viaLavanderia}`}>
          {viaLabel}
        </div>
      </header>

      <h1 className={styles.titulo}>Romaneio de envio para lavanderia</h1>

      {encerrado && (
        <div className={styles.avisoEncerrado}>
          ATENÇÃO: lote encerrado · status: {STATUS_LABEL[lote.status]}
        </div>
      )}

      <div className={styles.meta}>
        <div className={styles.metaLinha}>
          <dl className={styles.metaDl}>
            <dt>Código do lote</dt>
            <dd>
              <strong>{lote.lote.codigo}</strong>
            </dd>
          </dl>
          <dl className={styles.metaDl}>
            <dt>Data / hora do envio</dt>
            <dd>{fmtDataHora.format(new Date(lote.lote.dataEnvio))}</dd>
          </dl>
        </div>
        <div className={styles.metaLinha}>
          <dl className={styles.metaDl}>
            <dt>Origem</dt>
            <dd>{lote.origemNome}</dd>
          </dl>
          <dl className={styles.metaDl}>
            <dt>Destino</dt>
            <dd>{lote.destinoNome}</dd>
          </dl>
        </div>
        <div className={styles.metaLinha}>
          <dl className={`${styles.metaDl} ${styles.metaFull}`}>
            <dt>Responsável pelo envio</dt>
            <dd>{lote.lote.responsavel}</dd>
          </dl>
        </div>
      </div>

      <table className={styles.tabela}>
        <thead>
          <tr>
            <th className={styles.colItem}>Material</th>
            <th className={styles.colQtd}>Quantidade</th>
          </tr>
        </thead>
        <tbody>
          {lote.itens.map((linha) => (
            <LinhaMaterial key={linha.itemId} linha={linha} />
          ))}
          {lote.itens.length === 0 && (
            <tr>
              <td colSpan={2} className={styles.tabelaVazia}>
                Nenhum item registrado.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td className={styles.totalLabel}>TOTAL DE PEÇAS</td>
            <td className={styles.totalValor}>{totalPecas}</td>
          </tr>
        </tfoot>
      </table>

      {lote.lote.observacao && (
        <div className={styles.observacao}>
          <div className={styles.observacaoLabel}>Observações</div>
          <div className={styles.observacaoTexto}>{lote.lote.observacao}</div>
        </div>
      )}

      <div className={styles.assinaturas}>
        <div className={styles.assinaturaBloco}>
          <div className={styles.linhaAssinatura} />
          <div className={styles.assinaturaLabel}>
            Depósito — entregou
            <span className={styles.assinaturaSub}>Nome · assinatura · data</span>
          </div>
        </div>
        <div className={styles.assinaturaBloco}>
          <div className={styles.linhaAssinatura} />
          <div className={styles.assinaturaLabel}>
            Lavanderia — recebeu
            <span className={styles.assinaturaSub}>Nome · assinatura · data</span>
          </div>
        </div>
      </div>

      <footer className={styles.rodape}>
        Documento de controle interno · TE Lavanderia Control · {fmtDataHora.format(new Date())}
      </footer>
    </section>
  );
}

function LinhaMaterial({ linha }: { linha: LoteItemDetalhe }) {
  const unidade = linha.unidade && linha.unidade !== 'un' ? ` ${linha.unidade}` : '';
  return (
    <tr>
      <td className={styles.colItem}>{linha.nomeItem}</td>
      <td className={styles.colQtd}>
        <strong>{linha.totalEnviado}</strong>
        {unidade}
      </td>
    </tr>
  );
}
