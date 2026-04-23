'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { alternarStatusLocalAction } from '../_lib/localActions';
import styles from './LocalFormDialog.module.css';

interface Props {
  id: string;
  ativo: boolean;
}

export function LocalStatusToggle({ id, ativo }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function alternar() {
    const formData = new FormData();
    formData.set('id', id);
    startTransition(async () => {
      const r = await alternarStatusLocalAction(formData);
      if (r.ok) router.refresh();
      // Falha silenciosa: ação reversível. Refresh mostrará estado real
      // se algo mudar entre clique e resposta.
    });
  }

  return (
    <button
      type="button"
      onClick={alternar}
      className={styles.triggerPequeno}
      disabled={pending}
      aria-label={ativo ? 'Inativar local' : 'Ativar local'}
    >
      {pending ? '…' : ativo ? 'Inativar' : 'Ativar'}
    </button>
  );
}
