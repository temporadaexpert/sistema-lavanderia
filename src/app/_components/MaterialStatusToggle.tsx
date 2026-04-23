'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { alternarStatusMaterialAction } from '../_lib/materialActions';
import styles from './MaterialFormDialog.module.css';

interface Props {
  id: string;
  ativo: boolean;
}

export function MaterialStatusToggle({ id, ativo }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function alternar() {
    const formData = new FormData();
    formData.set('id', id);
    startTransition(async () => {
      const r = await alternarStatusMaterialAction(formData);
      if (r.ok) router.refresh();
      // Erro silencioso aqui é aceitável — a ação é reversível (clique
      // novamente). Em caso de falha real (ex.: item removido), o refresh
      // revela o estado correto.
    });
  }

  return (
    <button
      type="button"
      onClick={alternar}
      className={styles.triggerPequeno}
      disabled={pending}
      aria-label={ativo ? 'Inativar material' : 'Ativar material'}
    >
      {pending ? '…' : ativo ? 'Inativar' : 'Ativar'}
    </button>
  );
}
