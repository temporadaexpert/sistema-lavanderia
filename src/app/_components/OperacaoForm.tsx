'use client';

import { useState } from 'react';
import type { Item } from '@/domain/entities/Item';
import type { Local } from '@/domain/entities/Local';
import type { LoteResumo } from '@/application/services/LoteLavanderiaService';
import { ACAO_CONFIG, ACOES, type AcaoOperacional } from '../_lib/acoes';
import { FormGenerico } from './FormGenerico';
import { FormEnviarLavanderia } from './FormEnviarLavanderia';
import { FormReceberLavanderia, type PendenciaLinha } from './FormReceberLavanderia';
import styles from './OperacaoForm.module.css';

interface Props {
  itens: Item[];
  locais: Local[];
  lotesAbertos: LoteResumo[];
  pendenciasPorLote: Record<string, readonly PendenciaLinha[]>;
}

// Wrapper: expõe o picker de ação e delega o formulário para o subcomponente
// apropriado. Lavanderia (enviar/receber) tem UX específica de lote;
// outras ações compartilham o form genérico herdado da etapa anterior.
export function OperacaoForm({ itens, locais, lotesAbertos, pendenciasPorLote }: Props) {
  const [acao, setAcao] = useState<AcaoOperacional>('enviar_imovel');
  const cfg = ACAO_CONFIG[acao];

  const depositos = locais.filter((l) => l.tipo === 'deposito');
  const lavanderias = locais.filter((l) => l.tipo === 'lavanderia');

  return (
    <div className={styles.container}>
      <div className={styles.picker} role="radiogroup" aria-label="Tipo de operação">
        {ACOES.map((a) => {
          const ativo = a === acao;
          return (
            <button
              key={a}
              type="button"
              className={`${styles.pickerItem} ${ativo ? styles.pickerItemAtivo : ''}`}
              onClick={() => setAcao(a)}
              role="radio"
              aria-checked={ativo}
            >
              {ACAO_CONFIG[a].label}
            </button>
          );
        })}
      </div>

      <p className={styles.descricao}>{cfg.descricao}</p>

      {acao === 'enviar_lavanderia' ? (
        <FormEnviarLavanderia itens={itens} depositos={depositos} lavanderias={lavanderias} />
      ) : acao === 'receber_lavanderia' ? (
        <FormReceberLavanderia lotesAbertos={lotesAbertos} pendenciasPorLote={pendenciasPorLote} />
      ) : (
        <FormGenerico acao={acao} itens={itens} locais={locais} />
      )}
    </div>
  );
}
