import { LogoTE } from '@/app/_components/LogoTE';
import { loginOperadorAction } from '@/app/_lib/operadorAuthActions';
import styles from './page.module.css';

type ErroKey = 'invalid' | 'config' | undefined;

const MENSAGEM_ERRO: Record<Exclude<ErroKey, undefined>, string> = {
  invalid: 'Senha incorreta. Tente novamente.',
  config:
    'OPERADOR_PASSWORD não está configurado no servidor. Avise o gestor.',
};

interface Props {
  searchParams: {
    from?: string;
    error?: string;
  };
}

export const dynamic = 'force-dynamic';

// Login do operador. Página é PÚBLICA — middleware exclui /operacao/login
// do gate. Form post → loginOperadorAction → cookie httpOnly + redirect
// pro `from` (se válido) ou /operacao.
//
// Mobile-first: card centralizado, input grande, botão de toque (44px+),
// teclado de senha auto-aberto via type="password" + autoFocus.
export default function LoginOperadorPage({ searchParams }: Props) {
  const erro = (searchParams.error as ErroKey) ?? undefined;
  const mensagem =
    erro && erro in MENSAGEM_ERRO
      ? MENSAGEM_ERRO[erro as keyof typeof MENSAGEM_ERRO]
      : null;

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <LogoTE tamanho="lg" />
        </div>

        <div className={styles.cabecalho}>
          <span className={styles.badge}>Operação</span>
          <h1>Entrar</h1>
          <p className={styles.subtitulo}>
            Digite a senha de operador para registrar movimentações do dia.
          </p>
        </div>

        <form action={loginOperadorAction} className={styles.form} noValidate>
          {searchParams.from && (
            <input
              type="hidden"
              name="from"
              value={searchParams.from}
              readOnly
            />
          )}

          <div className={styles.field}>
            <label htmlFor="senha" className={styles.label}>
              Senha
            </label>
            <input
              id="senha"
              name="senha"
              type="password"
              className={styles.input}
              required
              autoFocus
              autoComplete="current-password"
              inputMode="text"
            />
          </div>

          {mensagem && (
            <div className={styles.erro} role="status" aria-live="polite">
              {mensagem}
            </div>
          )}

          <button type="submit" className={styles.botao}>
            Entrar
          </button>
        </form>
      </div>

      <p className={styles.rodape}>
        Senha gerenciada via <code>OPERADOR_PASSWORD</code>.
      </p>
    </main>
  );
}
