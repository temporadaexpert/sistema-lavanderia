import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import {
  itemToalha,
  semearBasico,
  TEST_ITENS,
  TEST_LOCAIS,
} from '@/testing/testSeed';
import { MovimentacaoId } from '@/domain/types/ids';

describe('RelatorioLavanderiaService', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 200,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.semPreco,
      quantidade: 50,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
  });

  it('calcula custo usando snapshot (qtd × preço capturado)', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 10,
      tipo: 'envio_lavanderia',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
    });
    const resumo = await c.relatorioLavanderia.resumo();
    expect(resumo.totalEnviado).toBe(10);
    expect(resumo.custoEnviado).toBe(300); // 10 × 30
    expect(resumo.custoParcial).toBe(false);
  });

  it('preserva custo histórico mesmo após reajuste do cadastro', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 10,
      tipo: 'envio_lavanderia',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
    });
    // reajusta preço de 30 para 100
    await c.itens.atualizar({ ...itemToalha(), valorUnitario: 100 });

    const resumo = await c.relatorioLavanderia.resumo();
    // Continua com preço histórico congelado
    expect(resumo.custoEnviado).toBe(300);
  });

  it('usa fallback (valorUnitario atual) quando mov não tem snapshot', async () => {
    // Simula mov legada sem snapshot injetando direto no repositório
    const agora = c.clock.agoraISO();
    await c.movimentacoes.registrar({
      id: MovimentacaoId('mov-legada'),
      dataHora: agora,
      itemId: TEST_ITENS.toalha,
      quantidade: 10,
      tipo: 'envio_lavanderia',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      observacao: null,
      loteId: null,
      precoUnitarioSnapshot: null, // sem snapshot
      registradoEm: agora,
      cancelada: false,
      canceladoEm: null,
      canceladoPor: null,
      motivoCancelamento: null,
      conciliado: true,
    });
    const resumo = await c.relatorioLavanderia.resumo();
    // Fallback para preço atual = 30. Custo = 300.
    expect(resumo.custoEnviado).toBe(300);
    expect(resumo.custoParcial).toBe(false);
  });

  it('marca custoParcial quando item sem preço movimenta', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.semPreco,
      quantidade: 10,
      tipo: 'envio_lavanderia',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
    });
    const resumo = await c.relatorioLavanderia.resumo();
    expect(resumo.totalEnviado).toBe(10);
    expect(resumo.custoEnviado).toBe(0);
    expect(resumo.custoParcial).toBe(true);
    expect(resumo.itensSemValorUnitario).toBe(1);
  });

  it('calcula diferencaCusto entre envio e retorno usando snapshots', async () => {
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
    const resumo = await c.relatorioLavanderia.resumo();
    // enviado 20 × 30 = 600; retornado 18 × 30 = 540; diferença = 60
    expect(resumo.custoEnviado).toBe(600);
    expect(resumo.custoRetornado).toBe(540);
    expect(resumo.diferencaCusto).toBe(60);
  });

  it('resumoMensal agrupa por YYYY-MM correto', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 10,
      tipo: 'envio_lavanderia',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      dataHora: '2026-01-15T10:00:00.000Z',
    });
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 20,
      tipo: 'envio_lavanderia',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      dataHora: '2026-02-15T10:00:00.000Z',
    });
    const mensal = await c.relatorioLavanderia.resumoMensal();
    expect(mensal).toHaveLength(2);
    expect(mensal.find((m) => m.mes === '2026-01')?.custoEnviado).toBe(300);
    expect(mensal.find((m) => m.mes === '2026-02')?.custoEnviado).toBe(600);
  });

  it('respeita filtro de período desde/ate', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 10,
      tipo: 'envio_lavanderia',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      dataHora: '2026-01-15T10:00:00.000Z',
    });
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 20,
      tipo: 'envio_lavanderia',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      dataHora: '2026-02-15T10:00:00.000Z',
    });
    const resumoFev = await c.relatorioLavanderia.resumo({
      desde: '2026-02-01T00:00:00.000Z',
      ate: '2026-02-28T23:59:59.000Z',
    });
    expect(resumoFev.totalEnviado).toBe(20);
    expect(resumoFev.custoEnviado).toBe(600);
  });
});
