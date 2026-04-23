import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import {
  itemToalha,
  semearBasico,
  TEST_ITENS,
  TEST_LOCAIS,
} from '@/testing/testSeed';

describe('RelatorioPerdaService', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
    // Estoque base para permitir envios
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 200,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.fronha,
      quantidade: 200,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
  });

  it('resumo vazio quando não há lote encerrado', async () => {
    await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    const resumo = await c.relatorioPerda.resumo();
    expect(resumo.totalPecas).toBe(0);
    expect(resumo.lotesEncerrados).toBe(0);
  });

  it('ignora ajustes manuais sem loteId', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 5,
      tipo: 'ajuste',
      origemId: TEST_LOCAIS.deposito,
      destinoId: null,
      responsavel: 'T',
    });
    const resumo = await c.relatorioPerda.resumo();
    expect(resumo.totalPecas).toBe(0);
  });

  it('conta apenas baixas de lotes encerrados, com valor via snapshot', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    await c.loteLavanderia.registrarRetorno({
      loteId: lote.id,
      responsavel: 'T',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 8 }],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: lote.id,
      motivo: 'perda_confirmada',
      responsavel: 'Gestor',
    });
    const resumo = await c.relatorioPerda.resumo();
    expect(resumo.totalPecas).toBe(2);
    expect(resumo.valorEstimado).toBe(60); // 2 × 30
    expect(resumo.lotesEncerrados).toBe(1);
    expect(resumo.motivoMaisFrequente?.motivo).toBe('perda_confirmada');
    expect(resumo.itemMaiorPerda?.itemId).toBe(TEST_ITENS.toalha);
    expect(resumo.custoParcial).toBe(false);
  });

  it('preserva valor histórico mesmo após reajuste do cadastro', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: lote.id,
      motivo: 'perda_confirmada',
      responsavel: 'G',
    });
    // reajusta preço para valor muito maior
    await c.itens.atualizar({ ...itemToalha(), valorUnitario: 999 });

    const resumo = await c.relatorioPerda.resumo();
    // Valor congelado no snapshot da baixa: 5 × 30 = 150
    expect(resumo.valorEstimado).toBe(150);
  });

  it('marca custoParcial quando item sem preço foi baixado', async () => {
    // Coloca o item sem preço em estoque (necessário para o envio)
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.semPreco,
      quantidade: 50,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      itens: [{ itemId: TEST_ITENS.semPreco, quantidade: 5 }],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: lote.id,
      motivo: 'perda_confirmada',
      responsavel: 'G',
    });
    const resumo = await c.relatorioPerda.resumo();
    expect(resumo.totalPecas).toBe(5);
    expect(resumo.valorEstimado).toBe(0);
    expect(resumo.custoParcial).toBe(true);
    expect(resumo.itensSemValorUnitario).toBe(1);
  });

  it('agrupa corretamente por motivo', async () => {
    const l1 = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: l1.id,
      motivo: 'perda_confirmada',
      responsavel: 'G',
    });
    const l2 = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      itens: [{ itemId: TEST_ITENS.fronha, quantidade: 5 }],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: l2.id,
      motivo: 'danificado',
      responsavel: 'G',
    });

    const porMotivo = await c.relatorioPerda.porMotivo();
    const perda = porMotivo.find((p) => p.motivo === 'perda_confirmada');
    const dan = porMotivo.find((p) => p.motivo === 'danificado');
    expect(perda?.pecas).toBe(10);
    expect(perda?.valor).toBe(300);
    expect(perda?.lotesAfetados).toBe(1);
    expect(dan?.pecas).toBe(5);
    expect(dan?.valor).toBe(75);
  });

  it('agrupa corretamente por item (soma de peças e valor)', async () => {
    const l1 = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: l1.id,
      motivo: 'perda_confirmada',
      responsavel: 'G',
    });
    const l2 = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 3 }],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: l2.id,
      motivo: 'extravio',
      responsavel: 'G',
    });

    const porItem = await c.relatorioPerda.porItem();
    const toalha = porItem.find((p) => p.itemId === TEST_ITENS.toalha);
    expect(toalha?.pecas).toBe(8);
    expect(toalha?.valor).toBe(240);
    expect(toalha?.lotesAfetados).toBe(2);
  });

  it('agrupa corretamente por lote (cada lote vira uma linha)', async () => {
    const l1 = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      itens: [
        { itemId: TEST_ITENS.toalha, quantidade: 5 },
        { itemId: TEST_ITENS.fronha, quantidade: 3 },
      ],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: l1.id,
      motivo: 'perda_confirmada',
      responsavel: 'G',
    });
    const porLote = await c.relatorioPerda.porLote();
    expect(porLote).toHaveLength(1);
    expect(porLote[0]?.pecas).toBe(8); // 5 + 3
    expect(porLote[0]?.valor).toBe(195); // 5×30 + 3×15
    expect(porLote[0]?.itensDistintos).toBe(2);
  });

  it('agrupa por mês de encerramento (YYYY-MM de encerradoEm)', async () => {
    c.clock.set('2026-01-15T10:00:00.000Z');
    const l1 = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: l1.id,
      motivo: 'perda_confirmada',
      responsavel: 'G',
    });

    c.clock.set('2026-02-15T10:00:00.000Z');
    const l2 = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'T',
      itens: [{ itemId: TEST_ITENS.fronha, quantidade: 3 }],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: l2.id,
      motivo: 'danificado',
      responsavel: 'G',
    });

    const mensal = await c.relatorioPerda.mensal();
    expect(mensal).toHaveLength(2);
    expect(mensal.find((m) => m.mes === '2026-01')?.pecas).toBe(5);
    expect(mensal.find((m) => m.mes === '2026-02')?.pecas).toBe(3);
  });
});
