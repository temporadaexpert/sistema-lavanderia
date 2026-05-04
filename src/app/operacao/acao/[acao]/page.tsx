import { notFound } from 'next/navigation';
import { OperacaoHeader } from '@/app/_components/OperacaoHeader';
import { FormEnviarLavanderia } from '@/app/_components/FormEnviarLavanderia';
import {
  FormReceberLavanderia,
  type PendenciaLinha,
} from '@/app/_components/FormReceberLavanderia';
import { listarItens, listarLocais } from '@/app/_lib/data';
import { listarLotesAbertos, detalheLote } from '@/app/_lib/loteData';
import { ACAO_CONFIG } from '@/app/_lib/acoes';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// Escopo da UI da funcionária: apenas lavanderia (enviar/receber).
//
// Slugs de imóvel e depósito foram retirados deliberadamente:
//  - Controle por imóvel não é feito na operação real.
//  - Entrada/ajuste de estoque passou a ser responsabilidade do admin
//    (campo estoqueTotal do material + edição no /admin/materiais).
//
// O MovimentacaoService continua suportando todos os tipos no backend;
// só a porta pública de /operacao/acao/* é que foi fechada. Se um dia
// o admin precisar restaurar entrada/ajuste via UI, cria-se rota
// dedicada em /admin.
type AcaoExposta = 'enviar_lavanderia' | 'receber_lavanderia';

const SLUG_PARA_ACAO: Record<string, AcaoExposta> = {
  'enviar-lavanderia': 'enviar_lavanderia',
  'receber-lavanderia': 'receber_lavanderia',
};

const ICONE_POR_ACAO: Record<AcaoExposta, string> = {
  enviar_lavanderia: '↗',
  receber_lavanderia: '↙',
};

interface Props {
  params: { acao: string };
}

export default async function AcaoOperacaoPage({ params }: Props) {
  const acao = SLUG_PARA_ACAO[params.acao];
  if (!acao) notFound();
  const config = ACAO_CONFIG[acao];

  return (
    <>
      <OperacaoHeader voltarHref="/operacao" voltarLabel="Voltar" />
      <main className={`${styles.main} ${styles.tonLavanderia}`}>
        <div className={styles.container}>
          <section className={styles.hero}>
            <div className={styles.heroIcone} aria-hidden>
              {ICONE_POR_ACAO[acao]}
            </div>
            <div>
              <h1 className={styles.heroTitulo}>{config.label}</h1>
              <p className={styles.heroDescricao}>{config.descricao}</p>
            </div>
          </section>

          <section className={styles.formCard}>
            {acao === 'enviar_lavanderia' ? (
              <EnviarLavanderiaSection />
            ) : (
              <ReceberLavanderiaSection />
            )}
          </section>
        </div>
      </main>
    </>
  );
}

async function EnviarLavanderiaSection() {
  const [itens, locais] = await Promise.all([listarItens(), listarLocais()]);
  const depositos = locais.filter((l) => l.tipo === 'deposito');
  const lavanderias = locais.filter((l) => l.tipo === 'lavanderia');
  return (
    <FormEnviarLavanderia itens={itens} depositos={depositos} lavanderias={lavanderias} />
  );
}

async function ReceberLavanderiaSection() {
  const lotesAbertos = await listarLotesAbertos();
  const detalhes = await Promise.all(lotesAbertos.map((r) => detalheLote(r.lote.id)));
  const pendenciasPorLote: Record<string, PendenciaLinha[]> = {};
  for (const d of detalhes) {
    if (!d) continue;
    pendenciasPorLote[d.lote.id] = d.itens
      .filter((i) => i.pendencia > 0)
      .map((i) => ({ itemId: i.itemId, nomeItem: i.nomeItem, pendencia: i.pendencia }));
  }
  return (
    <FormReceberLavanderia
      lotesAbertos={lotesAbertos}
      pendenciasPorLote={pendenciasPorLote}
    />
  );
}
