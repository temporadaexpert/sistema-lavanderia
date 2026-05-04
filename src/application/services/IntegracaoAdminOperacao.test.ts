import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_CATEGORIAS, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';

// Cobre os contratos que mantém a operação sincronizada com o admin:
//   - Cadastro/edição no admin deve refletir imediatamente na lista operacional
//   - Inativação remove do fluxo operacional novo, mas NÃO apaga histórico
//   - Histórico continua resolvendo nome mesmo com item/local inativos
//
// Os dois últimos pontos são o racional por trás das funções
// `listarItensTodos`/`listarLocaisTodos` em `_lib/data.ts`: operação usa
// `apenasAtivos: true` para selectors e saldo, mas o histórico passa pelo
// catálogo completo para conseguir traduzir IDs em nomes.
describe('Integração admin ↔ operação', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
  });

  // --- Materiais ---

  it('material ativo aparece no catálogo operacional (apenasAtivos)', async () => {
    const ativos = await c.itens.listar({ apenasAtivos: true });
    expect(ativos.map((i) => i.id)).toContain(TEST_ITENS.toalha);
  });

  it('material inativo NÃO aparece no catálogo operacional', async () => {
    await c.itemService.alternarAtivo(TEST_ITENS.toalha);
    const ativos = await c.itens.listar({ apenasAtivos: true });
    expect(ativos.map((i) => i.id)).not.toContain(TEST_ITENS.toalha);
  });

  it('material inativo CONTINUA aparecendo em listar() completo', async () => {
    await c.itemService.alternarAtivo(TEST_ITENS.toalha);
    const todos = await c.itens.listar();
    expect(todos.map((i) => i.id)).toContain(TEST_ITENS.toalha);
  });

  it('edição de nome no admin reflete na listagem operacional', async () => {
    await c.itemService.atualizar(TEST_ITENS.toalha, {
      nome: 'Toalha banho G',
      categoriaId: TEST_CATEGORIAS.toalha,
      unidade: 'un',
      valorUnitario: 30,
      estoqueMinimo: 10,
      estoqueTotal: null,
      ativo: true,
    });
    const ativos = await c.itens.listar({ apenasAtivos: true });
    const toalha = ativos.find((i) => i.id === TEST_ITENS.toalha);
    expect(toalha?.nome).toBe('Toalha banho G');
  });

  // --- Locais ---

  it('local ativo aparece na listagem operacional', async () => {
    const ativos = await c.locais.listar({ apenasAtivos: true });
    expect(ativos.map((l) => l.id)).toContain(TEST_LOCAIS.lavanderia);
  });

  it('local inativo NÃO aparece na listagem operacional', async () => {
    await c.localService.alternarAtivo(TEST_LOCAIS.lavanderia);
    const ativos = await c.locais.listar({ apenasAtivos: true });
    expect(ativos.map((l) => l.id)).not.toContain(TEST_LOCAIS.lavanderia);
  });

  it('local inativo CONTINUA na listagem completa', async () => {
    await c.localService.alternarAtivo(TEST_LOCAIS.lavanderia);
    const todos = await c.locais.listar();
    expect(todos.map((l) => l.id)).toContain(TEST_LOCAIS.lavanderia);
  });

  it('edição de nome do local reflete na listagem operacional', async () => {
    await c.localService.atualizar(TEST_LOCAIS.lavanderia, {
      nome: 'Lavanderia XYZ',
      tipo: 'lavanderia',
      ativo: true,
    });
    const ativos = await c.locais.listar({ apenasAtivos: true });
    const lav = ativos.find((l) => l.id === TEST_LOCAIS.lavanderia);
    expect(lav?.nome).toBe('Lavanderia XYZ');
  });

  // --- Histórico legível com item inativo ---

  it('histórico continua resolvendo nome mesmo quando material foi inativado', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 10,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
    // Admin inativa o material
    await c.itemService.alternarAtivo(TEST_ITENS.toalha);

    // Catálogo completo (como `listarItensTodos`) é o que a tela de histórico
    // deve consumir pra traduzir o itemId em nome — mesmo inativo.
    const catalogo = await c.itens.listar();
    const nomePorId = new Map(catalogo.map((i) => [i.id, i.nome]));
    expect(nomePorId.get(TEST_ITENS.toalha)).toBe('Toalha');

    // Confirmação de que o filtro operacional realmente não traria esse item:
    const ativos = await c.itens.listar({ apenasAtivos: true });
    expect(ativos.map((i) => i.id)).not.toContain(TEST_ITENS.toalha);
  });

  it('histórico continua resolvendo nome mesmo quando local foi inativado', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 10,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 5,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'T',
    });
    // Admin inativa o imóvel depois do lançamento
    await c.localService.alternarAtivo(TEST_LOCAIS.imovel);

    const catalogo = await c.locais.listar();
    const nomePorId = new Map(catalogo.map((l) => [l.id, l.nome]));
    expect(nomePorId.get(TEST_LOCAIS.imovel)).toBe('Imóvel Teste');

    const ativos = await c.locais.listar({ apenasAtivos: true });
    expect(ativos.map((l) => l.id)).not.toContain(TEST_LOCAIS.imovel);
  });

  // --- Proteção: não dá pra registrar com item inativo ---

  it('operação rejeita registrar movimentação com material inativo', async () => {
    await c.itemService.alternarAtivo(TEST_ITENS.toalha);
    await expect(
      c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 5,
        tipo: 'entrada_deposito',
        origemId: null,
        destinoId: TEST_LOCAIS.deposito,
        responsavel: 'T',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  // --- Relatório do lote preserva nome via serviço ---

  it('detalhe do lote resolve nomeItem mesmo após inativar o material', async () => {
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 100,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 20 }],
    });
    // Só agora inativa o material — envio já rolou
    await c.itemService.alternarAtivo(TEST_ITENS.toalha);

    const detalhe = await c.loteLavanderia.detalhe(lote.id);
    expect(detalhe).not.toBeNull();
    const linha = detalhe!.itens.find((i) => i.itemId === TEST_ITENS.toalha);
    expect(linha?.nomeItem).toBe('Toalha'); // nome preservado, não UUID
  });
});
