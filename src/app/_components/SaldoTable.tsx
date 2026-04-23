import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import type { SaldoEntrada } from '@/application/services/SaldoService';
import styles from './Tables.module.css';

interface Props {
  itens: Item[];
  local: Local | null;
  saldos: SaldoEntrada[];
}

export function SaldoTable({ itens, local, saldos }: Props) {
  if (!local) {
    return <div className={styles.empty}>Nenhum depósito cadastrado.</div>;
  }

  // Inclui todos os itens ativos, mesmo com saldo zero, para o operador
  // enxergar o inventário completo. Itens abaixo do estoque mínimo recebem
  // um badge de alerta — útil operacionalmente já hoje e consumível por
  // relatórios administrativos no futuro.
  const linhas = itens
    .map((item) => {
      const entrada = saldos.find((s) => s.itemId === item.id);
      const quantidade = entrada?.quantidade ?? 0;
      const abaixoMinimo = item.estoqueMinimo != null && quantidade < item.estoqueMinimo;
      return {
        itemId: item.id,
        nome: item.nome,
        unidade: item.unidade,
        quantidade,
        estoqueMinimo: item.estoqueMinimo,
        abaixoMinimo,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  if (linhas.length === 0) {
    return <div className={styles.empty}>Sem itens cadastrados.</div>;
  }

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Item</th>
            <th className={styles.num}>Saldo em {local.nome}</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.itemId}>
              <td>{l.nome}</td>
              <td className={`${styles.num} ${l.quantidade === 0 ? styles.muted : ''}`}>
                {l.quantidade}
                {l.unidade && l.unidade !== 'un' ? ` ${l.unidade}` : ''}
                {l.abaixoMinimo && l.estoqueMinimo != null && (
                  <span className={styles.badgeAlerta} title={`Abaixo do mínimo (${l.estoqueMinimo})`}>
                    ↓ mín {l.estoqueMinimo}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
