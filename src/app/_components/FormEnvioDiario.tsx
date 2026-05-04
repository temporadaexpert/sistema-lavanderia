'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ContadorItem } from './ContadorItem';
import { salvarEnvioDiarioAction } from '../_lib/controleDiarioActions';
import type { AcaoResultado } from '../_lib/actions';
import styles from './FormEnvioDiario.module.css';

interface ItemOpcao {
  readonly id: string;
  readonly nome: string;
  readonly categoria: string;
}

interface Props {
  readonly dataHoje: string;
  readonly itens: readonly ItemOpcao[];
  readonly valoresIniciais: ReadonlyMap<string, number>;
  readonly responsavelInicial: string | null;
}

export function FormEnvioDiario({
  dataHoje,
  itens,
  valoresIniciais,
  responsavelInicial,
}: Props) {
  const router = useRouter();
  const [data, setData] = useState(dataHoje);
  const [responsavel, setResponsavel] = useState(responsavelInicial ?? '');
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<AcaoResultado | null>(null);

  async function aoSubmeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setLoading(true);
    setResultado(null);
    try {
      const r = await salvarEnvioDiarioAction(formData);
      setResultado(r);
      if (r.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={aoSubmeter} className={styles.form}>
      <div className={styles.cabecalho}>
        <label className={styles.campo}>
          <span className={styles.label}>Data</span>
          <input
            type="date"
            name="data"
            value={data}
            onChange={(e) => setData(e.target.value)}
            required
            className={styles.input}
          />
        </label>
        <label className={styles.campo}>
          <span className={styles.label}>Responsável</span>
          <input
            type="text"
            name="responsavel"
            value={responsavel}
            onChange={(e) => setResponsavel(e.target.value)}
            required
            maxLength={120}
            autoComplete="off"
            className={styles.input}
          />
        </label>
      </div>

      <div className={styles.listaTitulo}>
        <p className={styles.listaTituloTexto}>Materiais</p>
        <span className={styles.listaContador}>{itens.length} item(ns)</span>
      </div>

      <ul className={styles.lista}>
        {itens.map((item) => (
          <li key={item.id} className={styles.linha}>
            <div className={styles.info}>
              <div className={styles.nome}>{item.nome}</div>
              <div className={styles.categoria}>{item.categoria}</div>
            </div>
            <ContadorItem
              inputName={`qtd[${item.id}]`}
              valorInicial={valoresIniciais.get(item.id) ?? 0}
            />
          </li>
        ))}
      </ul>

      {resultado && !resultado.ok && (
        <div className={styles.erro} role="alert">
          <span aria-hidden>⚠</span>
          <span>{resultado.error}</span>
        </div>
      )}
      {resultado?.ok && resultado.mensagem && (
        <div className={styles.sucesso} role="status">
          <span aria-hidden>✓</span>
          <span>{resultado.mensagem}</span>
        </div>
      )}

      <div className={styles.acoes}>
        <button type="submit" className={styles.botaoSalvar} disabled={loading}>
          {loading ? 'Salvando…' : 'Salvar envio do dia'}
        </button>
      </div>
    </form>
  );
}
