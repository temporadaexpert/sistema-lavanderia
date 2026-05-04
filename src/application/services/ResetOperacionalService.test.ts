import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';
import { ResetOperacionalError } from './ResetOperacionalService';

async function popularTudo(c: ContainerDeTeste): Promise<void> {
  // Estoque para permitir envios posteriores.
  await c.movimentacaoService.registrar({
    itemId: TEST_ITENS.toalha,
    quantidade: 100,
    tipo: 'entrada_deposito',
    origemId: null,
    destinoId: TEST_LOCAIS.deposito,
    responsavel: 'Seed',
  });
  // Lote + retorno + contato + encerramento gerando ajuste
  const lote = await c.loteLavanderia.criarEnvio({
    origemId: TEST_LOCAIS.deposito,
    destinoId: TEST_LOCAIS.lavanderia,
    responsavel: 'Ana',
    itens: [{ itemId: TEST_ITENS.toalha, quantidade: 20 }],
  });
  await c.loteLavanderia.registrarRetorno({
    loteId: lote.id,
    responsavel: 'Ana',
    itens: [{ itemId: TEST_ITENS.toalha, quantidade: 18 }],
  });
  await c.contatoLavanderiaService.registrar({
    loteId: lote.id,
    tipo: 'whatsapp',
    responsavel: 'Ana',
  });
  await c.loteLavanderia.encerrarComPendencia({
    loteId: lote.id,
    motivo: 'perda_confirmada',
    responsavel: 'Gestor',
    reconhecimentoRisco: true,
  });
  // Controle diário
  await c.controleDiario.registrarEnvio({
    data: '2026-04-10',
    responsavel: 'Depósito',
    itens: [{ itemId: TEST_ITENS.toalha, quantidade: 30 }],
  });
  await c.controleDiario.registrarRetorno({
    data: '2026-04-10',
    responsavel: 'Depósito',
    itens: [{ itemId: TEST_ITENS.toalha, recebidoSujo: 25, recebidoLimpo: 5 }],
  });
  // Ajuste manual cancelado — pra testar que contagem inclui canceladas
  const mov = await c.movimentacaoService.registrar({
    itemId: TEST_ITENS.toalha,
    quantidade: 2,
    tipo: 'ajuste',
    origemId: TEST_LOCAIS.deposito,
    destinoId: null,
    responsavel: 'Ana',
  });
  await c.movimentacaoService.cancelar({
    id: mov.id,
    motivo: 'teste',
    responsavel: 'Gestor',
  });
}

describe('ResetOperacionalService', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
  });

  it('zera os 4 repos operacionais e preserva itens e locais', async () => {
    await popularTudo(c);

    // Estado antes: tudo populado
    const antes = await c.resetOperacional.contagensAtuais();
    expect(antes.movimentacoes).toBeGreaterThan(0);
    expect(antes.lotes).toBe(1);
    expect(antes.contatos).toBe(1);
    expect(antes.controlesDiarios).toBe(1);
    expect(antes.itens).toBe(3);
    expect(antes.locais).toBe(3);

    const resumo = await c.resetOperacional.zerar();

    // Contagens reportadas batem com o estado pré-limpeza
    expect(resumo.removidos.movimentacoes).toBe(antes.movimentacoes);
    expect(resumo.removidos.lotes).toBe(1);
    expect(resumo.removidos.contatos).toBe(1);
    expect(resumo.removidos.controlesDiarios).toBe(1);
    expect(resumo.preservados.itens).toBe(3);
    expect(resumo.preservados.locais).toBe(3);

    // Estado depois: 4 repos zerados
    expect(await c.movimentacoes.listar({ incluirCanceladas: true })).toHaveLength(0);
    expect(await c.lotes.listar()).toHaveLength(0);
    expect(await c.contatosLavanderia.listar()).toHaveLength(0);
    expect(await c.controlesDiarios.listar()).toHaveLength(0);

    // Itens e locais intactos
    expect(await c.itens.listar()).toHaveLength(3);
    expect(await c.locais.listar()).toHaveLength(3);
  });

  it('após zerar: saldo global é zero (projeção também fica limpa)', async () => {
    await popularTudo(c);
    await c.resetOperacional.zerar();
    const global = await c.saldoService.saldoGlobal();
    expect(global).toHaveLength(0);
  });

  it('após zerar: resumo de perdas some (projeção sobre lotes+movs)', async () => {
    await popularTudo(c);
    await c.resetOperacional.zerar();
    const resumo = await c.relatorioPerda.resumo();
    expect(resumo.totalPecas).toBe(0);
    expect(resumo.lotesEncerrados).toBe(0);
  });

  it('é idempotente: chamar duas vezes não quebra', async () => {
    await popularTudo(c);
    await c.resetOperacional.zerar();
    const segundo = await c.resetOperacional.zerar();
    expect(segundo.removidos.movimentacoes).toBe(0);
    expect(segundo.removidos.lotes).toBe(0);
    expect(segundo.removidos.contatos).toBe(0);
    expect(segundo.removidos.controlesDiarios).toBe(0);
  });

  it('funciona em base vazia', async () => {
    const resumo = await c.resetOperacional.zerar();
    expect(resumo.removidos.movimentacoes).toBe(0);
    expect(resumo.preservados.itens).toBe(3);
  });

  it('quando um step falha, nomeia o step no erro', async () => {
    // Injeta falha no repo de lotes para simular DB down no step específico
    const original = c.lotes.limpar.bind(c.lotes);
    c.lotes.limpar = async () => {
      throw new Error('DB temporarily unavailable');
    };
    try {
      await expect(c.resetOperacional.zerar()).rejects.toBeInstanceOf(
        ResetOperacionalError,
      );
    } finally {
      c.lotes.limpar = original;
    }
  });

  it('propaga o step name no ResetOperacionalError', async () => {
    c.contatosLavanderia.limpar = async () => {
      throw new Error('boom');
    };
    try {
      await c.resetOperacional.zerar();
      expect.fail('devia ter rejeitado');
    } catch (err) {
      expect(err).toBeInstanceOf(ResetOperacionalError);
      const resetErr = err as ResetOperacionalError;
      expect(resetErr.step).toBe('contatos/cobranças');
      expect((resetErr.cause as Error).message).toBe('boom');
    }
  });

  it('respeita ordem FK-safe: filhos antes de pais', async () => {
    // Em Supabase, FK RESTRICT bloqueia delete de lotes enquanto
    // contatos.lote_id ou movimentacoes.lote_id ainda referenciam.
    // InMemory não fire a constraint, então este teste rastreia a
    // ordem explícita das chamadas — rede de segurança contra refactor
    // que quebraria silenciosamente em produção.
    await popularTudo(c);

    const ordem: string[] = [];
    const espionar = <T extends { limpar: () => Promise<void> }>(
      repo: T,
      nome: string,
    ): void => {
      const original = repo.limpar.bind(repo);
      repo.limpar = async () => {
        ordem.push(nome);
        await original();
      };
    };
    espionar(c.contatosLavanderia, 'contatos');
    espionar(c.movimentacoes, 'movimentacoes');
    espionar(c.lotes, 'lotes');
    espionar(c.controlesDiarios, 'controles');

    await c.resetOperacional.zerar();

    // Invariantes de FK (constraints reais do schema):
    //   contatos.lote_id → lotes  ⇒  contatos antes de lotes
    //   movimentacoes.lote_id → lotes  ⇒  movs antes de lotes
    expect(ordem.indexOf('contatos')).toBeLessThan(ordem.indexOf('lotes'));
    expect(ordem.indexOf('movimentacoes')).toBeLessThan(ordem.indexOf('lotes'));

    // Ordem completa esperada — bloqueia mudança não-intencional.
    expect(ordem).toEqual(['contatos', 'movimentacoes', 'lotes', 'controles']);
  });

  it('reset completo após popular todas as tabelas operacionais zera tudo (sem erro de FK)', async () => {
    // Reproduz o cenário do bug: contatos populados + movimentações com
    // lote_id + lote em aberto. Antes do fix, lotes.limpar() rodava antes
    // de movs.limpar() — em Supabase isso quebraria com FK violation.
    await popularTudo(c);

    const antes = await c.resetOperacional.contagensAtuais();
    // Sanity: as 4 tabelas de fato têm dados (precondição do teste)
    expect(antes.movimentacoes).toBeGreaterThan(0);
    expect(antes.lotes).toBeGreaterThan(0);
    expect(antes.contatos).toBeGreaterThan(0);
    expect(antes.controlesDiarios).toBeGreaterThan(0);

    const resumo = await c.resetOperacional.zerar();

    // Tudo zerado, sem erro.
    expect(resumo.removidos).toEqual({
      movimentacoes: antes.movimentacoes,
      lotes: antes.lotes,
      contatos: antes.contatos,
      controlesDiarios: antes.controlesDiarios,
    });

    // Estado final: as 4 tabelas operacionais vazias
    expect(await c.movimentacoes.listar({ incluirCanceladas: true })).toHaveLength(0);
    expect(await c.lotes.listar()).toHaveLength(0);
    expect(await c.contatosLavanderia.listar()).toHaveLength(0);
    expect(await c.controlesDiarios.listar()).toHaveLength(0);
    // Catálogo preservado por design
    expect(await c.itens.listar()).toHaveLength(antes.itens);
    expect(await c.locais.listar()).toHaveLength(antes.locais);
  });
});
