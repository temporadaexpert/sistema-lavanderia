import styles from './AvisoFalhaParcial.module.css';

// Banner discreto exibido no topo de /operacao e /admin quando algum
// loader não-crítico caiu. Não bloqueia a página — só sinaliza ao
// usuário que algumas seções estão indisponíveis e podem mostrar dados
// vazios/desatualizados.
//
// O detalhe do erro fica no log estruturado (Vercel logs); a UI mostra
// só o nome amigável das seções afetadas. Sem stack trace, sem
// errorMessage cru — proteção contra vazar conteúdo de exception em
// produção (algumas exceptions carregam SQL ou nome de coluna).
export function AvisoFalhaParcial({
  secoesIndisponiveis,
}: {
  readonly secoesIndisponiveis: readonly string[];
}) {
  if (secoesIndisponiveis.length === 0) return null;

  const lista =
    secoesIndisponiveis.length === 1
      ? secoesIndisponiveis[0]
      : `${secoesIndisponiveis.slice(0, -1).join(', ')} e ${secoesIndisponiveis.at(-1)}`;

  return (
    <div className={styles.aviso} role="status">
      <span className={styles.icone} aria-hidden>!</span>
      <div className={styles.texto}>
        <strong>Algumas informações estão temporariamente indisponíveis.</strong>
        <span className={styles.detalhe}>
          Seções afetadas: {lista}. As ações principais continuam funcionando — atualize a
          página em alguns minutos.
        </span>
      </div>
    </div>
  );
}
