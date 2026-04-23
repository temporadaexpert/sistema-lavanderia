import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { MovimentacaoTipo } from '@/domain/types/enums';
import styles from './Tables.module.css';

const LABEL_TIPO: Record<MovimentacaoTipo, string> = {
  entrada_deposito: 'Entrada depósito',
  saida_imovel: 'Saída imóvel',
  retorno_imovel: 'Retorno imóvel',
  envio_lavanderia: 'Envio lavanderia',
  retorno_lavanderia: 'Retorno lavanderia',
  ajuste: 'Ajuste',
};

const fmtData = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

interface Props {
  itens: Item[];
  locais: Local[];
  movimentacoes: Movimentacao[];
}

export function HistoricoTable({ itens, locais, movimentacoes }: Props) {
  if (movimentacoes.length === 0) {
    return <div className={styles.empty}>Nenhuma movimentação registrada ainda.</div>;
  }

  const nomeItem = new Map(itens.map((i) => [i.id, i.nome]));
  const nomeLocal = new Map(locais.map((l) => [l.id, l.nome]));

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Data/hora</th>
            <th>Tipo</th>
            <th>Item</th>
            <th className={styles.num}>Qtd</th>
            <th>Origem</th>
            <th>Destino</th>
            <th>Responsável</th>
          </tr>
        </thead>
        <tbody>
          {movimentacoes.map((m) => (
            <tr key={m.id}>
              <td>{fmtData.format(new Date(m.dataHora))}</td>
              <td>{LABEL_TIPO[m.tipo]}</td>
              <td>{nomeItem.get(m.itemId) ?? m.itemId}</td>
              <td className={styles.num}>{m.quantidade}</td>
              <td>{m.origemId ? (nomeLocal.get(m.origemId) ?? m.origemId) : <span className={styles.muted}>—</span>}</td>
              <td>{m.destinoId ? (nomeLocal.get(m.destinoId) ?? m.destinoId) : <span className={styles.muted}>—</span>}</td>
              <td>{m.responsavel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
