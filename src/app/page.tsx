import { redirect } from 'next/navigation';

// Raiz do sistema → redireciona para a central operacional em /operacao.
// Toda a operação (controle diário, lavanderia, imóveis, depósito, ajuste)
// é pública; admin tem seu próprio painel em /admin para cadastro e
// relatórios gerenciais.
export default function Root() {
  redirect('/operacao');
}
