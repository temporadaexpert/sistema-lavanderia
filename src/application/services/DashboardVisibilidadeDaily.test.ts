import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';
import { DashboardAdminService } from './DashboardAdminService';

// Garante que o admin CONSEGUE surface tudo que precisa do controle
// diário num único render (enviado, retornado, divergência, status,
// responsável, dia anterior pendente), consumindo apenas
// ControleDiarioService — sem mistura com movimentações/lavanderia.
describe('Admin dashboard: visibilidade do Controle Diário', () => {
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

  it('daily envio aparece no resumoDashboard do admin', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });

    const resumo = await c.controleDiario.resumoDashboard();
    expect(resumo).not.toBeNull();
    expect(resumo!.dataReferencia).toBe('2026-04-15');
    expect(resumo!.temControleHoje).toBe(true);
    expect(resumo!.totalEnviado).toBe(30);

    // E o admin lê responsável via obterPorData
    const detalhe = await c.controleDiario.obterPorData('2026-04-15');
    expect(detalhe?.responsavelEnvio).toBe('Ana');
    expect(detalhe?.status).toBe('aberto');
  });

  it('daily retorno aparece no resumoDashboard do admin', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });
    c.clock.set('2026-04-15T19:00:00.000Z');
    await c.controleDiario.registrarRetorno({
      data: '2026-04-15',
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 25, recebidoLimpo: 5 }],
    });

    const resumo = await c.controleDiario.resumoDashboard();
    expect(resumo!.totalRetornado).toBe(30);
    expect(resumo!.totalLimpoReaproveitado).toBe(5);

    const detalhe = await c.controleDiario.obterPorData('2026-04-15');
    expect(detalhe?.responsavelRetorno).toBe('Bruno');
  });

  it('divergência hoje aparece via calcularDivergencia + temDivergenciaHoje', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-15',
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 22, recebidoLimpo: 3 }],
    });

    const resumo = await c.controleDiario.resumoDashboard();
    expect(resumo!.totalFaltante).toBe(5);
    expect(resumo!.temDivergenciaHoje).toBe(true);

    const div = await c.controleDiario.calcularDivergencia('2026-04-15');
    expect(div?.linhas[0]?.classe).toBe('faltando');
    expect(div?.linhas[0]?.divergencia).toBe(5);
  });

  it('empty state: nenhum controle registrado → obterPorData retorna null e resumo retorna null', async () => {
    const detalheHoje = await c.controleDiario.obterPorData('2026-04-15');
    expect(detalheHoje).toBeNull();

    const resumo = await c.controleDiario.resumoDashboard();
    expect(resumo).toBeNull();
  });

  it('empty state: só tem registro de ontem → resumo refere-se a ontem, temControleHoje=false', async () => {
    // Registra e fecha ontem (pra não gerar bloqueio de dia anterior)
    await c.controleDiario.registrarEnvio({
      data: '2026-04-14',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-14',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 10, recebidoLimpo: 0 }],
      fecharDia: true,
    });

    c.clock.set('2026-04-15T09:00:00.000Z');
    const resumo = await c.controleDiario.resumoDashboard();
    expect(resumo!.dataReferencia).toBe('2026-04-14');
    expect(resumo!.temControleHoje).toBe(false);

    // admin detecta "sem controle hoje" pedindo obterPorData(hoje)
    const hoje = await c.controleDiario.obterPorData('2026-04-15');
    expect(hoje).toBeNull();
  });

  it('warning de dia anterior aberto: listarDiasAbertosAnteriores devolve pra banner do admin', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-14',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    // Não fecha

    const abertos = await c.controleDiario.listarDiasAbertosAnteriores('2026-04-15');
    expect(abertos).toHaveLength(1);
    expect(abertos[0]?.data).toBe('2026-04-14');
    expect(abertos[0]?.responsavelEnvio).toBe('Ana');
    // Admin tem a info pra montar o warning:
    //   "Controle diário anterior em aberto: 14/04/2026"
  });

  it('daily control NÃO afeta métricas de lavanderia do dashboard', async () => {
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

    // Snapshot do DashboardAdminService (impostômetro/lavanderia) deve
    // ficar intocado — só conta envio_lavanderia real via LoteLavanderia.
    const snap = await dashboard.snapshot(new Date('2026-04-15T21:00:00.000Z'));
    expect(snap.lavanderia.pecasHoje).toBe(0);
    expect(snap.lavanderia.pecasMes).toBe(0);
    expect(snap.lavanderia.valorHoje).toBe(0);
    expect(snap.lavanderia.valorMes).toBe(0);
    expect(snap.ultimasMovimentacoes).toHaveLength(0);
  });

  it('daily control + envio real pra lavanderia coexistem sem somar', async () => {
    // Avança o clock pra "hoje" cobrir a dataEnvio operacional do lote
    // (2026-04-15) — validação de não-futuro no criarEnvio exige.
    c.clock.set('2026-04-15T20:00:00.000Z');
    // Funcionária conta 100 no daily
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 100 }],
    });
    // Depois manda 30 pra lavanderia de verdade (via LoteLavanderia)
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
      dataEnvio: '2026-04-15T15:00:00.000Z',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });

    const resumoDaily = await c.controleDiario.resumoDashboard();
    expect(resumoDaily!.totalEnviado).toBe(100); // controle diário

    const snap = await dashboard.snapshot(new Date('2026-04-15T21:00:00.000Z'));
    expect(snap.lavanderia.pecasHoje).toBe(30); // lavanderia real
    expect(snap.lavanderia.valorHoje).toBe(900); // 30 × 30

    // E não há overlap — são fontes distintas de dados.
  });
});
