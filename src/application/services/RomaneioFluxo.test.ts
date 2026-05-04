import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';

// Garante que o fluxo "criar lote → ler romaneio" persiste e expõe os
// dados que /romaneio/lavanderia/[id] precisa pra renderizar a impressão.
//
// O componente da página é server-rendered e consome `detalheLote(id)`,
// que delega ao LoteLavanderiaService. Aqui validamos cada peça da
// cadeia: criação, persistência por id, carga por id, e os campos que
// a impressão usa (codigo, dataEnvio, origemNome, destinoNome, itens
// com nomeItem e totalEnviado).
describe('Fluxo Romaneio: criar lote → carregar para impressão', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
    // Estoque inicial pra permitir envio
    await c.itemService.atualizar(TEST_ITENS.toalha, {
      nome: 'Toalha',
      categoriaId: 'cat-toalha' as never,
      unidade: 'un',
      valorUnitario: 30,
      estoqueMinimo: null,
      estoqueTotal: 100,
      ativo: true,
    });
    await c.itemService.atualizar(TEST_ITENS.fronha, {
      nome: 'Fronha',
      categoriaId: 'cat-cama' as never,
      unidade: 'un',
      valorUnitario: 15,
      estoqueMinimo: null,
      estoqueTotal: 50,
      ativo: true,
    });
  });

  it('criarEnvio devolve o lote com id determinístico (consumido pelo redirect)', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
    expect(lote.id).toBeTruthy();
    expect(lote.codigo).toMatch(/^L-\d{4}-\d{3}$/);
    // O id do lote é o que a action passa pro redirect:
    //   redirect(`/romaneio/lavanderia/${lote.id}`)
  });

  it('detalheLote carrega o lote criado por id (loader que a página usa)', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [
        { itemId: TEST_ITENS.toalha, quantidade: 10 },
        { itemId: TEST_ITENS.fronha, quantidade: 6 },
      ],
    });
    const detalhe = await c.loteLavanderia.detalhe(lote.id);
    expect(detalhe).not.toBeNull();
    expect(detalhe!.lote.id).toBe(lote.id);
    expect(detalhe!.lote.codigo).toBe(lote.codigo);
  });

  it('detalhe expõe os campos consumidos pela página de romaneio', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [
        { itemId: TEST_ITENS.toalha, quantidade: 10 },
        { itemId: TEST_ITENS.fronha, quantidade: 6 },
      ],
    });
    const detalhe = await c.loteLavanderia.detalhe(lote.id);
    // Cabeçalho da impressão
    expect(detalhe!.lote.responsavel).toBe('Ana');
    expect(detalhe!.lote.dataEnvio).toBeTruthy();
    expect(detalhe!.origemNome).toBe('Depósito Teste');
    expect(detalhe!.destinoNome).toBe('Lavanderia Teste');
    // Tabela de itens
    expect(detalhe!.itens).toHaveLength(2);
    const toalha = detalhe!.itens.find((i) => i.itemId === TEST_ITENS.toalha);
    expect(toalha?.nomeItem).toBe('Toalha');
    expect(toalha?.totalEnviado).toBe(10);
    expect(toalha?.unidade).toBe('un');
    const fronha = detalhe!.itens.find((i) => i.itemId === TEST_ITENS.fronha);
    expect(fronha?.totalEnviado).toBe(6);
    // Total (peças) = 10 + 6 = 16, computado na página via reduce.
    const total = detalhe!.itens.reduce((s, i) => s + i.totalEnviado, 0);
    expect(total).toBe(16);
  });

  it('detalheLote retorna null para id inexistente (notFound na página)', async () => {
    const detalhe = await c.loteLavanderia.detalhe(
      'lote-inexistente' as never,
    );
    expect(detalhe).toBeNull();
    // Página chama notFound() — Next renderiza 404, sem crash.
  });

  it('observação do lote é preservada e disponível pra impressão', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      observacao: 'Manchas pesadas — lavar separado',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 3 }],
    });
    const detalhe = await c.loteLavanderia.detalhe(lote.id);
    expect(detalhe!.lote.observacao).toBe('Manchas pesadas — lavar separado');
  });

  it('lote encerrado mantém detalhe acessível para reimpressão', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: lote.id,
      motivo: 'perda_confirmada',
      responsavel: 'Gestor',
      reconhecimentoRisco: true,
    });
    // Romaneio histórico continua imprimível (com aviso de encerrado)
    const detalhe = await c.loteLavanderia.detalhe(lote.id);
    expect(detalhe).not.toBeNull();
    expect(detalhe!.encerrado).toBe(true);
    expect(detalhe!.itens[0]?.totalEnviado).toBe(5);
  });

  it('quando criação falha (estoque insuficiente), nenhum lote persiste', async () => {
    // Mais peças que estoque total = falha
    await expect(
      c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 999 }],
      }),
    ).rejects.toMatchObject({ code: 'ESTOQUE_INSUFICIENTE' });

    // Garantia: nenhum lote foi gravado (action não vai redirecionar
    // pra /romaneio porque erroResultado dispara antes).
    const todos = await c.lotes.listar();
    expect(todos).toHaveLength(0);
  });
});
