import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS } from '@/testing/testSeed';
import { ItemId } from '@/domain/types/ids';

describe('ControleDiarioService', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
  });

  it('registra envio criando novo dia quando não existe', async () => {
    const r = await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'Depósito',
      itens: [
        { itemId: TEST_ITENS.toalha, quantidade: 30 },
        { itemId: TEST_ITENS.fronha, quantidade: 20 },
      ],
    });
    expect(r.status).toBe('aberto');
    expect(r.enviado).toHaveLength(2);
    expect(r.retorno).toHaveLength(0);
    expect(r.responsavelEnvio).toBe('Depósito');
  });

  it('rejeita responsável vazio no envio', async () => {
    await expect(
      c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: '   ',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejeita data inválida', async () => {
    await expect(
      c.controleDiario.registrarEnvio({
        data: '10/04/2026',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejeita quantidade negativa', async () => {
    await expect(
      c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: -1 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejeita item inexistente', async () => {
    await expect(
      c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: ItemId('nao-existe'), quantidade: 5 }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('remove linhas com quantidade zero ao sanitizar', async () => {
    const r = await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [
        { itemId: TEST_ITENS.toalha, quantidade: 5 },
        { itemId: TEST_ITENS.fronha, quantidade: 0 },
      ],
    });
    expect(r.enviado).toHaveLength(1);
    expect(r.enviado[0]?.itemId).toBe(TEST_ITENS.toalha);
  });

  it('soma quantidades quando o mesmo item aparece duas vezes no envio', async () => {
    const r = await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [
        { itemId: TEST_ITENS.toalha, quantidade: 5 },
        { itemId: TEST_ITENS.toalha, quantidade: 3 },
      ],
    });
    expect(r.enviado).toHaveLength(1);
    expect(r.enviado[0]?.quantidade).toBe(8);
  });

  it('sobrescreve o envio ao registrar novamente no mesmo dia aberto', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
    const r = await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    expect(r.enviado[0]?.quantidade).toBe(10);
  });

  it('preserva o retorno já existente ao atualizar envio', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-10',
      responsavel: 'Y',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 3, recebidoLimpo: 1 }],
    });
    const r = await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 7 }],
    });
    expect(r.enviado[0]?.quantidade).toBe(7);
    expect(r.retorno).toHaveLength(1);
    expect(r.retorno[0]?.recebidoSujo).toBe(3);
    expect(r.retorno[0]?.recebidoLimpo).toBe(1);
  });

  it('registra retorno com sujo e limpo separados', async () => {
    const r = await c.controleDiario.registrarRetorno({
      data: '2026-04-10',
      responsavel: 'Y',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 20, recebidoLimpo: 5 }],
    });
    expect(r.retorno[0]?.recebidoSujo).toBe(20);
    expect(r.retorno[0]?.recebidoLimpo).toBe(5);
    expect(r.status).toBe('aberto');
  });

  it('rejeita alteração após fechar o dia', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-10',
      responsavel: 'Y',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 3, recebidoLimpo: 2 }],
      fecharDia: true,
    });
    await expect(
      c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Y',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 1, recebidoLimpo: 0 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejeita fechar dia vazio', async () => {
    await expect(
      c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Y',
        itens: [],
        fecharDia: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('classifica divergência: ok, faltando e excedente', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [
        { itemId: TEST_ITENS.toalha, quantidade: 30 }, // ok
        { itemId: TEST_ITENS.fronha, quantidade: 20 }, // faltando
        { itemId: TEST_ITENS.semPreco, quantidade: 5 }, // excedente
      ],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-10',
      responsavel: 'Y',
      itens: [
        { itemId: TEST_ITENS.toalha, recebidoSujo: 25, recebidoLimpo: 5 }, // 30 = 30
        { itemId: TEST_ITENS.fronha, recebidoSujo: 10, recebidoLimpo: 5 }, // 15 < 20
        { itemId: TEST_ITENS.semPreco, recebidoSujo: 4, recebidoLimpo: 3 }, // 7 > 5
      ],
    });
    const d = await c.controleDiario.calcularDivergencia('2026-04-10');
    expect(d).not.toBeNull();
    expect(d!.temDivergencia).toBe(true);
    expect(d!.totalFaltante).toBe(5);
    expect(d!.totalExcedente).toBe(2);
    const toalha = d!.linhas.find((l) => l.itemId === TEST_ITENS.toalha)!;
    const fronha = d!.linhas.find((l) => l.itemId === TEST_ITENS.fronha)!;
    const sem = d!.linhas.find((l) => l.itemId === TEST_ITENS.semPreco)!;
    expect(toalha.classe).toBe('ok');
    expect(fronha.classe).toBe('faltando');
    expect(fronha.divergencia).toBe(5);
    expect(sem.classe).toBe('excedente');
    expect(sem.divergencia).toBe(-2);
  });

  it('ordena linhas: faltantes primeiro, depois excedentes, depois ok', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [
        { itemId: TEST_ITENS.toalha, quantidade: 10 },
        { itemId: TEST_ITENS.fronha, quantidade: 10 },
        { itemId: TEST_ITENS.semPreco, quantidade: 10 },
      ],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-10',
      responsavel: 'Y',
      itens: [
        { itemId: TEST_ITENS.toalha, recebidoSujo: 10, recebidoLimpo: 0 }, // ok
        { itemId: TEST_ITENS.fronha, recebidoSujo: 15, recebidoLimpo: 0 }, // excedente
        { itemId: TEST_ITENS.semPreco, recebidoSujo: 5, recebidoLimpo: 0 }, // faltando
      ],
    });
    const d = await c.controleDiario.calcularDivergencia('2026-04-10');
    expect(d!.linhas.map((l) => l.classe)).toEqual(['faltando', 'excedente', 'ok']);
  });

  it('retorna temDivergencia=false quando tudo bate', async () => {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 20 }],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-10',
      responsavel: 'Y',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 18, recebidoLimpo: 2 }],
    });
    const d = await c.controleDiario.calcularDivergencia('2026-04-10');
    expect(d!.temDivergencia).toBe(false);
    expect(d!.totalFaltante).toBe(0);
    expect(d!.totalExcedente).toBe(0);
  });

  it('obterPorData retorna null quando não há registro', async () => {
    const r = await c.controleDiario.obterPorData('2026-04-10');
    expect(r).toBeNull();
  });

  it('listar ordena do mais recente para o mais antigo', async () => {
    // Grava direto no repo: a regra "dia anterior aberto bloqueia
    // novos dias" impediria esse cenário via service. Esse teste é
    // especificamente sobre ORDENAÇÃO da listagem.
    const base = {
      enviado: [{ itemId: TEST_ITENS.toalha, quantidade: 1 }],
      retorno: [],
      status: 'aberto' as const,
      abertoEm: '2026-04-10T00:00:00.000Z',
      fechadoEm: null,
      responsavelEnvio: 'X',
      responsavelRetorno: null,
      responsavelFechamento: null,
      motivoDivergencia: null,
      classificacaoDivergencia: null,
      origemDivergencia: null,
    };
    await c.controlesDiarios.salvar({ ...base, id: 'id-a' as never, data: '2026-04-10' });
    await c.controlesDiarios.salvar({ ...base, id: 'id-b' as never, data: '2026-04-08' });
    await c.controlesDiarios.salvar({ ...base, id: 'id-c' as never, data: '2026-04-09' });
    const lista = await c.controleDiario.listar();
    expect(lista.map((x) => x.data)).toEqual(['2026-04-10', '2026-04-09', '2026-04-08']);
  });

  it('resumoDashboard usa o dia mais recente e marca temControleHoje', async () => {
    c.clock.set('2026-04-10T20:00:00.000Z');
    await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 20 }],
    });
    await c.controleDiario.registrarRetorno({
      data: '2026-04-10',
      responsavel: 'Y',
      itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 15, recebidoLimpo: 3 }],
    });
    const r = await c.controleDiario.resumoDashboard();
    expect(r).not.toBeNull();
    expect(r!.dataReferencia).toBe('2026-04-10');
    expect(r!.totalEnviado).toBe(20);
    expect(r!.totalRetornado).toBe(18);
    expect(r!.totalLimpoReaproveitado).toBe(3);
    expect(r!.totalFaltante).toBe(2);
    expect(r!.temControleHoje).toBe(true);
    expect(r!.temDivergenciaHoje).toBe(true);
  });

  it('resumoDashboard marca temControleHoje=false quando a data-base é de outro dia', async () => {
    c.clock.set('2026-04-12T10:00:00.000Z');
    await c.controleDiario.registrarEnvio({
      data: '2026-04-10',
      responsavel: 'X',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
    const r = await c.controleDiario.resumoDashboard();
    expect(r!.dataReferencia).toBe('2026-04-10');
    expect(r!.temControleHoje).toBe(false);
    expect(r!.temDivergenciaHoje).toBe(false);
  });

  it('resumoDashboard retorna null quando não há registros', async () => {
    const r = await c.controleDiario.resumoDashboard();
    expect(r).toBeNull();
  });

  it('enxovalSujoParaLavanderia retorna somente o sujo agrupado por item', async () => {
    await c.controleDiario.registrarRetorno({
      data: '2026-04-10',
      responsavel: 'Y',
      itens: [
        { itemId: TEST_ITENS.toalha, recebidoSujo: 15, recebidoLimpo: 5 },
        { itemId: TEST_ITENS.fronha, recebidoSujo: 0, recebidoLimpo: 10 }, // sem sujo
        { itemId: TEST_ITENS.semPreco, recebidoSujo: 3, recebidoLimpo: 0 },
      ],
    });
    const sujo = await c.controleDiario.enxovalSujoParaLavanderia('2026-04-10');
    expect(sujo).toHaveLength(2);
    const toalha = sujo.find((l) => l.itemId === TEST_ITENS.toalha);
    const semPreco = sujo.find((l) => l.itemId === TEST_ITENS.semPreco);
    expect(toalha?.quantidade).toBe(15);
    expect(semPreco?.quantidade).toBe(3);
  });

  it('enxovalSujoParaLavanderia rejeita data sem controle', async () => {
    await expect(
      c.controleDiario.enxovalSujoParaLavanderia('2026-04-10'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  describe('fechamento com divergência', () => {
    it('fecha sem divergência → status fechado e sem motivo', async () => {
      await c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      const r = await c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Y',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 10, recebidoLimpo: 0 }],
        fecharDia: true,
      });
      expect(r.status).toBe('fechado');
      expect(r.motivoDivergencia).toBeNull();
      expect(r.fechadoEm).not.toBeNull();
    });

    it('rejeita fechar com divergência SEM motivo', async () => {
      await c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      await expect(
        c.controleDiario.registrarRetorno({
          data: '2026-04-10',
          responsavel: 'Y',
          itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 7, recebidoLimpo: 0 }],
          fecharDia: true,
        }),
      ).rejects.toMatchObject({ code: 'DIVERGENCIA_DIARIA_DETECTADA' });
    });

    it('fecha com divergência + classificação + origem → status fechado_com_divergencia', async () => {
      await c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      const r = await c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Funcionária',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 7, recebidoLimpo: 0 }],
        fecharDia: true,
        classificacaoDivergencia: 'extravio',
        origemDivergencia: 'imovel',
        motivoDivergencia: '3 toalhas esquecidas no imóvel 302',
        responsavelFechamento: 'Gestor',
      });
      expect(r.status).toBe('fechado_com_divergencia');
      expect(r.motivoDivergencia).toBe('3 toalhas esquecidas no imóvel 302');
      expect(r.classificacaoDivergencia).toBe('extravio');
      expect(r.origemDivergencia).toBe('imovel');
      expect(r.responsavelFechamento).toBe('Gestor');
      expect(r.fechadoEm).not.toBeNull();
    });

    it('responsavelFechamento cai pra responsavel quando não informado', async () => {
      await c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      const r = await c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 3, recebidoLimpo: 0 }],
        fecharDia: true,
        classificacaoDivergencia: 'perda',
        origemDivergencia: 'lavanderia',
        motivoDivergencia: 'perda confirmada',
      });
      expect(r.responsavelFechamento).toBe('Ana');
    });

    it('rejeita alterações depois de fechado_com_divergencia', async () => {
      await c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      await c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Y',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 7, recebidoLimpo: 0 }],
        fecharDia: true,
        classificacaoDivergencia: 'perda',
        origemDivergencia: 'lavanderia',
        motivoDivergencia: 'perda',
      });
      await expect(
        c.controleDiario.registrarEnvio({
          data: '2026-04-10',
          responsavel: 'X',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 20 }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(
        c.controleDiario.registrarRetorno({
          data: '2026-04-10',
          responsavel: 'Y',
          itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 10, recebidoLimpo: 0 }],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('motivo só é exigido em divergência ao fechar (salvar parcial não exige)', async () => {
      await c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      // Salva retorno parcial com faltante — não fecha → OK sem motivo
      const r = await c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Y',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 5, recebidoLimpo: 0 }],
      });
      expect(r.status).toBe('aberto');
      expect(r.motivoDivergencia).toBeNull();
    });
  });

  describe('listarDivergencias (admin)', () => {
    it('retorna vazio quando não há divergência', async () => {
      await c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      await c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Y',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 5, recebidoLimpo: 0 }],
        fecharDia: true,
      });
      const list = await c.controleDiario.listarDivergencias();
      expect(list).toHaveLength(0);
    });

    it('soma valorEstimado usando preço unitário do item', async () => {
      // Toalha vale 30 no seed de teste
      await c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      await c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Y',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 7, recebidoLimpo: 0 }],
        fecharDia: true,
        classificacaoDivergencia: 'perda',
        origemDivergencia: 'lavanderia',
        motivoDivergencia: 'perda',
      });
      const list = await c.controleDiario.listarDivergencias();
      expect(list).toHaveLength(1);
      expect(list[0]?.data).toBe('2026-04-10');
      expect(list[0]?.totalFaltante).toBe(3);
      expect(list[0]?.valorEstimado).toBe(90); // 3 × 30
      expect(list[0]?.custoParcial).toBe(false);
      expect(list[0]?.status).toBe('fechado_com_divergencia');
    });

    it('marca custoParcial=true quando item faltante não tem preço', async () => {
      // semPreco tem valorUnitario=null
      await c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.semPreco, quantidade: 5 }],
      });
      await c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Y',
        itens: [{ itemId: TEST_ITENS.semPreco, recebidoSujo: 3, recebidoLimpo: 0 }],
        fecharDia: true,
        classificacaoDivergencia: 'perda',
        origemDivergencia: 'lavanderia',
        motivoDivergencia: 'perda',
      });
      const list = await c.controleDiario.listarDivergencias();
      expect(list[0]?.custoParcial).toBe(true);
      expect(list[0]?.valorEstimado).toBe(0);
      expect(list[0]?.itens[0]?.valorFaltante).toBeNull();
    });

    it('inclui dias abertos com divergência por padrão; apenasFechados filtra', async () => {
      // Dia 1: aberto com divergência
      await c.controleDiario.registrarEnvio({
        data: '2026-04-10',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      await c.controleDiario.registrarRetorno({
        data: '2026-04-10',
        responsavel: 'Y',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 5, recebidoLimpo: 0 }],
      });
      // Dia 2: fechado com divergência
      await c.controleDiario.registrarEnvio({
        data: '2026-04-09',
        responsavel: 'X',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      await c.controleDiario.registrarRetorno({
        data: '2026-04-09',
        responsavel: 'Y',
        itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 3, recebidoLimpo: 0 }],
        fecharDia: true,
        classificacaoDivergencia: 'perda',
        origemDivergencia: 'lavanderia',
        motivoDivergencia: 'perda',
      });

      const todos = await c.controleDiario.listarDivergencias();
      expect(todos).toHaveLength(2);
      // Ordenação: mais recente primeiro
      expect(todos[0]?.data).toBe('2026-04-10');
      expect(todos[0]?.status).toBe('aberto');
      expect(todos[1]?.data).toBe('2026-04-09');
      expect(todos[1]?.status).toBe('fechado_com_divergencia');

      const somenteFechados = await c.controleDiario.listarDivergencias({
        apenasFechados: true,
      });
      expect(somenteFechados).toHaveLength(1);
      expect(somenteFechados[0]?.data).toBe('2026-04-09');
    });
  });
});
