import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';

describe('SaldoService', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 100,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
  });

  it('saldoDe soma destino e subtrai origem', async () => {
    const saldoInicial = await c.saldoService.saldoDe(TEST_ITENS.toalha, TEST_LOCAIS.deposito);
    expect(saldoInicial).toBe(100);

    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 30,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'T',
    });

    expect(await c.saldoService.saldoDe(TEST_ITENS.toalha, TEST_LOCAIS.deposito)).toBe(70);
    expect(await c.saldoService.saldoDe(TEST_ITENS.toalha, TEST_LOCAIS.imovel)).toBe(30);
  });

  it('saldoPorItemNoLocal retorna todos os itens com saldo no local', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.fronha,
      quantidade: 50,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'T',
    });
    const saldos = await c.saldoService.saldoPorItemNoLocal(TEST_LOCAIS.deposito);
    expect(saldos).toHaveLength(2);
    expect(saldos.find((s) => s.itemId === TEST_ITENS.toalha)?.quantidade).toBe(100);
    expect(saldos.find((s) => s.itemId === TEST_ITENS.fronha)?.quantidade).toBe(50);
  });

  it('saldoPorLocalDoItem retorna locais onde o item tem saldo não-zero', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 30,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'T',
    });
    const saldos = await c.saldoService.saldoPorLocalDoItem(TEST_ITENS.toalha);
    expect(saldos.find((s) => s.localId === TEST_LOCAIS.deposito)?.quantidade).toBe(70);
    expect(saldos.find((s) => s.localId === TEST_LOCAIS.imovel)?.quantidade).toBe(30);
    // Lavanderia não deve aparecer (sem movimentação)
    expect(saldos.find((s) => s.localId === TEST_LOCAIS.lavanderia)).toBeUndefined();
  });

  it('filtra corretamente por ateDataHora (saldo "histórico")', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 30,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'T',
      dataHora: '2026-02-01T10:00:00.000Z',
    });
    // Saldo antes da saída: 100 (seed foi em 2026-01-01)
    const antes = await c.saldoService.saldoDe(
      TEST_ITENS.toalha,
      TEST_LOCAIS.deposito,
      '2026-01-15T00:00:00.000Z',
    );
    expect(antes).toBe(100);
    // Saldo atual: 70
    const agora = await c.saldoService.saldoDe(TEST_ITENS.toalha, TEST_LOCAIS.deposito);
    expect(agora).toBe(70);
  });

  it('discrepanciaLavanderia calcula enviado − retornado por item', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 20,
      tipo: 'envio_lavanderia',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
    });
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 18,
      tipo: 'retorno_lavanderia',
      origemId: TEST_LOCAIS.lavanderia,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'T',
    });
    const discr = await c.saldoService.discrepanciaLavanderia();
    const toalha = discr.find((d) => d.itemId === TEST_ITENS.toalha);
    expect(toalha?.totalEnviado).toBe(20);
    expect(toalha?.totalRetornado).toBe(18);
    expect(toalha?.diferenca).toBe(2);
  });

  it('saldoGlobal devolve todas as combinações item × local com saldo ≠ 0', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 30,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'T',
    });
    const global = await c.saldoService.saldoGlobal();
    expect(global).toHaveLength(2);
    const soma = global.reduce((s, e) => s + e.quantidade, 0);
    expect(soma).toBe(100); // total conservado: 70 depósito + 30 imóvel
  });
});
