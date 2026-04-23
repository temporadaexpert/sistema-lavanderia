// Demonstração end-to-end: popula seed, roda o fluxo real de uma diária
// (entrada no depósito → saída p/ imóvel → retorno → envio p/ lavanderia →
// retorno da lavanderia com perda → ajuste registrando a perda) e imprime
// saldos e relatório de discrepâncias.
//
// Rodar: npm run demo

import { criarContainer } from '../src/infrastructure/container';
import { popularSeed, ITENS, LOCAIS } from '../src/mock/seed';

async function main() {
  const c = criarContainer();
  await popularSeed(c);

  const svc = c.movimentacaoService;
  const saldos = c.saldoService;

  // 1) Entrada de 100 toalhas de banho no depósito
  await svc.registrar({
    itemId: ITENS.toalhaBanho,
    quantidade: 100,
    tipo: 'entrada_deposito',
    origemId: null,
    destinoId: LOCAIS.depositoCentral,
    responsavel: 'Ana (recebimento)',
    observacao: 'NF 12345',
  });

  // 2) Saída: 20 toalhas para o imóvel 302
  await svc.registrar({
    itemId: ITENS.toalhaBanho,
    quantidade: 20,
    tipo: 'saida_imovel',
    origemId: LOCAIS.depositoCentral,
    destinoId: LOCAIS.imovel302,
    responsavel: 'Bruno (camareiro)',
  });

  // 3) Retorno de 20 toalhas sujas do imóvel 302 para o depósito
  await svc.registrar({
    itemId: ITENS.toalhaBanho,
    quantidade: 20,
    tipo: 'retorno_imovel',
    origemId: LOCAIS.imovel302,
    destinoId: LOCAIS.depositoCentral,
    responsavel: 'Bruno (camareiro)',
  });

  // 4) Envio de 20 toalhas para a lavanderia
  await svc.registrar({
    itemId: ITENS.toalhaBanho,
    quantidade: 20,
    tipo: 'envio_lavanderia',
    origemId: LOCAIS.depositoCentral,
    destinoId: LOCAIS.lavanderiaExterna,
    responsavel: 'Ana (recebimento)',
  });

  // 5) Retorno da lavanderia com apenas 18 — 2 não voltaram
  await svc.registrar({
    itemId: ITENS.toalhaBanho,
    quantidade: 18,
    tipo: 'retorno_lavanderia',
    origemId: LOCAIS.lavanderiaExterna,
    destinoId: LOCAIS.depositoCentral,
    responsavel: 'Ana (recebimento)',
    observacao: 'Conferido: 2 toalhas faltando',
  });

  // 6) Ajuste registrando a perda na lavanderia (tira do saldo da lavanderia)
  await svc.registrar({
    itemId: ITENS.toalhaBanho,
    quantidade: 2,
    tipo: 'ajuste',
    origemId: LOCAIS.lavanderiaExterna,
    destinoId: null,
    responsavel: 'Ana (supervisão)',
    observacao: 'Perda confirmada no ciclo — baixa de 2 toalhas',
  });

  console.log('\n=== SALDO DA TOALHA DE BANHO POR LOCAL ===');
  const porLocal = await saldos.saldoPorLocalDoItem(ITENS.toalhaBanho);
  console.table(porLocal);

  console.log('\n=== SALDO GLOBAL (todos os itens x todos os locais) ===');
  console.table(await saldos.saldoGlobal());

  console.log('\n=== DISCREPÂNCIA ENVIO x RETORNO DE LAVANDERIA ===');
  console.table(await saldos.discrepanciaLavanderia());

  console.log('\n=== DISCREPÂNCIA SAÍDA x RETORNO DE IMÓVEIS ===');
  console.table(await saldos.discrepanciaImoveis());

  console.log('\n=== LOG COMPLETO DE MOVIMENTAÇÕES ===');
  console.table(
    (await c.movimentacoes.listar()).map((m) => ({
      dataHora: m.dataHora,
      tipo: m.tipo,
      qtd: m.quantidade,
      origem: m.origemId ?? '—',
      destino: m.destinoId ?? '—',
      responsavel: m.responsavel,
    })),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
