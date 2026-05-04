import type { DisponibilidadeItem } from '@/application/services/SaldoService';
import styles from './Tables.module.css';

interface Props {
  readonly linhas: readonly DisponibilidadeItem[];
}

// Tabela de disponibilidade (novo modelo: estoqueTotal definido pelo admin,
// o sistema distribui em "em uso", "em lavanderia" e "disponível"). Mostra
// um selo "sem total" quando o admin ainda não definiu — linha segue útil
// como visão dos buckets. Mantém destaque vermelho para linhas abaixo do
// estoque mínimo ou com disponível negativo.
export function DisponibilidadeTable({ linhas }: Props) {
  if (linhas.length === 0) {
    return <div className={styles.empty}>Sem materiais cadastrados.</div>;
  }

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Material</th>
            <th className={styles.num}>Total</th>
            <th className={styles.num}>Em uso</th>
            <th className={styles.num}>Lavanderia</th>
            <th className={styles.num}>Disponível</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const destaqueDisp = l.alertaNegativo
              ? styles.alerta
              : l.abaixoMinimo
                ? styles.abaixoMinimo
                : '';
            return (
              <tr key={l.itemId}>
                <td>{l.nomeItem}</td>
                <td className={styles.num}>
                  {l.estoqueTotal == null ? (
                    <span className={styles.muted}>—</span>
                  ) : (
                    l.estoqueTotal
                  )}
                </td>
                <td className={styles.num}>{l.emImoveis}</td>
                <td className={styles.num}>{l.emLavanderia}</td>
                <td className={`${styles.num} ${destaqueDisp}`}>
                  {l.estoqueTotal == null ? (
                    <span className={styles.muted}>sem total</span>
                  ) : (
                    <>
                      {l.disponivelEfetivo}
                      {l.alertaNegativo && (
                        <span className={styles.badgeAlerta} title="Total menor que em uso + lavanderia">
                          ⚠
                        </span>
                      )}
                      {!l.alertaNegativo && l.abaixoMinimo && l.estoqueMinimo != null && (
                        <span className={styles.badgeAlerta} title={`Abaixo do mínimo (${l.estoqueMinimo})`}>
                          ↓ mín {l.estoqueMinimo}
                        </span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
