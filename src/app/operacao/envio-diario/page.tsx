import { listarItens } from '@/app/_lib/data';
import { OperacaoHeader } from '@/app/_components/OperacaoHeader';
import {
  hojeISO,
  obterControleDoDia,
} from '@/app/_lib/controleDiarioData';
import { FormEnvioDiario } from '@/app/_components/FormEnvioDiario';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const fmtData = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
});

interface Props {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function EnvioDiarioPage({ searchParams }: Props) {
  // Aceita ?data=YYYY-MM-DD pra acessar/editar um dia específico
  // (ex.: operador clica "Abrir controle pendente" no banner de bloqueio
  // da /operacao). Fallback = hoje.
  const dataParam = typeof searchParams.data === 'string' ? searchParams.data : '';
  const dataAlvo =
    /^\d{4}-\d{2}-\d{2}$/.test(dataParam) && !Number.isNaN(Date.parse(dataParam))
      ? dataParam
      : hojeISO();
  const dataHoje = dataAlvo;
  const [itens, controleAtual] = await Promise.all([
    listarItens(),
    obterControleDoDia(dataHoje),
  ]);

  // Se já houve envio hoje, pré-preenche os contadores. Responsável também —
  // evita redigitar quando a mesma pessoa ajusta a contagem.
  const valoresIniciais = new Map<string, number>();
  for (const e of controleAtual?.enviado ?? []) {
    valoresIniciais.set(e.itemId, e.quantidade);
  }

  const opcoes = itens.map((i) => ({ id: i.id, nome: i.nome, categoria: i.categoria }));
  const jaRegistrado = (controleAtual?.enviado.length ?? 0) > 0;

  return (
    <>
      <OperacaoHeader voltarHref="/operacao" voltarLabel="Voltar" />
      <main className={styles.main}>
        <div className={styles.container}>
          <section className={styles.heroAcao}>
            <span className={styles.heroBadge}>Manhã · envio</span>
            <h1 className={styles.heroTitulo}>O que saiu hoje?</h1>
            <p className={styles.heroSub}>
              {fmtData.format(new Date(`${dataHoje}T12:00:00Z`))} · aumente e diminua com
              os botões, depois salve.
            </p>
            {jaRegistrado && (
              <div className={styles.pilula}>
                <span>✓</span> Envio já registrado · você pode ajustar
              </div>
            )}
          </section>

          <FormEnvioDiario
            dataHoje={dataHoje}
            itens={opcoes}
            valoresIniciais={valoresIniciais}
            responsavelInicial={controleAtual?.responsavelEnvio ?? null}
          />
        </div>
      </main>
    </>
  );
}
