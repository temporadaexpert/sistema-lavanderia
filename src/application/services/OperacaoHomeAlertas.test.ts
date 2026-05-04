import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS } from '@/testing/testSeed';

// Cobre o contrato do que /operacao consome para decidir mostrar/ocultar
// banner vermelho de divergência. A lógica do component live em
// `classificar()` e `mostrarBanner` em /operacao/page.tsx; aqui validamos
// os SINAIS que ele consome (resumoDashboard.temDivergenciaHoje +
// divergenciaDoDia.aguardandoRetorno + temDivergencia + retorno.length).
//
// Se algum desses sinais quebrar, a UI volta a alarmar falsamente.
describe('Operação home: alerta de divergência respeita aguardando-retorno', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
  });

  it('1) só envio → home NÃO deve mostrar alerta vermelho', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });

    const resumo = await c.controleDiario.resumoDashboard();
    const div = await c.controleDiario.calcularDivergencia('2026-04-15');
    const controle = await c.controleDiario.obterPorData('2026-04-15');

    // Sinais: ambos false e aguardando true
    expect(resumo!.temDivergenciaHoje).toBe(false);
    expect(div!.temDivergencia).toBe(false);
    expect(div!.aguardandoRetorno).toBe(true);

    // Reproduz a expressão da home: mostrarBanner=
    //   !aguardando && resumo.temDivergenciaHoje && div.temDivergencia
    const aguardando =
      div!.aguardandoRetorno || (controle!.retorno.length === 0);
    const mostrarBanner =
      !aguardando &&
      resumo!.temDivergenciaHoje === true &&
      div!.temDivergencia === true;
    expect(mostrarBanner).toBe(false);
  });

  it('2) só envio → sinais para card neutro "aguardando retorno"', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });

    const div = await c.controleDiario.calcularDivergencia('2026-04-15');
    const controle = await c.controleDiario.obterPorData('2026-04-15');

    const aguardando =
      div!.aguardandoRetorno ||
      (controle !== null &&
        controle.enviado.length > 0 &&
        controle.retorno.length === 0);
    expect(aguardando).toBe(true); // home renderiza .cardAguardando
    expect(div!.linhas).toHaveLength(0); // sem lista de "faltantes"
  });

  it('3) envio + retorno parcial → home DEVE mostrar alerta vermelho', async () => {
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
    const div = await c.controleDiario.calcularDivergencia('2026-04-15');
    const controle = await c.controleDiario.obterPorData('2026-04-15');

    expect(div!.aguardandoRetorno).toBe(false);
    expect(div!.temDivergencia).toBe(true);
    expect(resumo!.temDivergenciaHoje).toBe(true);

    const aguardando =
      div!.aguardandoRetorno || (controle!.retorno.length === 0);
    const mostrarBanner =
      !aguardando &&
      resumo!.temDivergenciaHoje === true &&
      div!.temDivergencia === true;
    expect(mostrarBanner).toBe(true);
  });

  it('4) envio + retorno completo → home NÃO mostra alerta vermelho', async () => {
    c.clock.set('2026-04-15T09:00:00.000Z');
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

    const resumo = await c.controleDiario.resumoDashboard();
    const div = await c.controleDiario.calcularDivergencia('2026-04-15');

    expect(div!.aguardandoRetorno).toBe(false);
    expect(div!.temDivergencia).toBe(false);
    expect(resumo!.temDivergenciaHoje).toBe(false);

    const mostrarBanner =
      !div!.aguardandoRetorno &&
      resumo!.temDivergenciaHoje === true &&
      div!.temDivergencia === true;
    expect(mostrarBanner).toBe(false);
  });

  it('classificar: só envio = envio_pendente_retorno (amarelo), nunca divergencia (vermelho)', async () => {
    // Espelha a função classificar() de operacao/page.tsx
    function classificar(
      controle: { enviado: { quantidade: number }[]; retorno: unknown[] } | null,
      div: { temDivergencia: boolean; aguardandoRetorno: boolean } | null,
      resumo: { temControleHoje: boolean; temDivergenciaHoje: boolean } | null,
    ): string {
      if (!controle || controle.enviado.length === 0) return 'sem_envio';
      const aguardando =
        div?.aguardandoRetorno === true || controle.retorno.length === 0;
      if (aguardando) return 'envio_pendente_retorno';
      if (div?.temDivergencia) return 'divergencia';
      if (resumo?.temControleHoje && !resumo.temDivergenciaHoje) return 'ok';
      return 'ok';
    }

    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });
    const ctrl = await c.controleDiario.obterPorData('2026-04-15');
    const div = await c.controleDiario.calcularDivergencia('2026-04-15');
    const resumo = await c.controleDiario.resumoDashboard();

    const estado = classificar(
      ctrl ? { enviado: ctrl.enviado.slice(), retorno: ctrl.retorno.slice() } : null,
      div,
      resumo,
    );
    expect(estado).toBe('envio_pendente_retorno');
    expect(estado).not.toBe('divergencia');
  });
});
