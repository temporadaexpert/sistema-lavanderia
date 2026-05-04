import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type { MovimentacaoTipo } from '@/domain/types/enums';
import { CancelarMovimentacaoDialog } from './CancelarMovimentacaoDialog';
import styles from './Tables.module.css';

const LABEL_TIPO: Record<MovimentacaoTipo, string> = {
  entrada_deposito: 'Entrada depósito',
  saida_imovel: 'Saída imóvel',
  retorno_imovel: 'Retorno imóvel',
  envio_lavanderia: 'Envio lavanderia',
  retorno_lavanderia: 'Retorno lavanderia',
  ajuste: 'Ajuste',
};

// Tipos que a action aceita cancelar — mantém em sincronia com o service.
// Se o tipo não for cancelável OU a movimentação for de lote, o botão some.
const TIPOS_CANCELAVEIS: ReadonlySet<MovimentacaoTipo> = new Set([
  'entrada_deposito',
  'saida_imovel',
  'retorno_imovel',
  'ajuste',
]);

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
  permitirCancelar?: boolean;
}

export function HistoricoTable({
  itens,
  locais,
  movimentacoes,
  permitirCancelar = true,
}: Props) {
  if (movimentacoes.length === 0) {
    return <div className={styles.empty}>Nenhuma movimentação registrada ainda.</div>;
  }

  const nomeItem = new Map(itens.map((i) => [i.id, i.nome]));
  const nomeLocal = new Map(locais.map((l) => [l.id, l.nome]));

  function descricao(m: Movimentacao): string {
    const partes: string[] = [
      LABEL_TIPO[m.tipo],
      `${m.quantidade}× ${nomeItem.get(m.itemId) ?? m.itemId}`,
    ];
    if (m.origemId) partes.push(`origem ${nomeLocal.get(m.origemId) ?? m.origemId}`);
    if (m.destinoId) partes.push(`destino ${nomeLocal.get(m.destinoId) ?? m.destinoId}`);
    partes.push(fmtData.format(new Date(m.dataHora)));
    return partes.join(' · ');
  }

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
            {permitirCancelar && <th></th>}
          </tr>
        </thead>
        <tbody>
          {movimentacoes.map((m) => {
            const podeMostrarBotao =
              permitirCancelar &&
              !m.cancelada &&
              !m.loteId &&
              TIPOS_CANCELAVEIS.has(m.tipo);
            return (
              <tr key={m.id} className={m.cancelada ? styles.rowCancelada : undefined}>
                <td>
                  {fmtData.format(new Date(m.dataHora))}
                  {m.cancelada && (
                    <span
                      className={styles.badgeCancelado}
                      title={`Cancelado ${m.canceladoEm ? fmtData.format(new Date(m.canceladoEm)) : ''}${m.canceladoPor ? ` por ${m.canceladoPor}` : ''}${m.motivoCancelamento ? ` — ${m.motivoCancelamento}` : ''}`}
                    >
                      Cancelado
                    </span>
                  )}
                </td>
                <td>{LABEL_TIPO[m.tipo]}</td>
                <td>{nomeItem.get(m.itemId) ?? m.itemId}</td>
                <td className={styles.num}>{m.quantidade}</td>
                <td>
                  {m.origemId ? (
                    (nomeLocal.get(m.origemId) ?? m.origemId)
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td>
                  {m.destinoId ? (
                    (nomeLocal.get(m.destinoId) ?? m.destinoId)
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </td>
                <td>{m.responsavel}</td>
                {permitirCancelar && (
                  <td>
                    {podeMostrarBotao && (
                      <CancelarMovimentacaoDialog
                        movimentacaoId={m.id}
                        descricao={descricao(m)}
                      />
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
