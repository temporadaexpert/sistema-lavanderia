import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';
import { ValidationError } from '@/domain/errors/DomainErrors';

// Valida a regra de negócio crítica:
//   Não pode iniciar um novo dia de controle diário enquanto um dia
//   anterior estiver em aberto (status=aberto com envio ou retorno).
// Tanto registrarEnvio quanto registrarRetorno respeitam a regra —
// backend enforce, UI NÃO é única linha de defesa.
describe('ControleDiarioService: bloqueio de dia anterior aberto', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
  });

  // Helpers de arrange
  async function abrirDiaComEnvio(data: string, responsavel = 'Ana'): Promise<void> {
    await c.controleDiario.registrarEnvio({
      data,
      responsavel,
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
  }
  async function fecharDiaOK(data: string): Promise<void> {
    await c.controleDiario.registrarRetorno({
      data,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 10, recebidoLimpo: 0 }],
      fecharDia: true,
    });
  }

  it('dia anterior aberto BLOQUEIA envio de hoje', async () => {
    await abrirDiaComEnvio('2026-04-10');
    await expect(
      c.controleDiario.registrarEnvio({
        data: '2026-04-11',
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('10/04/2026'),
    });
  });

  it('dia anterior fechado PERMITE envio de hoje', async () => {
    await abrirDiaComEnvio('2026-04-10');
    await fecharDiaOK('2026-04-10');
    await expect(
      c.controleDiario.registrarEnvio({
        data: '2026-04-11',
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      }),
    ).resolves.toBeDefined();
  });

  it('dia anterior VAZIO (sem envio nem retorno) não bloqueia', async () => {
    // Não há registro pro dia 10 — lista está vazia. Mesmo que o
    // status default de um ausente seria "aberto", o helper só considera
    // dias com conteúdo.
    await expect(
      c.controleDiario.registrarEnvio({
        data: '2026-04-11',
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      }),
    ).resolves.toBeDefined();
  });

  it('próprio dia aberto NÃO bloqueia seu próprio retorno', async () => {
    await abrirDiaComEnvio('2026-04-11');
    // Mesmo dia — helper filtra `c.data < ref`, então não aparece.
    await expect(
      c.controleDiario.registrarRetorno({
        data: '2026-04-11',
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 10, recebidoLimpo: 0 }],
      }),
    ).resolves.toBeDefined();
  });

  it('operador pode continuar editando o dia pendente enquanto ele está aberto', async () => {
    await abrirDiaComEnvio('2026-04-10');
    // Ajusta envio do próprio dia pendente (não é novo dia)
    await expect(
      c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 15 }],
      }),
    ).resolves.toBeDefined();
    // E pode registrar retorno/fechar esse dia
    await expect(
      c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 15, recebidoLimpo: 0 }],
        fecharDia: true,
      }),
    ).resolves.toBeDefined();
  });

  it('retorno em data posterior ao dia pendente também é bloqueado', async () => {
    await abrirDiaComEnvio('2026-04-10');
    await expect(
      c.controleDiario.registrarRetorno({
        data: '2026-04-12',
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 1, recebidoLimpo: 0 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('listarDiasAbertosAnteriores devolve ordenado do mais antigo', async () => {
    await abrirDiaComEnvio('2026-04-08');
    // Como dia 8 está aberto, não dá pra abrir dia 9 via service —
    // então arrange direto no repo pra simular histórico legado
    await c.controlesDiarios.salvar({
      id: 'id-legacy-1' as never,
      data: '2026-04-09',
      enviado: [{ itemId: TEST_ITENS.toalha, quantidade: 3 }],
      retorno: [],
      status: 'aberto',
      abertoEm: '2026-04-09T08:00:00.000Z',
      fechadoEm: null,
      responsavelEnvio: 'Legacy',
      responsavelRetorno: null,
      responsavelFechamento: null,
      motivoDivergencia: null,
    });

    const abertos = await c.controleDiario.listarDiasAbertosAnteriores('2026-04-11');
    expect(abertos).toHaveLength(2);
    expect(abertos[0]?.data).toBe('2026-04-08');
    expect(abertos[1]?.data).toBe('2026-04-09');
  });

  it('fluxo de lavanderia (criarEnvio) NÃO é afetado pelo bloqueio diário', async () => {
    // Dia anterior aberto no controle diário...
    await abrirDiaComEnvio('2026-04-10');

    // ...mas envio pra lavanderia via LoteLavanderiaService deve rolar.
    // Essa validação vive em outro agregado e não tem nada a ver com o
    // fluxo diário. Lavanderia é paralela.
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 50,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
    await expect(
      c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      }),
    ).resolves.toBeDefined();
  });

  it('mensagem é amigável e inclui a data pendente formatada em pt-BR', async () => {
    await abrirDiaComEnvio('2026-04-10');
    try {
      await c.controleDiario.registrarEnvio({
        data: '2026-04-22',
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 1 }],
      });
      throw new Error('devia ter rejeitado');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const msg = (err as Error).message;
      expect(msg).toContain('anterior em aberto');
      expect(msg).toContain('10/04/2026');
      // Não vaza id técnico
      expect(msg).not.toContain('id-');
      expect(msg).not.toContain('item-');
    }
  });

  it('com múltiplos dias abertos, mensagem cita o mais antigo (prioridade de fechamento)', async () => {
    await abrirDiaComEnvio('2026-04-07');
    await c.controlesDiarios.salvar({
      id: 'id-legacy-2' as never,
      data: '2026-04-08',
      enviado: [{ itemId: TEST_ITENS.toalha, quantidade: 3 }],
      retorno: [],
      status: 'aberto',
      abertoEm: '2026-04-08T08:00:00.000Z',
      fechadoEm: null,
      responsavelEnvio: 'Legacy',
      responsavelRetorno: null,
      responsavelFechamento: null,
      motivoDivergencia: null,
    });

    try {
      await c.controleDiario.registrarEnvio({
        data: '2026-04-15',
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 1 }],
      });
      throw new Error('devia ter rejeitado');
    } catch (err) {
      // Cita o mais antigo (07), não o 08
      expect((err as Error).message).toContain('07/04/2026');
      expect((err as Error).message).not.toContain('08/04/2026');
    }
  });
});
