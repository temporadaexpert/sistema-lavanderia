import { listarDivergenciasDiarias } from '@/app/_lib/controleDiarioData';
import type { ControleDiarioStatus } from '@/domain/entities/ControleDiarioEnxoval';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const fmtDataCurta = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});
const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = new Intl.NumberFormat('pt-BR');

const STATUS_LABEL: Record<ControleDiarioStatus, string> = {
  aberto: 'Aberto',
  fechado: 'Fechado',
  fechado_com_divergencia: 'Fechado com divergência',
};

const STATUS_CLASS: Record<ControleDiarioStatus, string> = {
  aberto: 'statusAberto',
  fechado: 'statusFechado',
  fechado_com_divergencia: 'statusDivergencia',
};

export default async function DivergenciasDiariasPage() {
  const divergencias = await listarDivergenciasDiarias();

  const totalDias = divergencias.length;
  const totalFaltante = divergencias.reduce((s, d) => s + d.totalFaltante, 0);
  const totalValor = divergencias.reduce((s, d) => s + d.valorEstimado, 0);
  const algumCustoParcial = divergencias.some((d) => d.custoParcial);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.badge}>Divergências diárias</div>
        <h1 className={styles.titulo}>Controle diário: perdas e divergências</h1>
        <p className={styles.subtitulo}>
          Dias com diferença entre o que saiu do depósito e o que voltou. Valor estimado
          usa o preço unitário atual cadastrado no material.
        </p>
      </header>

      <section className={styles.resumoGrid}>
        <div className={styles.resumoCard}>
          <div className={styles.resumoLabel}>Dias com divergência</div>
          <div className={styles.resumoValor}>{fmtNum.format(totalDias)}</div>
        </div>
        <div className={`${styles.resumoCard} ${totalFaltante > 0 ? styles.resumoAlerta : ''}`}>
          <div className={styles.resumoLabel}>Peças faltantes</div>
          <div className={styles.resumoValor}>{fmtNum.format(totalFaltante)}</div>
        </div>
        <div className={`${styles.resumoCard} ${totalValor > 0 ? styles.resumoAlerta : ''}`}>
          <div className={styles.resumoLabel}>Valor estimado</div>
          <div className={styles.resumoValor}>
            {fmtBRL.format(totalValor)}
            {algumCustoParcial && (
              <span className={styles.parcialMark} title="Há itens sem preço cadastrado">
                *
              </span>
            )}
          </div>
        </div>
      </section>

      {algumCustoParcial && (
        <div className={styles.avisoParcial}>
          <strong>Valor parcial.</strong> Alguns materiais faltantes não têm preço
          unitário cadastrado — esses itens ficam fora do total financeiro. Cadastre
          preço em <a href="/admin/materiais">Materiais</a> pra ter o valor completo.
        </div>
      )}

      {totalDias === 0 ? (
        <div className={styles.vazio}>
          <div className={styles.vazioIcone} aria-hidden>✓</div>
          <div className={styles.vazioTitulo}>Nenhuma divergência até agora</div>
          <p className={styles.vazioSub}>
            Todos os dias fecharam com a contagem batendo. Quando acontecer diferença
            entre envio e retorno, ela aparece aqui automaticamente.
          </p>
        </div>
      ) : (
        <section className={styles.lista} aria-label="Dias com divergência">
          {divergencias.map((d) => (
            <article key={d.data} className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.cardData}>
                    {fmtDataCurta.format(new Date(`${d.data}T12:00:00Z`))}
                  </div>
                  <span className={`${styles.cardStatus} ${styles[STATUS_CLASS[d.status]] ?? ''}`}>
                    {STATUS_LABEL[d.status]}
                  </span>
                </div>
                <div className={styles.cardValores}>
                  <div className={styles.cardMetricaPrincipal}>
                    {d.totalFaltante > 0 && (
                      <span className={styles.cardFaltante}>−{d.totalFaltante} peça(s)</span>
                    )}
                    {d.totalExcedente > 0 && (
                      <span className={styles.cardExcedente}>+{d.totalExcedente} em excesso</span>
                    )}
                  </div>
                  <div className={styles.cardValor}>
                    {fmtBRL.format(d.valorEstimado)}
                    {d.custoParcial && <span className={styles.parcialMark}>*</span>}
                  </div>
                </div>
              </div>

              <ul className={styles.itensLista}>
                {d.itens.map((i) => (
                  <li key={i.itemId} className={styles.itemLinha}>
                    <span className={styles.itemNome}>{i.nomeItem}</span>
                    <span className={styles.itemMetricas}>
                      {i.faltante > 0 && (
                        <span className={styles.itemFaltante}>−{i.faltante}</span>
                      )}
                      {i.excedente > 0 && (
                        <span className={styles.itemExcedente}>+{i.excedente}</span>
                      )}
                      <span className={styles.itemValor}>
                        {i.valorFaltante == null ? (
                          <span className={styles.muted}>sem preço</span>
                        ) : (
                          fmtBRL.format(i.valorFaltante)
                        )}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>

              {d.motivoDivergencia && (
                <div className={styles.motivoBox}>
                  <div className={styles.motivoLabel}>Motivo registrado</div>
                  <div className={styles.motivoTexto}>{d.motivoDivergencia}</div>
                  {d.responsavelFechamento && (
                    <div className={styles.motivoMeta}>
                      Autorizado por <strong>{d.responsavelFechamento}</strong>
                      {d.fechadoEm && (
                        <> em {fmtDataHora.format(new Date(d.fechadoEm))}</>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!d.motivoDivergencia && d.status === 'aberto' && (
                <div className={styles.avisoAberto}>
                  Dia ainda aberto. O motivo será registrado quando a funcionária
                  fechar o dia.
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
