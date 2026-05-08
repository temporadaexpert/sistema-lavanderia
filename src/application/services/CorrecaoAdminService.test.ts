import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';
import {
  NotFoundError,
  ValidationError,
} from '@/domain/errors/DomainErrors';
import { LoteId, MovimentacaoId } from '@/domain/types/ids';

describe('CorrecaoAdminService', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
    // Estoque base no depósito.
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 200,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.fronha,
      quantidade: 100,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
  });

  // ===========================================================================
  // 1. Corrigir envio para lavanderia REDUZINDO quantidade
  // ===========================================================================
  it('cenário 1: corrige envio reduzindo quantidade (50→40), saldo recalcula', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 50 }],
    });

    await c.correcaoAdmin.corrigirEnvioLavanderia({
      loteId: lote.id,
      itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 40 }],
      motivo: 'operadora digitou 50 mas eram 40',
      adminResponsavel: 'Gestor Admin',
      confirmacaoCorrecaoGrande: true,
    });

    // Saldo lavanderia agora é 40 (não 50)
    const disp = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
    expect(disp!.emLavanderia).toBe(40);

    // Lote reflete totalEnviado=40
    const det = await c.loteLavanderia.detalhe(lote.id);
    expect(det!.totalEnviado).toBe(40);
    expect(det!.itens[0]!.totalEnviado).toBe(40);

    // Auditoria registrada
    const correcoes = await c.correcoes.listar();
    expect(correcoes).toHaveLength(1);
    expect(correcoes[0]!.tipoBloco).toBe('envio_lavanderia');
    expect(correcoes[0]!.quantidadeAnterior).toBe(50);
    expect(correcoes[0]!.quantidadeNova).toBe(40);
    expect(correcoes[0]!.diferenca).toBe(-10);
  });

  // ===========================================================================
  // 2. Corrigir envio para lavanderia AUMENTANDO quantidade
  // ===========================================================================
  it('cenário 2: corrige envio aumentando quantidade (40→50), valida saldo do depósito', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 40 }],
    });

    await c.correcaoAdmin.corrigirEnvioLavanderia({
      loteId: lote.id,
      itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 50 }],
      motivo: 'recontagem mostrou 50 (não 40)',
      adminResponsavel: 'Gestor Admin',
      confirmacaoCorrecaoGrande: true,
    });

    const det = await c.loteLavanderia.detalhe(lote.id);
    expect(det!.totalEnviado).toBe(50);
    const disp = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
    expect(disp!.emLavanderia).toBe(50);
  });

  // ===========================================================================
  // 3. Corrigir retorno da lavanderia REDUZINDO
  // ===========================================================================
  it('cenário 3: corrige retorno reduzindo (27→25)', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });
    // Sobra física pra permitir retorno=27 quando pendência=30
    const r1 = await c.loteLavanderia.registrarRetornoEFinalizar({
      loteId: lote.id,
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 27 }],
      classificacao: 'retorno_parcial',
    });
    const operacaoId = (await c.movimentacoes.listar({
      tipo: 'retorno_lavanderia',
    }))[0]!.operacaoId!;
    expect(operacaoId).toBeTruthy();
    expect(r1.status).toBe('registrado_parcial');

    await c.correcaoAdmin.corrigirRetornoLavanderia({
      operacaoId,
      itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 25 }],
      motivo: 'recontagem: voltaram 25, não 27',
      adminResponsavel: 'Gestor Admin',
    });

    const det = await c.loteLavanderia.detalhe(lote.id);
    expect(det!.totalRetornado).toBe(25); // movs canceladas saem da projeção
    expect(det!.pendenciaTotal).toBe(5); // 30 - 25
  });

  // ===========================================================================
  // 4. Corrigir retorno aumentando
  // ===========================================================================
  it('cenário 4: corrige retorno aumentando (25→27), saldo lavanderia diminui', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
    });
    await c.loteLavanderia.registrarRetornoEFinalizar({
      loteId: lote.id,
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 25 }],
      classificacao: 'retorno_parcial',
    });
    const operacaoId = (await c.movimentacoes.listar({
      tipo: 'retorno_lavanderia',
    }))[0]!.operacaoId!;

    await c.correcaoAdmin.corrigirRetornoLavanderia({
      operacaoId,
      itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 27 }],
      motivo: 'recontagem: voltaram 27, não 25',
      adminResponsavel: 'Gestor Admin',
    });

    const det = await c.loteLavanderia.detalhe(lote.id);
    expect(det!.totalRetornado).toBe(27);
    const disp = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
    expect(disp!.emLavanderia).toBe(3); // 30 - 27
  });

  // ===========================================================================
  // 5. Corrigir retorno que teve REDISTRIBUIÇÃO CROSS-LOTE
  // ===========================================================================
  it('cenário 5: correção de retorno cross-lote restaura pendência do anterior', async () => {
    c.clock.set('2026-04-25T10:00:00.000Z');
    const ant = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      dataEnvio: '2026-04-20T12:00:00.000Z',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
    await c.loteLavanderia.registrarRetorno({
      loteId: ant.id,
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 3 }],
    });
    const atual = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      dataEnvio: '2026-04-25T12:00:00.000Z',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 25 }],
    });

    // Operação cross-lote: 27 → 25 atual + 2 anterior
    await c.loteLavanderia.registrarRetornoEFinalizar({
      loteId: atual.id,
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 27 }],
    });

    // Pega o operacaoId da operação que acabou de criar 2 movs
    // (vão estar com mesmo operacao_id, distinto do retorno isolado anterior)
    const todasRetornos = await c.movimentacoes.listar({
      tipo: 'retorno_lavanderia',
    });
    const grupos = new Map<string, number>();
    for (const m of todasRetornos) {
      if (!m.operacaoId) continue;
      grupos.set(m.operacaoId, (grupos.get(m.operacaoId) ?? 0) + 1);
    }
    // Operação nova tem 2 movs (cross-lote); a anterior solta tem 0 operacaoId.
    const operacaoCross = Array.from(grupos.entries()).find(([, n]) => n === 2)?.[0];
    expect(operacaoCross).toBeTruthy();

    // Corrige pra 24: cancela ambas as movs cross-lote, regrava 24 no atual
    await c.correcaoAdmin.corrigirRetornoLavanderia({
      operacaoId: operacaoCross!,
      itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 24 }],
      motivo: 'recontagem da operação cross-lote',
      adminResponsavel: 'Gestor Admin',
    });

    // Lote anterior: pendência VOLTA pra 2 (mov de retorno cross-lote
    // pra ele foi cancelada pela correção)
    const detAnt = await c.loteLavanderia.detalhe(ant.id);
    expect(detAnt!.pendenciaEfetiva).toBe(2);
    expect(detAnt!.totalRetornado).toBe(3); // só o retorno isolado original

    // Lote atual: nova mov de 24 substitui as 25 + 2 cross-lote
    const detAtual = await c.loteLavanderia.detalhe(atual.id);
    expect(detAtual!.totalRetornado).toBe(24);
    expect(detAtual!.pendenciaTotal).toBe(1); // 25 - 24
  });

  // ===========================================================================
  // 6. Corrigir retorno que gerou EXCEDENTE NÃO CONCILIADO
  // ===========================================================================
  it('cenário 6: correção remove excedente não conciliado prévio', async () => {
    // Sobra física pra excedente
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 5,
      tipo: 'ajuste',
      origemId: null,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Gestor',
    });
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 25 }],
    });
    // Operação que gera excedente: 27 com pendência total = 25
    await c.loteLavanderia.registrarRetornoEFinalizar({
      loteId: lote.id,
      responsavel: 'Bruno',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 27 }],
    });
    const movsRet = await c.movimentacoes.listar({ tipo: 'retorno_lavanderia' });
    const naoConcAntes = movsRet.filter((m) => !m.conciliado);
    expect(naoConcAntes).toHaveLength(1); // 1 mov excedente
    const operacaoId = movsRet[0]!.operacaoId!;

    // Correção: 27 → 25 (sem excedente)
    await c.correcaoAdmin.corrigirRetornoLavanderia({
      operacaoId,
      itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 25 }],
      motivo: 'sobra era erro de contagem',
      adminResponsavel: 'Gestor Admin',
    });

    // Excedente não conciliado some das projeções (mov cancelada)
    const movsAtivas = await c.movimentacoes.listar({ tipo: 'retorno_lavanderia' });
    expect(movsAtivas.filter((m) => !m.conciliado)).toHaveLength(0);
    const det = await c.loteLavanderia.detalhe(lote.id);
    expect(det!.totalRetornado).toBe(25);
  });

  // ===========================================================================
  // 7. Corrigir envio para unidade/casa
  // ===========================================================================
  it('cenário 7: corrige saída_imovel (10→8), saldos ajustam', async () => {
    const mov = await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 10,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'Ana',
    });

    await c.correcaoAdmin.corrigirMovimentacaoSimples({
      movId: mov.id,
      quantidadeNova: 8,
      motivo: 'recontagem: 8 toalhas, não 10',
      adminResponsavel: 'Gestor Admin',
    });

    const disp = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
    expect(disp!.emImoveis).toBe(8); // não 10
    // Saldo do depósito recupera 2 unidades
    const saldoDep = await c.saldoService.saldoDe(
      TEST_ITENS.toalha,
      TEST_LOCAIS.deposito,
    );
    expect(saldoDep).toBe(200 - 8); // entrada 200 - saída 8
  });

  // ===========================================================================
  // 8. Corrigir retorno de unidade/casa
  // ===========================================================================
  it('cenário 8: corrige retorno_imovel (6→4)', async () => {
    // Cria estoque no imóvel via saída
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 10,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'Ana',
    });
    const mov = await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 6,
      tipo: 'retorno_imovel',
      origemId: TEST_LOCAIS.imovel,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Ana',
    });

    await c.correcaoAdmin.corrigirMovimentacaoSimples({
      movId: mov.id,
      quantidadeNova: 4,
      motivo: 'recontagem: 4 toalhas, não 6',
      adminResponsavel: 'Gestor Admin',
    });

    const disp = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
    // emImoveis = saída 10 - retorno 4 = 6
    expect(disp!.emImoveis).toBe(6);
  });

  // ===========================================================================
  // 9. Bloqueia quantidade negativa
  // ===========================================================================
  it('cenário 9: bloqueia quantidade negativa', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    await expect(
      c.correcaoAdmin.corrigirEnvioLavanderia({
        loteId: lote.id,
        itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: -5 }],
        motivo: 'tentativa de quantidade negativa',
        adminResponsavel: 'Gestor Admin',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // ===========================================================================
  // 10. Bloqueia correção sem motivo
  // ===========================================================================
  it('cenário 10: bloqueia correção sem motivo (ou motivo curto demais)', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    // Vazio
    await expect(
      c.correcaoAdmin.corrigirEnvioLavanderia({
        loteId: lote.id,
        itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 8 }],
        motivo: '',
        adminResponsavel: 'Gestor Admin',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Curto demais (<5 chars)
    await expect(
      c.correcaoAdmin.corrigirEnvioLavanderia({
        loteId: lote.id,
        itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 8 }],
        motivo: 'oi',
        adminResponsavel: 'Gestor Admin',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Sem admin
    await expect(
      c.correcaoAdmin.corrigirEnvioLavanderia({
        loteId: lote.id,
        itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 8 }],
        motivo: 'recontagem normal',
        adminResponsavel: '',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // ===========================================================================
  // 11. Auditoria completa antes/depois
  // ===========================================================================
  it('cenário 11: auditoria completa registra anterior, novo, diferença, ids, motivo, admin', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 50 }],
    });
    const movOriginal = (
      await c.movimentacoes.listar({ loteId: lote.id, tipo: 'envio_lavanderia' })
    )[0]!;

    await c.correcaoAdmin.corrigirEnvioLavanderia({
      loteId: lote.id,
      itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 40 }],
      motivo: 'erro de digitação detectado',
      adminResponsavel: 'Gestor Admin',
      confirmacaoCorrecaoGrande: true,
    });

    const correcoes = await c.correcoes.listar();
    expect(correcoes).toHaveLength(1);
    const corr = correcoes[0]!;
    expect(corr.tipoBloco).toBe('envio_lavanderia');
    expect(corr.itemId).toBe(TEST_ITENS.toalha);
    expect(corr.nomeItemSnapshot).toBe('Toalha');
    expect(corr.loteId).toBe(lote.id);
    expect(corr.localId).toBeNull();
    expect(corr.quantidadeAnterior).toBe(50);
    expect(corr.quantidadeNova).toBe(40);
    expect(corr.diferenca).toBe(-10);
    expect(corr.motivo).toBe('erro de digitação detectado');
    expect(corr.adminResponsavel).toBe('Gestor Admin');
    expect(corr.movsCanceladasIds).toContain(movOriginal.id);
    expect(corr.movsNovasIds).toHaveLength(1);
    expect(corr.observacaoAutomatica).toMatch(/50→40/);

    // Mov original ficou cancelada com motivo+responsável
    const movsHistorico = await c.movimentacoes.listar({
      loteId: lote.id,
      incluirCanceladas: true,
    });
    const cancelada = movsHistorico.find((m) => m.id === movOriginal.id);
    expect(cancelada?.cancelada).toBe(true);
    expect(cancelada?.canceladoPor).toBe('Gestor Admin');
    expect(cancelada?.motivoCancelamento).toMatch(/erro de digitação/);
  });

  // ===========================================================================
  // 12. Custo / impostômetro NÃO duplica (snapshot herdado, não recapturado)
  // ===========================================================================
  it('cenário 12: snapshot de preço é HERDADO da mov original (preserva financeiro histórico)', async () => {
    // Item começa com preço R$30 (do testSeed). Cria envio.
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    const movOriginal = (
      await c.movimentacoes.listar({ loteId: lote.id, tipo: 'envio_lavanderia' })
    )[0]!;
    expect(movOriginal.precoUnitarioSnapshot).toBe(30);

    // ALTERA o preço atual do cadastro para R$100 (simula reajuste posterior)
    const itemAtual = await c.itens.porId(TEST_ITENS.toalha);
    await c.itens.atualizar({ ...itemAtual!, valorUnitario: 100 });

    // Correção: 10 → 8. Se o snapshot fosse RECAPTURADO, a mov nova
    // pegaria R$100 e o relatório financeiro mudaria retroativamente.
    await c.correcaoAdmin.corrigirEnvioLavanderia({
      loteId: lote.id,
      itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 8 }],
      motivo: 'correção de quantidade após reajuste',
      adminResponsavel: 'Gestor Admin',
    });

    const movsAtivas = await c.movimentacoes.listar({
      loteId: lote.id,
      tipo: 'envio_lavanderia',
    });
    expect(movsAtivas).toHaveLength(1);
    // Mov nova deve ter o snapshot R$30 (herdado), NÃO R$100 (preço atual).
    expect(movsAtivas[0]!.quantidade).toBe(8);
    expect(movsAtivas[0]!.precoUnitarioSnapshot).toBe(30);

    // Custo: 8 * 30 = 240. Preço atual R$100 NÃO entra em nada.
    const resumo = await c.relatorioLavanderia.resumo();
    expect(resumo.custoEnviado).toBe(240);
  });

  // ===========================================================================
  // 13. Correção NÃO gera perda falsa
  // ===========================================================================
  it('cenário 13: correção não conta como perda (RelatorioPerda preservado)', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 50 }],
    });
    // Reduz envio de 50 pra 40 (10 unidades a menos)
    await c.correcaoAdmin.corrigirEnvioLavanderia({
      loteId: lote.id,
      itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 40 }],
      motivo: 'recontagem da remessa',
      adminResponsavel: 'Gestor Admin',
      confirmacaoCorrecaoGrande: true,
    });
    const perda = await c.relatorioPerda.resumo();
    expect(perda.totalPecas).toBe(0);
    expect(perda.lotesEncerrados).toBe(0);
  });

  // ===========================================================================
  // 14. Saldo final correto após correção
  // ===========================================================================
  it('cenário 14: após correção, saldo (depósito + lavanderia + imóveis) bate', async () => {
    // Estoque inicial 200 toalha (entrada_deposito do beforeEach)
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 50 }],
    });
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.toalha,
      quantidade: 30,
      tipo: 'saida_imovel',
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.imovel,
      responsavel: 'Ana',
    });

    // Correção do envio: 50 → 40
    await c.correcaoAdmin.corrigirEnvioLavanderia({
      loteId: lote.id,
      itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 40 }],
      motivo: 'erro de contagem',
      adminResponsavel: 'Gestor Admin',
      confirmacaoCorrecaoGrande: true,
    });

    // Estoque esperado: 200 entrada - 30 imóvel - 40 lavanderia = 130 depósito
    const saldoDep = await c.saldoService.saldoDe(
      TEST_ITENS.toalha,
      TEST_LOCAIS.deposito,
    );
    expect(saldoDep).toBe(130);

    const disp = await c.saldoService.disponibilidadeDoItem(TEST_ITENS.toalha);
    expect(disp!.emImoveis).toBe(30);
    expect(disp!.emLavanderia).toBe(40);
  });

  // ===========================================================================
  // Bloqueios adicionais
  // ===========================================================================
  it('rejeita correção em lote ENCERRADO (mensagem clara)', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
    });
    await c.loteLavanderia.encerrarComPendencia({
      loteId: lote.id,
      motivo: 'extravio',
      responsavel: 'Gestor',
      reconhecimentoRisco: true,
    });
    await expect(
      c.correcaoAdmin.corrigirEnvioLavanderia({
        loteId: lote.id,
        itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 5 }],
        motivo: 'tentativa em lote encerrado',
        adminResponsavel: 'Gestor Admin',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejeita correção pequena sem confirmação quando |diff| >= max(10, qtdAnterior*0.3)', async () => {
    const lote = await c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 25 }],
    });
    // 25 - 10 = 15, |diff|=15, limite=max(10, 7.5)=10. 15 >= 10 → grande.
    await expect(
      c.correcaoAdmin.corrigirEnvioLavanderia({
        loteId: lote.id,
        itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 10 }],
        motivo: 'redução grande',
        adminResponsavel: 'Gestor Admin',
        // sem confirmacaoCorrecaoGrande
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Pequena passa: 25 → 20, diff=5, limite=max(10, 7)=10. 5<10 → ok sem confirmação.
    await expect(
      c.correcaoAdmin.corrigirEnvioLavanderia({
        loteId: lote.id,
        itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 20 }],
        motivo: 'redução pequena',
        adminResponsavel: 'Gestor Admin',
      }),
    ).resolves.toBeDefined();
  });

  it('mov inexistente em corrigirMovimentacaoSimples → NotFoundError', async () => {
    await expect(
      c.correcaoAdmin.corrigirMovimentacaoSimples({
        movId: MovimentacaoId('mov-fantasma'),
        quantidadeNova: 5,
        motivo: 'tentativa em mov inexistente',
        adminResponsavel: 'Gestor Admin',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lote inexistente em corrigirEnvioLavanderia → NotFoundError', async () => {
    await expect(
      c.correcaoAdmin.corrigirEnvioLavanderia({
        loteId: LoteId('lote-fantasma'),
        itensCorrigidos: [{ itemId: TEST_ITENS.toalha, quantidadeNova: 5 }],
        motivo: 'tentativa em lote inexistente',
        adminResponsavel: 'Gestor Admin',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
