import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  criarContainerDeTeste,
  type ContainerDeTeste,
} from '@/testing/testContainer';
import { semearBasico, TEST_ITENS } from '@/testing/testSeed';

// Mocka `getContainer` (singleton de prod) para que a action use um
// container InMemory isolado. Testa a CADEIA REAL de salvarRetornoDiarioAction
// → ControleDiarioService → DivergenciaDiariaDetectadaError → tradução
// para `code: 'DIVERGENCIA_DIARIA_DETECTADA'` no AcaoResultado.
//
// Esse teste é a prova requerida: garante que a ACTION devolve o code
// correto, não só que o service lança a exceção. Cobre o cenário do
// bug onde o operador via "Erro inesperado: Existem peças faltantes".
vi.mock('@/infrastructure/singleton', () => ({
  getContainer: vi.fn(),
}));

// `next/cache` precisa de mock pra revalidatePath funcionar fora do
// runtime do Next em vitest (env=node).
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { getContainer } from '@/infrastructure/singleton';
import { salvarRetornoDiarioAction } from './controleDiarioActions';

describe('salvarRetornoDiarioAction (action wrapper sobre ControleDiarioService)', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
    vi.mocked(getContainer).mockResolvedValue(c as never);
  });

  afterEach(() => {
    vi.mocked(getContainer).mockReset();
  });

  function fdRetorno(opts: {
    fechar?: boolean;
    classificacao?: string;
    origem?: string;
    motivo?: string;
    qtdSujo: number;
    qtdLimpo?: number;
  }): FormData {
    const fd = new FormData();
    fd.set('data', '2026-04-15');
    fd.set('responsavel', 'Operador');
    if (opts.fechar) fd.set('fecharDia', 'on');
    if (opts.classificacao) fd.set('classificacaoDivergencia', opts.classificacao);
    if (opts.origem) fd.set('origemDivergencia', opts.origem);
    if (opts.motivo) fd.set('motivoDivergencia', opts.motivo);
    fd.set(`sujo[${TEST_ITENS.toalha}]`, String(opts.qtdSujo));
    if (opts.qtdLimpo != null) {
      fd.set(`limpo[${TEST_ITENS.toalha}]`, String(opts.qtdLimpo));
    }
    return fd;
  }

  async function preEnviar(quantidade: number) {
    await c.controleDiario.registrarEnvio({
      data: '2026-04-15',
      responsavel: 'Manhã',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade }],
    });
  }

  it('A: action retorna code DIVERGENCIA_DIARIA_DETECTADA quando há div sem classificação', async () => {
    await preEnviar(10);
    const r = await salvarRetornoDiarioAction(
      fdRetorno({ fechar: true, qtdSujo: 7 }),
    );

    // PROVA EXPLÍCITA: NÃO pode ser INTERNAL. NÃO pode começar com "Erro inesperado".
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inesperado: ok=true');
    expect(r.code).toBe('DIVERGENCIA_DIARIA_DETECTADA');
    expect(r.code).not.toBe('INTERNAL');
    expect(r.code).not.toBe('VALIDATION_ERROR');
    expect(r.error).not.toMatch(/^Erro inesperado/);

    // Payload presente pra UI abrir modal com lista detalhada.
    // Narrow no SHAPE (`'totalFaltante' in r`) — discriminator confiável
    // que TS reconhece mesmo com a variante catch-all `{ code: string }`
    // no AcaoResultado.
    if (!r.ok && 'totalFaltante' in r && 'divergencias' in r) {
      expect(r.code).toBe('DIVERGENCIA_DIARIA_DETECTADA');
      expect(r.divergencias).toHaveLength(1);
      expect(r.divergencias[0]?.faltante).toBe(3);
      expect(r.totalFaltante).toBe(3);
      expect(r.totalExcedente).toBe(0);
    } else {
      throw new Error('esperado payload de DIVERGENCIA_DIARIA_DETECTADA');
    }
  });

  it('B: action conclui ok com classificação + origem + responsável', async () => {
    await preEnviar(10);
    const r = await salvarRetornoDiarioAction(
      fdRetorno({
        fechar: true,
        qtdSujo: 7,
        classificacao: 'extravio',
        origem: 'imovel',
        motivo: '3 toalhas esquecidas no apto 302',
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('C: action ainda é robusta a "outro" sem descrição (volta ValidationError, não Erro inesperado)', async () => {
    await preEnviar(10);
    const r = await salvarRetornoDiarioAction(
      fdRetorno({
        fechar: true,
        qtdSujo: 7,
        classificacao: 'outro',
        origem: 'desconhecida',
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inesperado: ok=true');
    expect(r.code).toBe('VALIDATION_ERROR');
    expect(r.error).not.toMatch(/^Erro inesperado/);
  });

  it('D: action rejeita classificação inválida na fronteira HTTP (sem chegar no service)', async () => {
    await preEnviar(10);
    const r = await salvarRetornoDiarioAction(
      fdRetorno({
        fechar: true,
        qtdSujo: 7,
        classificacao: 'fornecedor', // fora do enum
        origem: 'lavanderia',
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inesperado');
    expect(r.code).toBe('VALIDATION_ERROR');
    expect(r.error).toMatch(/Classificação de divergência inválida/i);
  });

  it('E: action rejeita origem inválida na fronteira HTTP', async () => {
    await preEnviar(10);
    const r = await salvarRetornoDiarioAction(
      fdRetorno({
        fechar: true,
        qtdSujo: 7,
        classificacao: 'perda',
        origem: 'marte', // fora do enum
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inesperado');
    expect(r.code).toBe('VALIDATION_ERROR');
    expect(r.error).toMatch(/Origem da divergência inválida/i);
  });

  it('F: salvar parcial (sem fechar) NÃO exige classificação mesmo com divergência', async () => {
    await preEnviar(10);
    const r = await salvarRetornoDiarioAction(
      fdRetorno({ fechar: false, qtdSujo: 7 }),
    );
    expect(r.ok).toBe(true);
  });

  it('G: detecção é robusta — duck-typing pega objeto com shape do erro mesmo sem instanceof', async () => {
    // Simula o cenário de boundary de módulo: getContainer devolve um
    // container cujo método LANÇA um objeto que TEM o shape do erro mas
    // NÃO passa no instanceof (porque a classe veio de outro path de
    // resolução de módulo).
    const fakeError = Object.assign(new Error('fake msg'), {
      name: 'DivergenciaDiariaDetectadaError',
      code: 'DIVERGENCIA_DIARIA_DETECTADA',
      divergencias: [
        { itemId: 'x', nomeItem: 'X', retornado: 3, faltante: 2, excedente: 0 },
      ],
      totalFaltante: 2,
      totalExcedente: 0,
    });
    const containerMock = {
      ...c,
      controleDiario: {
        ...c.controleDiario,
        registrarRetorno: vi.fn().mockRejectedValue(fakeError),
      },
    };
    vi.mocked(getContainer).mockResolvedValueOnce(containerMock as never);

    const r = await salvarRetornoDiarioAction(
      fdRetorno({ fechar: true, qtdSujo: 3 }),
    );

    // CRUCIAL: mesmo sem instanceof match, o caller detecta via name/code
    // e devolve o code certo — NÃO cai em "Erro inesperado".
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inesperado');
    expect(r.code).toBe('DIVERGENCIA_DIARIA_DETECTADA');
    expect(r.error).not.toMatch(/^Erro inesperado/);
  });
});
