import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS } from '@/testing/testSeed';

// Garante que o sistema NÃO calcula divergência prematuramente.
// Antes, retorno=0 fazia todo enviado virar "faltando", disparando
// alertas vermelhos antes do operador sequer registrar o retorno.
describe('Divergência: aguardando retorno', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
  });

  it('1) só envio (sem retorno) → aguardandoRetorno=true e sem divergência', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [
        { itemId: TEST_ITENS.toalha, quantidade: 30 },
        { itemId: TEST_ITENS.fronha, quantidade: 20 },
      ],
    });
    const d = await c.controleDiario.calcularDivergencia('2026-04-15');
    expect(d).not.toBeNull();
    expect(d!.aguardandoRetorno).toBe(true);
    expect(d!.temDivergencia).toBe(false);
    expect(d!.linhas).toHaveLength(0);
    expect(d!.totalFaltante).toBe(0);
    expect(d!.totalExcedente).toBe(0);
    // Total enviado é preservado pra UI mostrar "enviado hoje"
    expect(d!.totalEnviado).toBe(50);
  });

  it('2) envio + retorno parcial → divergência detectada', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-15',
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 20, recebidoLimpo: 5 }],
    });
    const d = await c.controleDiario.calcularDivergencia('2026-04-15');
    expect(d!.aguardandoRetorno).toBe(false);
    expect(d!.temDivergencia).toBe(true);
    expect(d!.totalFaltante).toBe(5); // 30 - 25
    expect(d!.linhas[0]?.classe).toBe('faltando');
  });

  it('3) envio + retorno completo → ok, sem divergência', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-15',
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 7, recebidoLimpo: 3 }],
    });
    const d = await c.controleDiario.calcularDivergencia('2026-04-15');
    expect(d!.aguardandoRetorno).toBe(false);
    expect(d!.temDivergencia).toBe(false);
    expect(d!.totalFaltante).toBe(0);
    expect(d!.linhas[0]?.classe).toBe('ok');
  });

  it('4) sem envio (e sem retorno) → null', async () => {
    const d = await c.controleDiario.calcularDivergencia('2026-04-15');
    expect(d).toBeNull();
  });

  it('5) retorno maior que envio (excedente) → divergência tipo excesso', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-15',
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 7, recebidoLimpo: 0 }],
    });
    const d = await c.controleDiario.calcularDivergencia('2026-04-15');
    expect(d!.aguardandoRetorno).toBe(false);
    expect(d!.temDivergencia).toBe(true);
    expect(d!.totalExcedente).toBe(2);
    expect(d!.totalFaltante).toBe(0);
    expect(d!.linhas[0]?.classe).toBe('excedente');
  });

  it('só retorno (sem envio) → não é aguardando, é excesso direto', async () => {
    // Edge case: operador esqueceu envio, registrou retorno. Considera
    // tudo excedente — comportamento existente preservado.
    await c.controleDiario.registrarRetorno({
      data: '2026-04-15',
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 5, recebidoLimpo: 0 }],
    });
    const d = await c.controleDiario.calcularDivergencia('2026-04-15');
    expect(d!.aguardandoRetorno).toBe(false);
    expect(d!.temDivergencia).toBe(true);
    expect(d!.totalExcedente).toBe(5);
  });

  it('resumoDashboard reflete aguardandoRetorno: temDivergenciaHoje=false', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });
    const r = await c.controleDiario.resumoDashboard();
    expect(r!.totalEnviado).toBe(30);
    expect(r!.totalRetornado).toBe(0);
    expect(r!.totalFaltante).toBe(0);
    // Crítico: NÃO acusa divergência prematura
    expect(r!.temDivergenciaHoje).toBe(false);
  });

  it('admin listarDivergencias NÃO inclui dias só-com-envio', async () => {
    // Dia A: só envio (aguardando retorno)
    await c.controleDiario.registrarEnvio({
      data: '2026-04-13',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    // Tem que fechar pra poder abrir 14
    await c.controleDiario.registrarRetorno({
      data: '2026-04-13',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 10, recebidoLimpo: 0 }],
      fecharDia: true,
    });
    // Dia B: envio + retorno parcial (divergência REAL)
    await c.controleDiario.registrarEnvio({
      data: '2026-04-14',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-14',
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 7, recebidoLimpo: 0 }],
    });

    const lista = await c.controleDiario.listarDivergencias();
    // Apenas o dia 14 (com divergência real). Dia 13 fechou ok.
    expect(lista).toHaveLength(1);
    expect(lista[0]?.data).toBe('2026-04-14');
  });

  it('fluxo completo do dia: envio → estado neutro → retorno → estado final', async () => {
    // Manhã: registra envio
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 20 }],
    });
    let d = await c.controleDiario.calcularDivergencia('2026-04-15');
    expect(d!.aguardandoRetorno).toBe(true);
    expect(d!.temDivergencia).toBe(false);

    // Tarde: registra retorno (parcial, divergência real surge agora)
    await c.controleDiario.registrarRetorno({
      data: '2026-04-15',
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 18, recebidoLimpo: 0 }],
    });
    d = await c.controleDiario.calcularDivergencia('2026-04-15');
    expect(d!.aguardandoRetorno).toBe(false);
    expect(d!.temDivergencia).toBe(true);
    expect(d!.totalFaltante).toBe(2);
  });
});
