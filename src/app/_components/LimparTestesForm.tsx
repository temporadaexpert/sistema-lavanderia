'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  limparDadosTesteAction,
  type ResultadoLimpeza,
} from '../_lib/adminOperacionalActions';
import styles from './LimparTestesForm.module.css';

const FRASE = 'LIMPAR TESTES';

interface Contagens {
  readonly movimentacoes: number;
  readonly lotes: number;
  readonly contatos: number;
  readonly controlesDiarios: number;
  readonly itens: number;
  readonly locais: number;
}

export function LimparTestesForm({ contagens }: { contagens: Contagens }) {
  const router = useRouter();
  const [texto, setTexto] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<ResultadoLimpeza | null>(null);

  async function aoSubmeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (texto.trim() !== FRASE) return;
    const formData = new FormData(e.currentTarget);
    setLoading(true);
    setResultado(null);
    try {
      const r = await limparDadosTesteAction(formData);
      setResultado(r);
      if (r.ok) {
        setTexto('');
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  const bloqueado =
    contagens.movimentacoes === 0 &&
    contagens.lotes === 0 &&
    contagens.contatos === 0 &&
    contagens.controlesDiarios === 0;

  return (
    <form onSubmit={aoSubmeter} className={styles.form}>
      <div className={styles.contagens}>
        <Contagem label="Movimentações" valor={contagens.movimentacoes} />
        <Contagem label="Lotes de lavanderia" valor={contagens.lotes} />
        <Contagem label="Contatos/cobranças" valor={contagens.contatos} />
        <Contagem label="Controles diários" valor={contagens.controlesDiarios} />
      </div>

      <div className={styles.preservados}>
        <strong>Preservados:</strong> {contagens.itens} material(is) · {contagens.locais}{' '}
        local(is) · senha admin · configurações.
      </div>

      {bloqueado && !resultado?.ok && (
        <div className={styles.vazio}>
          Base já está vazia — nada a limpar.
        </div>
      )}

      <label className={styles.campo}>
        <span className={styles.label}>
          Para confirmar, digite exatamente <code>{FRASE}</code>:
        </span>
        <input
          name="confirmacao"
          type="text"
          className={styles.input}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={FRASE}
          autoComplete="off"
          spellCheck={false}
          disabled={bloqueado || loading}
        />
      </label>

      {resultado && !resultado.ok && (
        <div className={styles.erro} role="alert">
          {resultado.stepFalhou && (
            <div className={styles.erroStep}>
              Falhou no step: <strong>{resultado.stepFalhou}</strong>
            </div>
          )}
          {resultado.error}
        </div>
      )}
      {resultado?.ok && resultado.removidos && (
        <div className={styles.sucesso} role="status">
          <strong>Base zerada.</strong> Removidas {resultado.removidos.movimentacoes}{' '}
          movimentação(ões), {resultado.removidos.lotes} lote(s),{' '}
          {resultado.removidos.contatos} contato(s),{' '}
          {resultado.removidos.controlesDiarios} controle(s) diário(s).
          {resultado.preservados && (
            <>
              {' '}Preservados {resultado.preservados.itens} material(is) e{' '}
              {resultado.preservados.locais} local(is).
            </>
          )}
        </div>
      )}

      <button
        type="submit"
        className={styles.botao}
        disabled={loading || bloqueado || texto.trim() !== FRASE}
      >
        {loading ? 'Limpando…' : 'Limpar dados operacionais de teste'}
      </button>
    </form>
  );
}

function Contagem({ label, valor }: { label: string; valor: number }) {
  return (
    <div className={styles.contagem}>
      <div className={styles.contagemLabel}>{label}</div>
      <div className={styles.contagemValor}>{valor}</div>
    </div>
  );
}
