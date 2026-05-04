import Link from 'next/link';
import { LogoTE } from '@/app/_components/LogoTE';
import { loginAction } from '@/app/_lib/authActions';
import styles from './page.module.css';

type ErroKey = 'invalid' | 'config' | undefined;

const MENSAGEM_ERRO: Record<Exclude<ErroKey, undefined>, string> = {
  invalid: 'Senha incorreta. Tente novamente.',
  config: 'ADMIN_PASSWORD não está configurado no servidor. Contate o administrador do sistema.',
};

interface Props {
  searchParams: {
    from?: string;
    error?: string;
  };
}

export const dynamic = 'force-dynamic';

export default function LoginPage({ searchParams }: Props) {
  const erro = (searchParams.error as ErroKey) ?? undefined;
  const mensagem = erro && erro in MENSAGEM_ERRO ? MENSAGEM_ERRO[erro as keyof typeof MENSAGEM_ERRO] : null;

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <LogoTE tamanho="lg" />
        </div>

        <div className={styles.cabecalho}>
          <span className={styles.badge}>Acesso restrito</span>
          <h1>Área administrativa</h1>
          <p className={styles.subtitulo}>
            Restrito ao gestor. Para registrar operação do dia a dia, acesse a{' '}
            <Link href="/operacao" className={styles.linkOperacao}>
              tela operacional
            </Link>
            .
          </p>
        </div>

        <form action={loginAction} className={styles.form} noValidate>
          {searchParams.from && (
            <input type="hidden" name="from" value={searchParams.from} readOnly />
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
        A senha é gerenciada via variável de ambiente <code>ADMIN_PASSWORD</code>.
      </p>
    </main>
  );
}
