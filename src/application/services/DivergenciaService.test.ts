import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import {
  itemToalha,
  semearBasico,
  TEST_ITENS,
  TEST_LOCAIS,
} from '@/testing/testSeed';

const UM_DIA_MS = 24 * 60 * 60 * 1000;

describe('DivergenciaService', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste('2026-01-01T10:00:00.000Z');
    await semearBasico(c);
    // Estoque base para permitir envios
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
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.semPreco,
      quantidade: 100,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
  });

  describe('classificação por tempo em aberto', () => {
    it('classifica como aguardando dentro dos 7 dias', async () => {
      const dataEnvio = '2026-01-05T10:00:00.000Z';
      c.clock.set(dataEnvio);
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      // avança 3 dias desde o envio
      const agora = new Date(dataEnvio).getTime() + 3 * UM_DIA_MS;
      const divergencia = await c.divergenciaService.porLoteId(lote.id, agora);
      expect(divergencia?.prioridade).toBe('aguardando');
      expect(divergencia?.recomendacao).toBe('aguardar_retorno');
      expect(divergencia?.diasDesdeEnvio).toBe(3);
    });

    it('classifica como atenção após 7 dias', async () => {
      const dataEnvio = '2026-01-05T10:00:00.000Z';
      c.clock.set(dataEnvio);
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      const agora = new Date(dataEnvio).getTime() + 7 * UM_DIA_MS;
      const divergencia = await c.divergenciaService.porLoteId(lote.id, agora);
      expect(divergencia?.prioridade).toBe('atencao');
      expect(divergencia?.recomendacao).toBe('cobrar_lavanderia');
    });

    it('classifica como crítica após 14 dias — recomenda encerrar', async () => {
      const dataEnvio = '2026-01-05T10:00:00.000Z';
      c.clock.set(dataEnvio);
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      const agora = new Date(dataEnvio).getTime() + 20 * UM_DIA_MS;
      const divergencia = await c.divergenciaService.porLoteId(lote.id, agora);
      expect(divergencia?.prioridade).toBe('critica');
      expect(divergencia?.recomendacao).toBe('encerrar_com_baixa');
    });
  });

  describe('classificação por valor', () => {
    it('classifica como crítica quando valor pendente >= R$500, mesmo cedo', async () => {
      const dataEnvio = '2026-01-05T10:00:00.000Z';
      c.clock.set(dataEnvio);
      // 20 toalhas (R$30 cada) = R$600 — acima do VALOR_CRITICO
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 20 }],
      });
      // 1 dia depois — tempo não deveria disparar
      const agora = new Date(dataEnvio).getTime() + UM_DIA_MS;
      const divergencia = await c.divergenciaService.porLoteId(lote.id, agora);
      expect(divergencia?.valorPendente).toBe(600);
      expect(divergencia?.prioridade).toBe('critica');
      // Recomendação vem de valor (não tempo) → cobrar
      expect(divergencia?.recomendacao).toBe('cobrar_lavanderia');
    });

    it('classifica como atenção quando valor >= R$200 mas < R$500', async () => {
      const dataEnvio = '2026-01-05T10:00:00.000Z';
      c.clock.set(dataEnvio);
      // 10 toalhas @ R$30 = R$300
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      const agora = new Date(dataEnvio).getTime() + 2 * UM_DIA_MS;
      const divergencia = await c.divergenciaService.porLoteId(lote.id, agora);
      expect(divergencia?.valorPendente).toBe(300);
      expect(divergencia?.prioridade).toBe('atencao');
    });
  });

  describe('status especiais', () => {
    it('classifica como excesso quando retorno > envio', async () => {
      const dataEnvio = '2026-01-05T10:00:00.000Z';
      c.clock.set(dataEnvio);
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      // Injeta fronhas na lavanderia (para ter saldo) e retorna como divergência
      await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.fronha,
        quantidade: 3,
        tipo: 'ajuste',
        origemId: null,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
      });
      await c.loteLavanderia.registrarRetorno({
        loteId: lote.id,
        responsavel: 'T',
        itens: [
          { itemId: TEST_ITENS.toalha, quantidade: 5 },
          { itemId: TEST_ITENS.fronha, quantidade: 3 }, // não foi enviada
        ],
      });
      const divergencia = await c.divergenciaService.porLoteId(
        lote.id,
        new Date(dataEnvio).getTime() + UM_DIA_MS,
      );
      expect(divergencia?.prioridade).toBe('excesso');
      expect(divergencia?.recomendacao).toBe('verificar_lancamento');
      expect(divergencia?.excessoTotal).toBe(3);
    });

    it('classifica como encerrado_baixado após encerramento', async () => {
      const dataEnvio = '2026-01-05T10:00:00.000Z';
      c.clock.set(dataEnvio);
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      await c.loteLavanderia.encerrarComPendencia({
        loteId: lote.id,
        motivo: 'perda_confirmada',
        responsavel: 'G',
      });
      const divergencia = await c.divergenciaService.porLoteId(lote.id);
      expect(divergencia?.prioridade).toBe('encerrado_baixado');
      expect(divergencia?.recomendacao).toBe('nenhuma');
    });

    it('classifica como ok quando retorno cobre envio (concluído)', async () => {
      const dataEnvio = '2026-01-05T10:00:00.000Z';
      c.clock.set(dataEnvio);
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      await c.loteLavanderia.registrarRetorno({
        loteId: lote.id,
        responsavel: 'T',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      const divergencia = await c.divergenciaService.porLoteId(lote.id);
      expect(divergencia?.prioridade).toBe('ok');
      expect(divergencia?.pendenciaEfetiva).toBe(0);
    });
  });

  describe('valor pendente e snapshot', () => {
    it('usa snapshot (preço congelado) para calcular valor pendente', async () => {
      const dataEnvio = '2026-01-05T10:00:00.000Z';
      c.clock.set(dataEnvio);
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      // Muda o preço do item no cadastro — snapshot não deve ser afetado
      await c.itens.atualizar({ ...itemToalha(), valorUnitario: 999 });
      const divergencia = await c.divergenciaService.porLoteId(lote.id);
      // 5 peças × R$30 (snapshot) = R$150
      expect(divergencia?.valorPendente).toBe(150);
    });

    it('marca custoParcial quando item sem preço está na pendência', async () => {
      const dataEnvio = '2026-01-05T10:00:00.000Z';
      c.clock.set(dataEnvio);
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.semPreco, quantidade: 5 }],
      });
      const divergencia = await c.divergenciaService.porLoteId(lote.id);
      expect(divergencia?.pendenciaEfetiva).toBe(5);
      expect(divergencia?.valorPendente).toBe(0);
      expect(divergencia?.custoParcial).toBe(true);
    });
  });

  describe('resumoAlertas', () => {
    it('agrega contagens por prioridade e soma valor pendente ativo', async () => {
      // Lote 1 — aguardando (3 dias, R$150)
      const d1 = '2026-01-10T10:00:00.000Z';
      c.clock.set(d1);
      await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });

      // Lote 2 — crítica por valor (R$600, 1 dia)
      const d2 = '2026-01-11T10:00:00.000Z';
      c.clock.set(d2);
      await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 20 }],
      });

      // Lote 3 — encerrado
      const d3 = '2026-01-12T10:00:00.000Z';
      c.clock.set(d3);
      const loteEncerrado = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 2 }],
      });
      await c.loteLavanderia.encerrarComPendencia({
        loteId: loteEncerrado.id,
        motivo: 'perda_confirmada',
        responsavel: 'G',
      });

      const agora = new Date(d3).getTime() + 2 * UM_DIA_MS;
      const resumo = await c.divergenciaService.resumoAlertas(agora);

      expect(resumo.aguardando).toBe(1);
      expect(resumo.criticas).toBe(1);
      expect(resumo.encerradosBaixados).toBe(1);
      expect(resumo.atencao).toBe(0);
      expect(resumo.excesso).toBe(0);
      // valor total ativo: 5*30 + 20*30 = 150 + 600 = 750 (encerrado não conta)
      expect(resumo.valorPendenteTotal).toBe(750);
      expect(resumo.pendenciaTotalPecas).toBe(25);
      expect(resumo.maiorPendenteItem?.itemId).toBe(TEST_ITENS.toalha);
      expect(resumo.maiorPendenteItem?.pecas).toBe(25);
    });
  });

  describe('ordenação da listagem', () => {
    it('ordena por prioridade desc, depois por dias desc', async () => {
      const d1 = '2026-01-10T10:00:00.000Z';
      c.clock.set(d1);
      // Aguardando novo
      const loteAguardando = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 2 }],
      });
      // Crítica (20 dias depois)
      c.clock.set('2026-01-05T10:00:00.000Z');
      const loteCritica = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 2 }],
      });

      // Relativo ao tempo atual simulado: set "now" para 2026-01-30 (crítica
      // tem 25 dias, aguardando tem 20 dias — ambas críticas por tempo).
      const agora = new Date('2026-01-30T10:00:00.000Z').getTime();
      const divergencias = await c.divergenciaService.listar(agora);
      const ativos = divergencias.filter(
        (d) => d.lote.id === loteCritica.id || d.lote.id === loteAguardando.id,
      );
      // A mais antiga (dataEnvio 05) vem primeiro entre iguais de prioridade
      expect(ativos[0]?.lote.id).toBe(loteCritica.id);
      expect(ativos[1]?.lote.id).toBe(loteAguardando.id);
    });
  });
});
