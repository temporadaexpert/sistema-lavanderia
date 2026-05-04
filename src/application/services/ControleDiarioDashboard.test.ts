import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';
import { DashboardAdminService } from './DashboardAdminService';

// Garante que o controle diário da funcionária:
//   1. é persistido em controles-diarios (source of truth separado)
//   2. aparece nos endpoints de dashboard admin (resumoDashboard,
//      obterPorData, calcularDivergencia, listarDivergencias)
//   3. NÃO infla métricas de lavanderia/impostômetro
describe('Integração: controle diário da funcionária ↔ admin', () => {
  let c: ContainerDeTeste;
  let dashboard: DashboardAdminService;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
    dashboard = new DashboardAdminService(
      c.itens,
      c.locais,
      c.movimentacoes,
      c.lotes,
      c.saldoService,
      c.loteLavanderia,
      c.relatorioLavanderia,
      c.relatorioPerda,
    );
  });

  it('envio do dia aparece no resumo do admin', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [
        { itemId: TEST_ITENS.toalha, quantidade: 30 },
        { itemId: TEST_ITENS.fronha, quantidade: 20 },
      ],
    });

    const resumo = await c.controleDiario.resumoDashboard();
    expect(resumo).not.toBeNull();
    expect(resumo!.dataReferencia).toBe('2026-04-15');
    expect(resumo!.temControleHoje).toBe(true);
    expect(resumo!.totalEnviado).toBe(50);
    expect(resumo!.totalRetornado).toBe(0);

    // admin também lê responsabilidade no detalhe do dia
    const detalhe = await c.controleDiario.obterPorData('2026-04-15');
    expect(detalhe?.responsavelEnvio).toBe('Ana');
  });

  it('retorno do dia reflete no admin e detecta divergência', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });
    c.clock.set('2026-04-15T18:00:00.000Z');
    await c.controleDiario.registrarRetorno({
      data: '2026-04-15',
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 20, recebidoLimpo: 5 }],
    });

    const resumo = await c.controleDiario.resumoDashboard();
    expect(resumo!.totalEnviado).toBe(30);
    expect(resumo!.totalRetornado).toBe(25);
    expect(resumo!.totalLimpoReaproveitado).toBe(5);
    expect(resumo!.totalFaltante).toBe(5);
    expect(resumo!.temDivergenciaHoje).toBe(true);

    const diverg = await c.controleDiario.calcularDivergencia('2026-04-15');
    expect(diverg?.temDivergencia).toBe(true);
    expect(diverg?.linhas[0]?.classe).toBe('faltando');
    expect(diverg?.linhas[0]?.divergencia).toBe(5);

    const detalhe = await c.controleDiario.obterPorData('2026-04-15');
    expect(detalhe?.responsavelRetorno).toBe('Bruno');
  });

  it('fechamento com divergência grava motivo e responsável para auditoria', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    c.clock.set('2026-04-15T20:00:00.000Z');
    await c.controleDiario.registrarRetorno({
      data: '2026-04-15',
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 7, recebidoLimpo: 0 }],
      fecharDia: true,
      motivoDivergencia: '3 toalhas esquecidas no imóvel 302',
      responsavelFechamento: 'Gestor',
    });

    // Listagem admin de divergências diárias inclui o dia fechado
    const lista = await c.controleDiario.listarDivergencias();
    expect(lista).toHaveLength(1);
    expect(lista[0]?.data).toBe('2026-04-15');
    expect(lista[0]?.status).toBe('fechado_com_divergencia');
    expect(lista[0]?.motivoDivergencia).toBe('3 toalhas esquecidas no imóvel 302');
    expect(lista[0]?.responsavelFechamento).toBe('Gestor');
    expect(lista[0]?.totalFaltante).toBe(3);
    expect(lista[0]?.valorEstimado).toBe(90); // 3 × 30 (preço toalha no testSeed)
  });

  it('controle diário NÃO infla valor/peças de lavanderia no dashboard', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
    // Funcionária registra envio/retorno do dia (NÃO é envio pra
    // lavanderia — é só o fluxo de contagem do depósito).
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 100 }],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-15',
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 80, recebidoLimpo: 20 }],
    });

    // Dashboard admin (impostômetro) não deve ser afetado
    const snap = await dashboard.snapshot(new Date('2026-04-15T21:00:00.000Z'));
    expect(snap.lavanderia.pecasHoje).toBe(0);
    expect(snap.lavanderia.pecasMes).toBe(0);
    expect(snap.lavanderia.valorHoje).toBe(0);
    expect(snap.lavanderia.valorMes).toBe(0);
    // Últimas movimentações também não: controle diário é outro log
    expect(snap.ultimasMovimentacoes).toHaveLength(0);
  });

  it('apenas envio de lote real (LoteLavanderiaService.criarEnvio) infla lavanderia', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
    // Controle diário do operador
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 50 }],
    });
    // ...mas só 20 do sujo efetivamente vira envio pra lavanderia real
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 200,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
    await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      dataEnvio: '2026-04-15T14:00:00.000Z',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 20 }],
    });

    const snap = await dashboard.snapshot(new Date('2026-04-15T21:00:00.000Z'));
    // Apenas o envio via LoteLavanderia conta — 20 peças, não 50
    expect(snap.lavanderia.pecasHoje).toBe(20);
    expect(snap.lavanderia.valorHoje).toBe(600); // 20 × 30
  });

  it('persistência: estado sobrevive a obter dados depois de escrever', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });

    // Leitura pós-escrita devolve o registro íntegro (equivalente a reload
    // de página no admin). No ambiente real, JsonFileControleDiarioRepository
    // lê de data/controles-diarios.json.
    const detalhe = await c.controleDiario.obterPorData('2026-04-15');
    expect(detalhe?.enviado).toHaveLength(1);
    expect(detalhe?.enviado[0]?.quantidade).toBe(10);
    expect(detalhe?.responsavelEnvio).toBe('Ana');
  });
});
