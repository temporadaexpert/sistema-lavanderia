import { beforeEach, describe, expect, it } from 'vitest';
import { filtrarLotesParaRomaneio } from './loteData';
import type { LoteResumo } from '@/application/services/LoteLavanderiaService';
import {
  criarContainerDeTeste,
  type ContainerDeTeste,
} from '@/testing/testContainer';
import { semearBasico, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';

// Habilita estoque suficiente pra criar vários lotes em sequência. O service
// valida estoque por item; sem isso, criarEnvio falha com ESTOQUE_INSUFICIENTE.
async function prepararEstoque(c: ContainerDeTeste, total = 1000) {
  await c.itemService.atualizar(TEST_ITENS.toalha, {
    nome: 'Toalha',
    categoriaId: 'cat-toalha' as never,
    unidade: 'un',
    valorUnitario: 30,
    estoqueMinimo: null,
    estoqueTotal: total,
    ativo: true,
  });
  await c.itemService.atualizar(TEST_ITENS.fronha, {
    nome: 'Fronha',
    categoriaId: 'cat-cama' as never,
    unidade: 'un',
    valorUnitario: 15,
    estoqueMinimo: null,
    estoqueTotal: total,
    ativo: true,
  });
}

// Cria lote num "dia BRT" específico — fixa o relógio às 12:00 UTC daquele
// dia (≈09:00 BRT), garantindo que dataEnvio caia no YYYY-MM-DD esperado
// quando o filtro converter pra timezone São Paulo.
async function criarLoteEm(
  c: ContainerDeTeste,
  diaYmd: string,
  responsavel: string,
  qtd = 5,
) {
  c.clock.set(`${diaYmd}T12:00:00.000Z`);
  return c.loteLavanderia.criarEnvio({
    origemId: TEST_LOCAIS.deposito,
    destinoId: TEST_LOCAIS.lavanderia,
    responsavel,
    itens: [{ itemId: TEST_ITENS.toalha, quantidade: qtd }],
  });
}

describe('filtrarLotesParaRomaneio', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
    await prepararEstoque(c);
  });

  it('sem filtros retorna todos os lotes ordenados do mais novo pro mais antigo', async () => {
    await criarLoteEm(c, '2026-04-10', 'Ana');
    await criarLoteEm(c, '2026-04-12', 'Bruno');
    await criarLoteEm(c, '2026-04-11', 'Ana');

    const todos = await c.loteLavanderia.listar();
    const filtrados = filtrarLotesParaRomaneio(todos, {});

    expect(filtrados).toHaveLength(3);
    // Mais recente primeiro — usa ISO de dataEnvio (lexicograficamente ordenável)
    expect(filtrados[0]?.lote.dataEnvio.startsWith('2026-04-12')).toBe(true);
    expect(filtrados[1]?.lote.dataEnvio.startsWith('2026-04-11')).toBe(true);
    expect(filtrados[2]?.lote.dataEnvio.startsWith('2026-04-10')).toBe(true);
  });

  it('busca por data exata (inicial=final) retorna apenas o lote daquele dia', async () => {
    await criarLoteEm(c, '2026-04-10', 'Ana');
    await criarLoteEm(c, '2026-04-12', 'Bruno');
    await criarLoteEm(c, '2026-04-15', 'Ana');

    const todos = await c.loteLavanderia.listar();
    const filtrados = filtrarLotesParaRomaneio(todos, {
      dataInicial: '2026-04-12',
      dataFinal: '2026-04-12',
    });

    expect(filtrados).toHaveLength(1);
    expect(filtrados[0]?.lote.responsavel).toBe('Bruno');
  });

  it('busca por intervalo de datas retorna apenas os lotes do período', async () => {
    await criarLoteEm(c, '2026-04-10', 'Ana');
    await criarLoteEm(c, '2026-04-12', 'Bruno');
    await criarLoteEm(c, '2026-04-15', 'Carla');
    await criarLoteEm(c, '2026-04-20', 'Diego');

    const todos = await c.loteLavanderia.listar();
    const filtrados = filtrarLotesParaRomaneio(todos, {
      dataInicial: '2026-04-12',
      dataFinal: '2026-04-15',
    });

    expect(filtrados).toHaveLength(2);
    const responsaveis = filtrados.map((r) => r.lote.responsavel).sort();
    expect(responsaveis).toEqual(['Bruno', 'Carla']);
  });

  it('intervalo é inclusivo nas duas pontas', async () => {
    await criarLoteEm(c, '2026-04-10', 'Ana');
    await criarLoteEm(c, '2026-04-15', 'Carla');

    const todos = await c.loteLavanderia.listar();
    const filtrados = filtrarLotesParaRomaneio(todos, {
      dataInicial: '2026-04-10',
      dataFinal: '2026-04-15',
    });

    expect(filtrados).toHaveLength(2);
  });

  it('filtra por data em timezone São Paulo (não UTC)', async () => {
    // 2026-04-15T02:00:00Z = 2026-04-14 23:00 em America/Sao_Paulo (BRT, UTC-3).
    // Com timezone correto, esse lote pertence ao dia 14, não 15.
    c.clock.set('2026-04-15T02:00:00.000Z');
    await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'NoiteAna',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 3 }],
    });
    // Outro lote claramente no dia 15 BRT
    await criarLoteEm(c, '2026-04-15', 'DiaCarla');

    const todos = await c.loteLavanderia.listar();
    const filtroDia14 = filtrarLotesParaRomaneio(todos, {
      dataInicial: '2026-04-14',
      dataFinal: '2026-04-14',
    });
    const filtroDia15 = filtrarLotesParaRomaneio(todos, {
      dataInicial: '2026-04-15',
      dataFinal: '2026-04-15',
    });

    expect(filtroDia14.map((r) => r.lote.responsavel)).toEqual(['NoiteAna']);
    expect(filtroDia15.map((r) => r.lote.responsavel)).toEqual(['DiaCarla']);
  });

  it('status=aberto exclui lotes encerrados', async () => {
    const loteA = await criarLoteEm(c, '2026-04-10', 'Ana');
    await criarLoteEm(c, '2026-04-12', 'Bruno');
    await c.loteLavanderia.encerrarComPendencia({
      loteId: loteA.id,
      motivo: 'perda_confirmada',
      responsavel: 'Gestor',
      reconhecimentoRisco: true,
    });

    const todos = await c.loteLavanderia.listar();
    const filtrados = filtrarLotesParaRomaneio(todos, { status: 'aberto' });

    expect(filtrados).toHaveLength(1);
    expect(filtrados[0]?.lote.responsavel).toBe('Bruno');
    expect(filtrados[0]?.encerrado).toBe(false);
  });

  it('status=encerrado mostra apenas lotes encerrados', async () => {
    const loteA = await criarLoteEm(c, '2026-04-10', 'Ana');
    await criarLoteEm(c, '2026-04-12', 'Bruno');
    await c.loteLavanderia.encerrarComPendencia({
      loteId: loteA.id,
      motivo: 'perda_confirmada',
      responsavel: 'Gestor',
      reconhecimentoRisco: true,
    });

    const todos = await c.loteLavanderia.listar();
    const filtrados = filtrarLotesParaRomaneio(todos, { status: 'encerrado' });

    expect(filtrados).toHaveLength(1);
    expect(filtrados[0]?.lote.responsavel).toBe('Ana');
    expect(filtrados[0]?.encerrado).toBe(true);
  });

  it('status=todos (default) inclui abertos e encerrados', async () => {
    const loteA = await criarLoteEm(c, '2026-04-10', 'Ana');
    await criarLoteEm(c, '2026-04-12', 'Bruno');
    await c.loteLavanderia.encerrarComPendencia({
      loteId: loteA.id,
      motivo: 'perda_confirmada',
      responsavel: 'Gestor',
      reconhecimentoRisco: true,
    });

    const todos = await c.loteLavanderia.listar();
    const filtrados = filtrarLotesParaRomaneio(todos, { status: 'todos' });

    expect(filtrados).toHaveLength(2);
  });

  it('responsável faz match case-insensitive de substring', async () => {
    await criarLoteEm(c, '2026-04-10', 'Ana Souza');
    await criarLoteEm(c, '2026-04-11', 'Bruno Lima');
    await criarLoteEm(c, '2026-04-12', 'Ana Pereira');

    const todos = await c.loteLavanderia.listar();
    const apenasAna = filtrarLotesParaRomaneio(todos, { responsavel: 'ana' });
    expect(apenasAna).toHaveLength(2);

    const apenasLima = filtrarLotesParaRomaneio(todos, { responsavel: 'LIMA' });
    expect(apenasLima).toHaveLength(1);
    expect(apenasLima[0]?.lote.responsavel).toBe('Bruno Lima');
  });

  it('responsável vazio ou só espaços é ignorado', async () => {
    await criarLoteEm(c, '2026-04-10', 'Ana');
    await criarLoteEm(c, '2026-04-11', 'Bruno');

    const todos = await c.loteLavanderia.listar();
    expect(filtrarLotesParaRomaneio(todos, { responsavel: '' })).toHaveLength(2);
    expect(filtrarLotesParaRomaneio(todos, { responsavel: '   ' })).toHaveLength(2);
  });

  it('combina filtros (data + status + responsável)', async () => {
    const loteA = await criarLoteEm(c, '2026-04-10', 'Ana');
    await criarLoteEm(c, '2026-04-12', 'Ana');
    await criarLoteEm(c, '2026-04-12', 'Bruno');
    await criarLoteEm(c, '2026-04-15', 'Ana');
    await c.loteLavanderia.encerrarComPendencia({
      loteId: loteA.id,
      motivo: 'perda_confirmada',
      responsavel: 'Gestor',
      reconhecimentoRisco: true,
    });

    const todos = await c.loteLavanderia.listar();
    const filtrados = filtrarLotesParaRomaneio(todos, {
      dataInicial: '2026-04-12',
      dataFinal: '2026-04-15',
      status: 'aberto',
      responsavel: 'Ana',
    });

    // Ana, abertos, no intervalo → 12 e 15
    expect(filtrados).toHaveLength(2);
    expect(
      filtrados.every((r) => r.lote.responsavel === 'Ana' && !r.encerrado),
    ).toBe(true);
  });

  it('lista vazia → resultado vazio (sem crash)', () => {
    const filtrados = filtrarLotesParaRomaneio([] as readonly LoteResumo[], {
      dataInicial: '2026-04-10',
      dataFinal: '2026-04-15',
      status: 'aberto',
      responsavel: 'qualquer',
    });
    expect(filtrados).toEqual([]);
  });

  it('reimpressão (releitura) é apenas leitura: não altera lotes nem movimentações', async () => {
    const lote = await criarLoteEm(c, '2026-04-10', 'Ana');

    const lotesAntes = await c.lotes.listar();
    const movsAntes = await c.movimentacoes.listar();
    const resumoAntes = await c.loteLavanderia.listar();

    // Simula reimprimir várias vezes — exatamente o que /romaneio/lavanderia/[id] faz.
    for (let i = 0; i < 5; i++) {
      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe).not.toBeNull();
      // E o filtro que a página /admin/romaneios-lavanderia roda
      filtrarLotesParaRomaneio(await c.loteLavanderia.listar(), {
        dataInicial: '2026-04-10',
        dataFinal: '2026-04-10',
      });
    }

    const lotesDepois = await c.lotes.listar();
    const movsDepois = await c.movimentacoes.listar();
    const resumoDepois = await c.loteLavanderia.listar();

    expect(lotesDepois).toEqual(lotesAntes);
    expect(movsDepois).toEqual(movsAntes);
    expect(resumoDepois).toEqual(resumoAntes);
  });
});
