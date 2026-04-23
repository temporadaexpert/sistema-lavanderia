import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';
import {
  NotFoundError,
  SaldoInsuficienteError,
  ValidationError,
} from '@/domain/errors/DomainErrors';
import { LoteId } from '@/domain/types/ids';

describe('LoteLavanderiaService', () => {
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
    await c.movimentacaoService.registrar({
      itemId: TEST_ITENS.fronha,
      quantidade: 60,
      tipo: 'entrada_deposito',
      origemId: null,
      destinoId: TEST_LOCAIS.deposito,
      responsavel: 'Seed',
    });
  });

  describe('criarEnvio', () => {
    it('cria lote com código humano e movs vinculadas', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        observacao: 'rodízio semanal',
        itens: [
          { itemId: TEST_ITENS.toalha, quantidade: 10 },
          { itemId: TEST_ITENS.fronha, quantidade: 15 },
        ],
      });
      expect(lote.codigo).toMatch(/^L-\d{4}-\d{3}$/);
      expect(lote.observacao).toBe('rodízio semanal');

      const movs = await c.movimentacoes.listar({ loteId: lote.id });
      expect(movs).toHaveLength(2);
      expect(movs.every((m) => m.tipo === 'envio_lavanderia')).toBe(true);
    });

    it('rejeita lote sem itens', async () => {
      await expect(
        c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita item duplicado no lote', async () => {
      await expect(
        c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [
            { itemId: TEST_ITENS.toalha, quantidade: 10 },
            { itemId: TEST_ITENS.toalha, quantidade: 5 },
          ],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('falha com saldo insuficiente e NÃO cria lote nem movs', async () => {
      await expect(
        c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 200 }],
        }),
      ).rejects.toBeInstanceOf(SaldoInsuficienteError);

      expect(await c.lotes.listar()).toHaveLength(0);
      expect(await c.movimentacoes.listar({ tipo: 'envio_lavanderia' })).toHaveLength(0);
    });

    it('rejeita origem não-depósito', async () => {
      await expect(
        c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.imovel,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita destino não-lavanderia', async () => {
      await expect(
        c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.imovel,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('registrarRetorno e pendência', () => {
    it('calcula pendência por item corretamente após retorno parcial', async () => {
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
      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe?.totalEnviado).toBe(20);
      expect(detalhe?.totalRetornado).toBe(18);
      expect(detalhe?.pendenciaTotal).toBe(2);
      expect(detalhe?.status).toBe('retorno_parcial');
      expect(detalhe?.itens[0]?.pendencia).toBe(2);
    });

    it('ignora linhas com quantidade zero no retorno', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [
          { itemId: TEST_ITENS.toalha, quantidade: 10 },
          { itemId: TEST_ITENS.fronha, quantidade: 10 },
        ],
      });
      await c.loteLavanderia.registrarRetorno({
        loteId: lote.id,
        responsavel: 'Ana',
        itens: [
          { itemId: TEST_ITENS.toalha, quantidade: 10 },
          { itemId: TEST_ITENS.fronha, quantidade: 0 },
        ],
      });
      const retornos = await c.movimentacoes.listar({
        loteId: lote.id,
        tipo: 'retorno_lavanderia',
      });
      expect(retornos).toHaveLength(1);
    });

    it('rejeita retorno em lote inexistente', async () => {
      await expect(
        c.loteLavanderia.registrarRetorno({
          loteId: LoteId('lote-inexistente'),
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejeita retorno em lote encerrado', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      await c.loteLavanderia.encerrarComPendencia({
        loteId: lote.id,
        motivo: 'perda_confirmada',
        responsavel: 'Gestor',
      });
      await expect(
        c.loteLavanderia.registrarRetorno({
          loteId: lote.id,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 1 }],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('derivação de status', () => {
    it('status aberto sem retornos', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      const d = await c.loteLavanderia.detalhe(lote.id);
      expect(d?.status).toBe('aberto');
    });

    it('status concluido quando retorno cobre envio', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      await c.loteLavanderia.registrarRetorno({
        loteId: lote.id,
        responsavel: 'T',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      const d = await c.loteLavanderia.detalhe(lote.id);
      expect(d?.status).toBe('concluido');
    });

    it('status com_divergencia quando retorno contém item não-enviado', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      // Coloca fronha na lavanderia via ajuste (para o retorno ter saldo)
      await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.fronha,
        quantidade: 5,
        tipo: 'ajuste',
        origemId: null,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
      });
      await c.loteLavanderia.registrarRetorno({
        loteId: lote.id,
        responsavel: 'T',
        itens: [
          { itemId: TEST_ITENS.toalha, quantidade: 10 },
          { itemId: TEST_ITENS.fronha, quantidade: 5 }, // não estava no envio
        ],
      });
      const d = await c.loteLavanderia.detalhe(lote.id);
      expect(d?.status).toBe('com_divergencia');
    });
  });

  describe('listar', () => {
    it('apenasAbertos exclui concluídos e encerrados', async () => {
      const aberto = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });

      const concluido = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
        itens: [{ itemId: TEST_ITENS.fronha, quantidade: 10 }],
      });
      await c.loteLavanderia.registrarRetorno({
        loteId: concluido.id,
        responsavel: 'T',
        itens: [{ itemId: TEST_ITENS.fronha, quantidade: 10 }],
      });

      const encerrado = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      await c.loteLavanderia.encerrarComPendencia({
        loteId: encerrado.id,
        motivo: 'perda_confirmada',
        responsavel: 'G',
      });

      const abertos = await c.loteLavanderia.listar({ apenasAbertos: true });
      expect(abertos.map((r) => r.lote.id)).toEqual([aberto.id]);
    });
  });

  describe('encerrarComPendencia', () => {
    it('gera ajuste com quantidade == pendência e reduz saldo da lavanderia', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [
          { itemId: TEST_ITENS.toalha, quantidade: 20 },
          { itemId: TEST_ITENS.fronha, quantidade: 10 },
        ],
      });
      await c.loteLavanderia.registrarRetorno({
        loteId: lote.id,
        responsavel: 'Ana',
        itens: [
          { itemId: TEST_ITENS.toalha, quantidade: 18 },
          { itemId: TEST_ITENS.fronha, quantidade: 10 },
        ],
      });
      await c.loteLavanderia.encerrarComPendencia({
        loteId: lote.id,
        motivo: 'perda_confirmada',
        responsavel: 'Gestor',
      });

      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe?.status).toBe('encerrado_com_pendencia');
      expect(detalhe?.pendenciaEfetiva).toBe(0);
      expect(detalhe?.totalAjustado).toBe(2);

      const ajustes = await c.movimentacoes.listar({
        tipo: 'ajuste',
        loteId: lote.id,
      });
      expect(ajustes).toHaveLength(1);
      expect(ajustes[0]?.quantidade).toBe(2);
      expect(ajustes[0]?.origemId).toBe(TEST_LOCAIS.lavanderia);
      expect(ajustes[0]?.destinoId).toBeNull();

      // Saldo da lavanderia após encerramento: 20 - 18 - 2 = 0
      const saldoLav = await c.saldoService.saldoDe(
        TEST_ITENS.toalha,
        TEST_LOCAIS.lavanderia,
      );
      expect(saldoLav).toBe(0);
    });

    it('grava motivo, responsável e data no cabeçalho do lote', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      await c.loteLavanderia.encerrarComPendencia({
        loteId: lote.id,
        motivo: 'outros',
        motivoDescricao: 'caiu do caminhão',
        responsavel: 'Gestor',
      });
      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe?.lote.motivoFechamento).toBe('outros');
      expect(detalhe?.lote.motivoDescricao).toBe('caiu do caminhão');
      expect(detalhe?.lote.encerradoPor).toBe('Gestor');
      expect(detalhe?.lote.encerradoEm).toBeTruthy();
    });

    it('rejeita encerramento sem pendência', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      await c.loteLavanderia.registrarRetorno({
        loteId: lote.id,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      await expect(
        c.loteLavanderia.encerrarComPendencia({
          loteId: lote.id,
          motivo: 'perda_confirmada',
          responsavel: 'G',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita encerrar lote já encerrado', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      await c.loteLavanderia.encerrarComPendencia({
        loteId: lote.id,
        motivo: 'perda_confirmada',
        responsavel: 'G',
      });
      await expect(
        c.loteLavanderia.encerrarComPendencia({
          loteId: lote.id,
          motivo: 'danificado',
          responsavel: 'G',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita motivo "outros" sem descrição', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
      });
      await expect(
        c.loteLavanderia.encerrarComPendencia({
          loteId: lote.id,
          motivo: 'outros',
          responsavel: 'G',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
