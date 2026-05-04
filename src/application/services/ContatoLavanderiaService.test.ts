import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';
import { NotFoundError, ValidationError } from '@/domain/errors/DomainErrors';
import { LoteId } from '@/domain/types/ids';

const UM_DIA_MS = 24 * 60 * 60 * 1000;

describe('ContatoLavanderiaService', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste('2026-01-01T10:00:00.000Z');
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

  async function criarLote() {
    return c.loteLavanderia.criarEnvio({
      origemId: TEST_LOCAIS.deposito,
      destinoId: TEST_LOCAIS.lavanderia,
      responsavel: 'Ana',
      itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
    });
  }

  describe('registrar', () => {
    it('registra contato válido', async () => {
      const lote = await criarLote();
      const contato = await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'Gestor',
        observacao: 'Lavanderia confirmou que está separando as peças',
      });
      expect(contato.tipo).toBe('whatsapp');
      expect(contato.loteId).toBe(lote.id);
      expect(contato.responsavel).toBe('Gestor');
      expect(contato.observacao).toBe('Lavanderia confirmou que está separando as peças');
      expect(contato.id).toBeTruthy();
    });

    it('aceita promessa de retorno opcional', async () => {
      const lote = await criarLote();
      const contato = await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'telefone',
        responsavel: 'Gestor',
        promessaRetornoData: '2026-01-20',
      });
      expect(contato.promessaRetornoData).toBe('2026-01-20');
    });

    it('rejeita responsável vazio', async () => {
      const lote = await criarLote();
      await expect(
        c.contatoLavanderiaService.registrar({
          loteId: lote.id,
          tipo: 'whatsapp',
          responsavel: '   ',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita tipo inválido', async () => {
      const lote = await criarLote();
      await expect(
        c.contatoLavanderiaService.registrar({
          // @ts-expect-error — testando rejeição de valor fora do enum
          tipo: 'fax',
          loteId: lote.id,
          responsavel: 'Gestor',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita lote inexistente', async () => {
      await expect(
        c.contatoLavanderiaService.registrar({
          loteId: LoteId('lote-fake'),
          tipo: 'whatsapp',
          responsavel: 'Gestor',
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejeita data de promessa em formato inválido', async () => {
      const lote = await criarLote();
      await expect(
        c.contatoLavanderiaService.registrar({
          loteId: lote.id,
          tipo: 'whatsapp',
          responsavel: 'Gestor',
          promessaRetornoData: 'amanhã',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('porLoteId', () => {
    it('retorna contatos do lote em ordem cronológica decrescente', async () => {
      const lote = await criarLote();
      c.clock.set('2026-01-10T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G1',
        observacao: 'primeiro',
      });
      c.clock.set('2026-01-12T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'telefone',
        responsavel: 'G2',
        observacao: 'segundo',
      });
      const contatos = await c.contatoLavanderiaService.porLoteId(lote.id);
      expect(contatos).toHaveLength(2);
      expect(contatos[0]?.observacao).toBe('segundo');
      expect(contatos[1]?.observacao).toBe('primeiro');
    });

    it('retorna array vazio quando não há contatos', async () => {
      const lote = await criarLote();
      const contatos = await c.contatoLavanderiaService.porLoteId(lote.id);
      expect(contatos).toEqual([]);
    });
  });

  describe('estatisticaLote', () => {
    it('nuncaCobrado=true quando sem contatos', async () => {
      const lote = await criarLote();
      const est = await c.contatoLavanderiaService.estatisticaLote(lote.id);
      expect(est.nuncaCobrado).toBe(true);
      expect(est.ultimo).toBeNull();
      expect(est.diasDesdeUltimoContato).toBeNull();
      expect(est.totalContatos).toBe(0);
      expect(est.promessaVencida).toBe(false);
    });

    it('calcula dias desde último contato corretamente', async () => {
      const lote = await criarLote();
      const dataContato = '2026-01-10T10:00:00.000Z';
      c.clock.set(dataContato);
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
      });
      // 3 dias depois
      const agoraMs = new Date(dataContato).getTime() + 3 * UM_DIA_MS;
      const est = await c.contatoLavanderiaService.estatisticaLote(lote.id, { agoraMs });
      expect(est.nuncaCobrado).toBe(false);
      expect(est.diasDesdeUltimoContato).toBe(3);
      expect(est.totalContatos).toBe(1);
    });

    it('seleciona a promessa mais próxima entre várias futuras', async () => {
      const lote = await criarLote();
      c.clock.set('2026-01-10T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
        promessaRetornoData: '2026-01-25',
      });
      c.clock.set('2026-01-12T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'telefone',
        responsavel: 'G',
        promessaRetornoData: '2026-01-18',
      });
      const agoraMs = new Date('2026-01-13T10:00:00.000Z').getTime();
      const est = await c.contatoLavanderiaService.estatisticaLote(lote.id, { agoraMs });
      expect(est.promessaRetornoProxima).toBe('2026-01-18');
    });

    it('ignora promessas passadas', async () => {
      const lote = await criarLote();
      c.clock.set('2026-01-10T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
        promessaRetornoData: '2026-01-05', // passado
      });
      const agoraMs = new Date('2026-01-10T10:00:00.000Z').getTime();
      const est = await c.contatoLavanderiaService.estatisticaLote(lote.id, { agoraMs });
      expect(est.promessaRetornoProxima).toBeNull();
    });
  });

  describe('promessa vencida', () => {
    it('detecta promessa passada como vencida quando lote tem pendência', async () => {
      const lote = await criarLote();
      c.clock.set('2026-01-10T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
        promessaRetornoData: '2026-01-15',
      });
      const agoraMs = new Date('2026-01-20T12:00:00.000Z').getTime();
      const est = await c.contatoLavanderiaService.estatisticaLote(lote.id, {
        agoraMs,
        temPendencia: true,
      });
      expect(est.promessaVencida).toBe(true);
      expect(est.diasAtrasoPromessa).toBe(5);
      expect(est.dataPromessaVencida).toBe('2026-01-15');
    });

    it('NÃO marca vencida quando lote não tem pendência efetiva', async () => {
      const lote = await criarLote();
      c.clock.set('2026-01-10T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
        promessaRetornoData: '2026-01-15',
      });
      const agoraMs = new Date('2026-01-20T12:00:00.000Z').getTime();
      const est = await c.contatoLavanderiaService.estatisticaLote(lote.id, {
        agoraMs,
        temPendencia: false,
      });
      expect(est.promessaVencida).toBe(false);
      expect(est.diasAtrasoPromessa).toBeNull();
      // A data bruta continua exposta para auditoria.
      expect(est.dataPromessaVencida).toBe('2026-01-15');
    });

    it('NÃO marca vencida quando promessa ainda é futura', async () => {
      const lote = await criarLote();
      c.clock.set('2026-01-10T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
        promessaRetornoData: '2026-01-25',
      });
      const agoraMs = new Date('2026-01-12T12:00:00.000Z').getTime();
      const est = await c.contatoLavanderiaService.estatisticaLote(lote.id, {
        agoraMs,
        temPendencia: true,
      });
      expect(est.promessaVencida).toBe(false);
      expect(est.dataPromessaVencida).toBeNull();
      expect(est.promessaRetornoProxima).toBe('2026-01-25');
    });

    it('escolhe a promessa passada mais RECENTE quando há várias', async () => {
      const lote = await criarLote();
      c.clock.set('2026-01-05T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
        promessaRetornoData: '2026-01-10',
      });
      c.clock.set('2026-01-12T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'telefone',
        responsavel: 'G',
        promessaRetornoData: '2026-01-15',
      });
      const agoraMs = new Date('2026-01-20T12:00:00.000Z').getTime();
      const est = await c.contatoLavanderiaService.estatisticaLote(lote.id, {
        agoraMs,
        temPendencia: true,
      });
      expect(est.promessaVencida).toBe(true);
      expect(est.dataPromessaVencida).toBe('2026-01-15');
      expect(est.diasAtrasoPromessa).toBe(5);
    });

    it('coexiste com promessa futura pendente (reprometeu após falhar)', async () => {
      const lote = await criarLote();
      c.clock.set('2026-01-05T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
        promessaRetornoData: '2026-01-10',
      });
      c.clock.set('2026-01-15T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'telefone',
        responsavel: 'G',
        promessaRetornoData: '2026-01-25',
      });
      const agoraMs = new Date('2026-01-18T12:00:00.000Z').getTime();
      const est = await c.contatoLavanderiaService.estatisticaLote(lote.id, {
        agoraMs,
        temPendencia: true,
      });
      expect(est.promessaVencida).toBe(true);
      expect(est.dataPromessaVencida).toBe('2026-01-10');
      expect(est.promessaRetornoProxima).toBe('2026-01-25');
    });

    it('sem promessa nenhuma: promessaVencida=false', async () => {
      const lote = await criarLote();
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
      });
      const est = await c.contatoLavanderiaService.estatisticaLote(lote.id, {
        temPendencia: true,
      });
      expect(est.promessaVencida).toBe(false);
      expect(est.dataPromessaVencida).toBeNull();
    });

    it('mapaEstatisticaTodos respeita pendenciaPorLote ao marcar vencidas', async () => {
      const l1 = await criarLote();
      const l2 = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 3 }],
      });
      c.clock.set('2026-01-10T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: l1.id,
        tipo: 'whatsapp',
        responsavel: 'G',
        promessaRetornoData: '2026-01-15',
      });
      await c.contatoLavanderiaService.registrar({
        loteId: l2.id,
        tipo: 'whatsapp',
        responsavel: 'G',
        promessaRetornoData: '2026-01-15',
      });
      const agoraMs = new Date('2026-01-20T12:00:00.000Z').getTime();

      // l1 tem pendência > 0, l2 foi concluído (pendência = 0).
      const pendenciaPorLote = new Map([
        [l1.id, 2],
        [l2.id, 0],
      ]);
      const mapa = await c.contatoLavanderiaService.mapaEstatisticaTodos({
        agoraMs,
        pendenciaPorLote,
      });
      expect(mapa.get(l1.id)?.promessaVencida).toBe(true);
      expect(mapa.get(l2.id)?.promessaVencida).toBe(false);
    });
  });

  describe('mapaEstatisticaTodos', () => {
    it('agrupa estatísticas por lote em uma única passagem', async () => {
      const l1 = await criarLote();
      const l2 = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 3 }],
      });
      c.clock.set('2026-01-10T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: l1.id,
        tipo: 'whatsapp',
        responsavel: 'G',
      });
      await c.contatoLavanderiaService.registrar({
        loteId: l1.id,
        tipo: 'telefone',
        responsavel: 'G',
      });
      // l2 sem contato

      const agoraMs = new Date('2026-01-12T10:00:00.000Z').getTime();
      const mapa = await c.contatoLavanderiaService.mapaEstatisticaTodos({ agoraMs });

      expect(mapa.get(l1.id)?.totalContatos).toBe(2);
      expect(mapa.get(l1.id)?.nuncaCobrado).toBe(false);
      // l2 não aparece no mapa (não tem contatos). O consumidor trata ausência
      // como nuncaCobrado.
      expect(mapa.has(l2.id)).toBe(false);
    });
  });
});
