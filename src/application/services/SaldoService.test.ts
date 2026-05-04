import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_CATEGORIAS, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';

describe('SaldoService', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 100,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
  });

  it('saldoDe soma destino e subtrai origem', async () => {
    const saldoInicial = await c.saldoService.saldoDe(TEST_ITENS.toalha, TEST_LOCAIS.deposito);
    expect(saldoInicial).toBe(100);

    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 30,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'T',
    });

    expect(await c.saldoService.saldoDe(TEST_ITENS.toalha, TEST_LOCAIS.deposito)).toBe(70);
    expect(await c.saldoService.saldoDe(TEST_ITENS.toalha, TEST_LOCAIS.imovel)).toBe(30);
  });

  it('saldoPorItemNoLocal retorna todos os itens com saldo no local', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.fronha,
      quantidade: 50,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'T',
    });
    const saldos = await c.saldoService.saldoPorItemNoLocal(TEST_LOCAIS.deposito);
    expect(saldos).toHaveLength(2);
    expect(saldos.find((s) => s.itemId === TEST_ITENS.toalha)?.quantidade).toBe(100);
    expect(saldos.find((s) => s.itemId === TEST_ITENS.fronha)?.quantidade).toBe(50);
  });

  it('saldoPorLocalDoItem retorna locais onde o item tem saldo não-zero', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 30,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'T',
    });
    const saldos = await c.saldoService.saldoPorLocalDoItem(TEST_ITENS.toalha);
    expect(saldos.find((s) => s.localId === TEST_LOCAIS.deposito)?.quantidade).toBe(70);
    expect(saldos.find((s) => s.localId === TEST_LOCAIS.imovel)?.quantidade).toBe(30);
    // Lavanderia não deve aparecer (sem movimentação)
    expect(saldos.find((s) => s.localId === TEST_LOCAIS.lavanderia)).toBeUndefined();
  });

  it('filtra corretamente por ateDataHora (saldo "histórico")', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 30,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'T',
      dataHora: '2026-02-01T10:00:00.000Z',
    });
    // Saldo antes da saída: 100 (seed foi em 2026-01-01)
    const antes = await c.saldoService.saldoDe(
      TEST_ITENS.toalha,
      TEST_LOCAIS.deposito,
      '2026-01-15T00:00:00.000Z',
    );
    expect(antes).toBe(100);
    // Saldo atual: 70
    const agora = await c.saldoService.saldoDe(TEST_ITENS.toalha, TEST_LOCAIS.deposito);
    expect(agora).toBe(70);
  });

  it('discrepanciaLavanderia calcula enviado − retornado por item', async () => {
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
    const discr = await c.saldoService.discrepanciaLavanderia();
    const toalha = discr.find((d) => d.itemId === TEST_ITENS.toalha);
    expect(toalha?.totalEnviado).toBe(20);
    expect(toalha?.totalRetornado).toBe(18);
    expect(toalha?.diferenca).toBe(2);
  });

  it('saldoGlobal devolve todas as combinações item × local com saldo ≠ 0', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 30,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'T',
    });
    const global = await c.saldoService.saldoGlobal();
    expect(global).toHaveLength(2);
    const soma = global.reduce((s, e) => s + e.quantidade, 0);
    expect(soma).toBe(100); // total conservado: 70 depósito + 30 imóvel
  });

  it('saldoGlobal ignora movimentações canceladas', async () => {
    const mov = await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 25,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'T',
    });
    // Saldo reflete a saída: depósito 75, imóvel 25 → 2 linhas, soma 100
    const antes = await c.saldoService.saldoGlobal();
    expect(antes).toHaveLength(2);

    await c.movimentacaoService.cancelar({
      id: mov.id,
      motivo: 'saída errada',
      responsavel: 'Gestor',
    });
    // Após cancelar: só depósito 100
    const depois = await c.saldoService.saldoGlobal();
    expect(depois).toHaveLength(1);
    expect(depois[0]?.quantidade).toBe(100);
  });

  describe('disponibilidadeDoItem (novo modelo estoqueTotal)', () => {
    it('retorna null quando item não existe', async () => {
      const r = await c.saldoService.disponibilidadeDoItem(
        'inexistente' as typeof TEST_ITENS.toalha,
      );
      expect(r).toBeNull();
    });

    it('item sem estoqueTotal → disponivel=null, sem alerta', async () => {
      const r = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
      expect(r?.estoqueTotal).toBeNull();
      expect(r?.disponivel).toBeNull();
      expect(r?.emImoveis).toBe(0);
      expect(r?.emLavanderia).toBe(0);
      expect(r?.alertaNegativo).toBe(false);
    });

    it('quando admin define estoqueTotal, calcula buckets corretamente', async () => {
      await c.itemService.atualizar(TEST_ITENS.toalha, {
        nome: 'Toalha',
        categoriaId: TEST_CATEGORIAS.toalha,
        unidade: 'un',
        valorUnitario: 30,
        estoqueMinimo: 10,
        estoqueTotal: 100,
        ativo: true,
      });
      // 20 foram pra um imóvel
      await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 20,
        tipo: 'saida_imovel',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.imovel,
        responsavel: 'T',
      });
      // 15 foram pra lavanderia
      await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 15,
        tipo: 'envio_lavanderia',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
      });
      const r = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
      expect(r?.estoqueTotal).toBe(100);
      expect(r?.emImoveis).toBe(20);
      expect(r?.emLavanderia).toBe(15);
      expect(r?.disponivel).toBe(65); // 100 - 20 - 15
      expect(r?.disponivelEfetivo).toBe(65);
      expect(r?.alertaNegativo).toBe(false);
    });

    it('retorno de imóvel/lavanderia devolve peças aos buckets', async () => {
      await c.itemService.atualizar(TEST_ITENS.toalha, {
        nome: 'Toalha',
        categoriaId: TEST_CATEGORIAS.toalha,
        unidade: 'un',
        valorUnitario: 30,
        estoqueMinimo: null,
        estoqueTotal: 50,
        ativo: true,
      });
      await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 10,
        tipo: 'saida_imovel',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.imovel,
        responsavel: 'T',
      });
      await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 8,
        tipo: 'retorno_imovel',
        origemId: TEST_LOCAIS.imovel,
        destinoId: TEST_LOCAIS.deposito,
        responsavel: 'T',
      });
      const r = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
      expect(r?.emImoveis).toBe(2); // 10 - 8
      expect(r?.disponivel).toBe(48);
    });

    it('alertaNegativo quando admin baixa o total para menos que já está fora', async () => {
      // Simula o caso real: primeiro ocorreu a saída (quando o item não
      // tinha estoqueTotal e a validação era por saldo legacy, com 100
      // entrada_deposito no beforeEach). Depois o admin define/reduz
      // estoqueTotal abaixo do que já está fora → disponivel fica
      // negativo e alertaNegativo dispara.
      await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 30,
        tipo: 'saida_imovel',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.imovel,
        responsavel: 'T',
      });
      await c.itemService.atualizar(TEST_ITENS.toalha, {
        nome: 'Toalha',
        categoriaId: TEST_CATEGORIAS.toalha,
        unidade: 'un',
        valorUnitario: 30,
        estoqueMinimo: null,
        estoqueTotal: 10,
        ativo: true,
      });
      const r = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
      expect(r?.alertaNegativo).toBe(true);
      expect(r?.disponivel).toBe(-20);
      expect(r?.disponivelEfetivo).toBe(0);
    });

    it('abaixoMinimo quando disponivel < estoqueMinimo', async () => {
      await c.itemService.atualizar(TEST_ITENS.toalha, {
        nome: 'Toalha',
        categoriaId: TEST_CATEGORIAS.toalha,
        unidade: 'un',
        valorUnitario: 30,
        estoqueMinimo: 20,
        estoqueTotal: 50,
        ativo: true,
      });
      await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 35,
        tipo: 'saida_imovel',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.imovel,
        responsavel: 'T',
      });
      const r = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
      expect(r?.disponivel).toBe(15);
      expect(r?.abaixoMinimo).toBe(true);
    });

    it('disponibilidadeDeTodos retorna todos os itens ativos', async () => {
      const r = await c.saldoService.disponibilidadeDeTodos({ apenasAtivos: true });
      expect(r.map((i) => i.itemId).sort()).toEqual(
        [TEST_ITENS.toalha, TEST_ITENS.fronha, TEST_ITENS.semPreco].sort(),
      );
    });
  });

  describe('garantirEstoqueParaSaida (validação de envio)', () => {
    // Isolamento do beforeEach: estes testes criam seus próprios cenários
    // sem assumir os 100 toalhas de entrada_deposito.

    it('item com estoqueTotal=10 sem movs prévias: envia 4 → ok', async () => {
      c = criarContainerDeTeste();
      await semearBasico(c);
      await c.itemService.atualizar(TEST_ITENS.toalha, {
        nome: 'Toalha',
        categoriaId: TEST_CATEGORIAS.toalha,
        unidade: 'un',
        valorUnitario: 30,
        estoqueMinimo: null,
        estoqueTotal: 10,
        ativo: true,
      });

      await expect(
        c.saldoService.garantirEstoqueParaSaida(
          TEST_ITENS.toalha,
          TEST_LOCAIS.deposito,
          4,
        ),
      ).resolves.toBeUndefined();

      // Realiza o envio de verdade e confirma que disponibilidade caiu
      await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 4,
        tipo: 'envio_lavanderia',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
      });
      const disp = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
      expect(disp?.disponivel).toBe(6); // 10 - 4
      expect(disp?.emLavanderia).toBe(4);
    });

    it('item com estoqueTotal=3: envio de 4 → erro amigável com NOME do item', async () => {
      c = criarContainerDeTeste();
      await semearBasico(c);
      await c.itemService.atualizar(TEST_ITENS.toalha, {
        nome: 'Toalha',
        categoriaId: TEST_CATEGORIAS.toalha,
        unidade: 'un',
        valorUnitario: 30,
        estoqueMinimo: null,
        estoqueTotal: 3,
        ativo: true,
      });

      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 4,
          tipo: 'envio_lavanderia',
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
        }),
      ).rejects.toMatchObject({
        code: 'ESTOQUE_INSUFICIENTE',
        // Usa nome, não id técnico
        message: expect.stringContaining('Toalha'),
      });
    });

    it('item com estoqueTotal=null mantém comportamento legacy (soma entrada/saída)', async () => {
      c = criarContainerDeTeste();
      await semearBasico(c);
      // Fronha no testSeed tem estoqueTotal: null → modo legacy
      // Sem entrada_deposito prévia → saldoDe = 0 → rejeita
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.fronha,
          quantidade: 5,
          tipo: 'envio_lavanderia',
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
        }),
      ).rejects.toMatchObject({ code: 'ESTOQUE_INSUFICIENTE' });

      // Com entrada prévia, passa
      await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.fronha,
        quantidade: 10,
        tipo: 'entrada_deposito',
        origemId: null,
        destinoId: TEST_LOCAIS.deposito,
        responsavel: 'T',
      });
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.fronha,
          quantidade: 5,
          tipo: 'envio_lavanderia',
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
        }),
      ).resolves.toBeDefined();
    });

    it('criarEnvio bloqueia se QUALQUER linha exceder disponibilidade e NÃO cria lote', async () => {
      c = criarContainerDeTeste();
      await semearBasico(c);
      await c.itemService.atualizar(TEST_ITENS.toalha, {
        nome: 'Toalha',
        categoriaId: TEST_CATEGORIAS.toalha,
        unidade: 'un',
        valorUnitario: 30,
        estoqueMinimo: null,
        estoqueTotal: 20,
        ativo: true,
      });
      await c.itemService.atualizar(TEST_ITENS.fronha, {
        nome: 'Fronha',
        categoriaId: TEST_CATEGORIAS.cama,
        unidade: 'un',
        valorUnitario: 15,
        estoqueMinimo: null,
        estoqueTotal: 2, // só 2!
        ativo: true,
      });

      // Toalha ok (5 ≤ 20), fronha estoura (5 > 2) → rejeita e nada criado
      await expect(
        c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [
            { itemId: TEST_ITENS.toalha, quantidade: 5 },
            { itemId: TEST_ITENS.fronha, quantidade: 5 },
          ],
        }),
      ).rejects.toMatchObject({
        code: 'ESTOQUE_INSUFICIENTE',
        message: expect.stringContaining('Fronha'),
      });

      // Nenhum lote criado
      expect(await c.lotes.listar()).toHaveLength(0);
      // Nenhuma movimentação envio_lavanderia criada
      const movs = await c.movimentacoes.listar({ tipo: 'envio_lavanderia' });
      expect(movs).toHaveLength(0);
    });
  });
});
