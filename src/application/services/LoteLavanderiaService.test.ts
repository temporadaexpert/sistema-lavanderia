import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import { semearBasico, TEST_ITENS, TEST_LOCAIS } from '@/testing/testSeed';
import {
  NotFoundError,
  EstoqueInsuficienteError,
  ValidationError,
  DivergenciaDetectadaError,
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
      ).rejects.toBeInstanceOf(EstoqueInsuficienteError);

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
        reconhecimentoRisco: true,
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
        reconhecimentoRisco: true,
      });

      const abertos = await c.loteLavanderia.listar({ apenasAbertos: true });
      expect(abertos.map((r) => r.lote.id)).toEqual([aberto.id]);
    });

    // Contagem usada pelo badge "X pendentes" no card "Receber da
    // lavanderia" (/operacao). Cobre os 4 cenários da spec do usuário.
    describe('contagem de lotes pendentes (badge no menu)', () => {
      it('sem lotes → contagem zero (badge não aparece)', async () => {
        const abertos = await c.loteLavanderia.listar({ apenasAbertos: true });
        expect(abertos).toHaveLength(0);
      });

      it('1 lote enviado sem retorno → contagem = 1', async () => {
        await c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
        });
        const abertos = await c.loteLavanderia.listar({ apenasAbertos: true });
        expect(abertos).toHaveLength(1);
      });

      it('múltiplos lotes pendentes (3) → contagem reflete', async () => {
        for (let i = 0; i < 3; i++) {
          await c.loteLavanderia.criarEnvio({
            origemId: TEST_LOCAIS.deposito,
            destinoId: TEST_LOCAIS.lavanderia,
            responsavel: `Op ${i}`,
            itens: [{ itemId: TEST_ITENS.toalha, quantidade: 2 }],
          });
        }
        const abertos = await c.loteLavanderia.listar({ apenasAbertos: true });
        expect(abertos).toHaveLength(3);
      });

      it('retorno parcial AINDA conta (lote sem fechar)', async () => {
        const lote = await c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 10 }],
        });
        await c.loteLavanderia.registrarRetorno({
          loteId: lote.id,
          responsavel: 'Bruno',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 6 }],
        });
        const abertos = await c.loteLavanderia.listar({ apenasAbertos: true });
        expect(abertos).toHaveLength(1);
        expect(abertos[0]?.status).toBe('retorno_parcial');
      });

      it('lote concluído (enviado=retornado, sem fechar) NÃO conta', async () => {
        const lote = await c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 4 }],
        });
        await c.loteLavanderia.registrarRetorno({
          loteId: lote.id,
          responsavel: 'Bruno',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 4 }],
        });
        const abertos = await c.loteLavanderia.listar({ apenasAbertos: true });
        expect(abertos).toHaveLength(0);
      });

      it('mix: 2 abertos + 1 concluído + 1 encerrado → contagem = 2', async () => {
        // Aberto 1
        await c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'A',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 2 }],
        });
        // Aberto 2 (parcial)
        const parcial = await c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'B',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 8 }],
        });
        await c.loteLavanderia.registrarRetorno({
          loteId: parcial.id,
          responsavel: 'B',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
        });
        // Concluído
        const conc = await c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'C',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 3 }],
        });
        await c.loteLavanderia.registrarRetorno({
          loteId: conc.id,
          responsavel: 'C',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 3 }],
        });
        // Encerrado com pendência
        const enc = await c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'D',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 4 }],
        });
        await c.loteLavanderia.encerrarComPendencia({
          loteId: enc.id,
          motivo: 'perda_confirmada',
          responsavel: 'Gestor',
          reconhecimentoRisco: true,
        });

        const abertos = await c.loteLavanderia.listar({ apenasAbertos: true });
        expect(abertos).toHaveLength(2);
      });
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
        reconhecimentoRisco: true,
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
        reconhecimentoRisco: true,
      });
      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe?.lote.motivoFechamento).toBe('outros');
      // Descrição mantém o texto original e ganha sufixo com os motivos
      // de risco reconhecidos — auditabilidade no próprio cabeçalho.
      expect(detalhe?.lote.motivoDescricao).toContain('caiu do caminhão');
      expect(detalhe?.lote.motivoDescricao).toContain('encerrado com ciência de risco');
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
        reconhecimentoRisco: true,
      });
      await expect(
        c.loteLavanderia.encerrarComPendencia({
          loteId: lote.id,
          motivo: 'danificado',
          responsavel: 'G',
          reconhecimentoRisco: true,
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

  describe('confirmação de risco no encerramento', () => {
    it('rejeita encerrar lote nunca cobrado sem reconhecimentoRisco', async () => {
      // Lote com 5 toalhas (R$150), recente (0 dias). Único risco: nunca cobrado.
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      await expect(
        c.loteLavanderia.encerrarComPendencia({
          loteId: lote.id,
          motivo: 'perda_confirmada',
          responsavel: 'G',
          // reconhecimentoRisco ausente
        }),
      ).rejects.toThrow(/confirmação de risco/i);
    });

    it('permite encerrar lote nunca cobrado quando reconhecimentoRisco=true', async () => {
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
        reconhecimentoRisco: true,
      });
      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe?.status).toBe('encerrado_com_pendencia');
      expect(detalhe?.lote.motivoDescricao).toContain('encerrado com ciência de risco');
      expect(detalhe?.lote.motivoDescricao).toContain('nunca cobrado');
    });

    it('rejeita encerrar lote com promessa vencida sem reconhecimentoRisco', async () => {
      const dataEnvio = '2026-01-05T10:00:00.000Z';
      c.clock.set(dataEnvio);
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      c.clock.set('2026-01-08T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
        promessaRetornoData: '2026-01-10',
      });
      // hoje já passou da promessa
      c.clock.set('2026-01-15T10:00:00.000Z');

      await expect(
        c.loteLavanderia.encerrarComPendencia({
          loteId: lote.id,
          motivo: 'perda_confirmada',
          responsavel: 'G',
        }),
      ).rejects.toThrow(/confirmação de risco/i);
    });

    it('permite encerrar lote com promessa vencida quando reconhecimentoRisco=true', async () => {
      c.clock.set('2026-01-05T10:00:00.000Z');
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      c.clock.set('2026-01-08T10:00:00.000Z');
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
        promessaRetornoData: '2026-01-10',
      });
      c.clock.set('2026-01-15T10:00:00.000Z');
      await c.loteLavanderia.encerrarComPendencia({
        loteId: lote.id,
        motivo: 'perda_confirmada',
        responsavel: 'G',
        reconhecimentoRisco: true,
      });
      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe?.status).toBe('encerrado_com_pendencia');
      expect(detalhe?.lote.motivoDescricao).toContain('promessa vencida');
    });

    it('lote sem risco encerra normalmente mesmo sem reconhecimentoRisco', async () => {
      // Cenário "limpo": lote recente (0 dias), valor baixo (1 toalha R$30),
      // já cobrado (tem contato sem promessa). Nenhum critério de risco.
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 1 }],
      });
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
      });
      await c.loteLavanderia.encerrarComPendencia({
        loteId: lote.id,
        motivo: 'danificado',
        responsavel: 'G',
        // sem reconhecimentoRisco — não precisa, não há risco
      });
      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe?.status).toBe('encerrado_com_pendencia');
      // Descrição permanece nula — sem sufixo de risco.
      expect(detalhe?.lote.motivoDescricao).toBeNull();
    });

    it('avaliarRiscoEncerramento detecta combinação de múltiplos riscos', async () => {
      c.clock.set('2025-12-01T10:00:00.000Z');
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        // 20 × R$30 = R$600 → valor crítico
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 20 }],
      });
      // Avança 20 dias (> DIAS_CRITICO=14) para pendência antiga.
      const agoraMs = new Date('2025-12-21T10:00:00.000Z').getTime();

      const risco = await c.loteLavanderia.avaliarRiscoEncerramento(lote.id, agoraMs);
      expect(risco.temRisco).toBe(true);
      expect(risco.nuncaCobrado).toBe(true);
      expect(risco.valorPendenteAlto).toBe(true);
      expect(risco.pendenciaAntiga).toBe(true);
      expect(risco.motivos.length).toBeGreaterThanOrEqual(3);
    });

    it('avaliarRiscoEncerramento: lote sem risco retorna temRisco=false', async () => {
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 1 }],
      });
      await c.contatoLavanderiaService.registrar({
        loteId: lote.id,
        tipo: 'whatsapp',
        responsavel: 'G',
      });
      const risco = await c.loteLavanderia.avaliarRiscoEncerramento(lote.id);
      expect(risco.temRisco).toBe(false);
      expect(risco.motivos).toHaveLength(0);
    });
  });

  describe('registrarRetornoEFinalizar (fluxo unificado do operador)', () => {
    async function criarLoteAberto() {
      return c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [
          { itemId: TEST_ITENS.toalha, quantidade: 30 },
          { itemId: TEST_ITENS.fronha, quantidade: 20 },
        ],
      });
    }

    it('cenário 1: retorno completo (sem divergência) — registra e fica concluído sem fechar', async () => {
      const lote = await criarLoteAberto();
      const r = await c.loteLavanderia.registrarRetornoEFinalizar({
        loteId: lote.id,
        responsavel: 'Bruno',
        itens: [
          { itemId: TEST_ITENS.toalha, quantidade: 30 },
          { itemId: TEST_ITENS.fronha, quantidade: 20 },
        ],
      });
      expect(r.status).toBe('registrado_sem_pendencia');
      expect(r.pendenciaResidual).toBe(0);
      expect(r.fechado).toBe(false);
      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe!.totalRetornado).toBe(50);
      expect(detalhe!.pendenciaEfetiva).toBe(0);
      expect(detalhe!.encerrado).toBe(false); // não fecha sem pendência
    });

    it('cenário 2: divergência sem classificação — lança DivergenciaDetectadaError SEM gravar', async () => {
      const lote = await criarLoteAberto();
      const movsAntes = await c.movimentacoes.listar({ loteId: lote.id });

      let erroCapturado: unknown = null;
      try {
        await c.loteLavanderia.registrarRetornoEFinalizar({
          loteId: lote.id,
          responsavel: 'Bruno',
          itens: [
            { itemId: TEST_ITENS.toalha, quantidade: 28 }, // 2 faltam
            { itemId: TEST_ITENS.fronha, quantidade: 18 }, // 2 faltam
          ],
        });
      } catch (err) {
        erroCapturado = err;
      }

      expect(erroCapturado).toBeInstanceOf(DivergenciaDetectadaError);
      const e = erroCapturado as DivergenciaDetectadaError;
      expect(e.code).toBe('DIVERGENCIA_DETECTADA');
      expect(e.divergencias).toHaveLength(2);
      expect(e.divergencias.every((l) => l.diferenca === 2)).toBe(true);
      // Itens nas divergências carregam dados completos pra UI
      const toalhaDiv = e.divergencias.find((l) => l.itemId === TEST_ITENS.toalha);
      expect(toalhaDiv?.enviado).toBe(30);
      expect(toalhaDiv?.retornado).toBe(28); // o que VAI ficar registrado se aprovar
      expect(toalhaDiv?.nomeItem).toBe('Toalha');

      // Pré-validação: NADA foi gravado. Movimentações de retorno e ajuste
      // ausentes — operador pode reabrir o modal e classificar sem
      // duplicar dados.
      const movsDepois = await c.movimentacoes.listar({ loteId: lote.id });
      expect(movsDepois).toHaveLength(movsAntes.length);
    });

    it('cenário 3a: divergência classificada como "perda" — registra retorno + fecha como concluido_com_divergencia', async () => {
      const lote = await criarLoteAberto();
      const r = await c.loteLavanderia.registrarRetornoEFinalizar({
        loteId: lote.id,
        responsavel: 'Bruno',
        itens: [
          { itemId: TEST_ITENS.toalha, quantidade: 28 },
          { itemId: TEST_ITENS.fronha, quantidade: 18 },
        ],
        classificacao: 'perda',
        origemDivergencia: 'lavanderia',
        responsavelFechamento: 'Gestor',
        reconhecimentoRisco: true,
      });
      expect(r.status).toBe('concluido_com_divergencia');
      expect(r.pendenciaResidual).toBe(4);
      expect(r.fechado).toBe(true);

      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe!.encerrado).toBe(true);
      expect(detalhe!.lote.motivoFechamento).toBe('perda_confirmada');
      expect(detalhe!.lote.encerradoPor).toBe('Gestor');
      // Origem da divergência foi gravada no header do lote
      expect(detalhe!.lote.origemDivergencia).toBe('lavanderia');
      // Estoque reflete realidade: retornou 46 (28+18), 4 viraram ajuste
      expect(detalhe!.totalRetornado).toBe(46);
      expect(detalhe!.totalAjustado).toBe(4);
      expect(detalhe!.pendenciaEfetiva).toBe(0);
    });

    it('cenário 3b: divergência classificada como "retorno_parcial" — registra mas NÃO fecha', async () => {
      const lote = await criarLoteAberto();
      const r = await c.loteLavanderia.registrarRetornoEFinalizar({
        loteId: lote.id,
        responsavel: 'Bruno',
        itens: [
          { itemId: TEST_ITENS.toalha, quantidade: 20 }, // 10 faltam, virão depois
        ],
        classificacao: 'retorno_parcial',
      });
      expect(r.status).toBe('registrado_parcial');
      expect(r.pendenciaResidual).toBe(30); // 30 toalha faltando + 20 fronha
      expect(r.fechado).toBe(false);

      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe!.encerrado).toBe(false); // lote permanece aberto
      expect(detalhe!.totalRetornado).toBe(20);
      expect(detalhe!.pendenciaEfetiva).toBeGreaterThan(0);
    });

    it('cenário 3c: divergência classificada como "outro" SEM descrição — rejeita', async () => {
      const lote = await criarLoteAberto();
      await expect(
        c.loteLavanderia.registrarRetornoEFinalizar({
          loteId: lote.id,
          responsavel: 'Bruno',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 25 }],
          classificacao: 'outro',
          // motivoDescricao ausente — exigida pra "outro"
          origemDivergencia: 'lavanderia',
          responsavelFechamento: 'Gestor',
          reconhecimentoRisco: true,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('cenário 3d: classificação "extravio" mapeia corretamente para motivo_fechamento="extravio"', async () => {
      const lote = await criarLoteAberto();
      await c.loteLavanderia.registrarRetornoEFinalizar({
        loteId: lote.id,
        responsavel: 'Bruno',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 28 }],
        classificacao: 'extravio',
        origemDivergencia: 'imovel',
        responsavelFechamento: 'Gestor',
        reconhecimentoRisco: true,
      });
      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe!.lote.motivoFechamento).toBe('extravio');
      expect(detalhe!.lote.origemDivergencia).toBe('imovel');
    });

    it('origem da divergência: cada um dos 4 valores válidos é gravado no header', async () => {
      // Verifica que o repository persiste fielmente cada opção do enum.
      // Lotes pequenos (5 toalhas) pra não estourar estoque inicial em
      // loop de 4 iterações.
      const origens = ['lavanderia', 'imovel', 'operacao', 'desconhecida'] as const;
      for (const origem of origens) {
        const lote = await c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
        });
        await c.loteLavanderia.registrarRetornoEFinalizar({
          loteId: lote.id,
          responsavel: 'Bruno',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 4 }],
          classificacao: 'dano',
          origemDivergencia: origem,
          responsavelFechamento: 'Gestor',
          reconhecimentoRisco: true,
        });
        const detalhe = await c.loteLavanderia.detalhe(lote.id);
        expect(detalhe!.lote.origemDivergencia).toBe(origem);
      }
    });

    it('SEM origem + classificação que fecha (perda) — rejeita', async () => {
      const lote = await criarLoteAberto();
      await expect(
        c.loteLavanderia.registrarRetornoEFinalizar({
          loteId: lote.id,
          responsavel: 'Bruno',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 28 }],
          classificacao: 'perda',
          // origemDivergencia ausente — obrigatória pra fechamento
          responsavelFechamento: 'Gestor',
          reconhecimentoRisco: true,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('SEM origem + classificação que fecha (dano/extravio/erro_operacional/outro) — rejeita pra todas', async () => {
      const classificacoesQueFecham = [
        'dano',
        'extravio',
        'erro_operacional',
        'outro',
      ] as const;
      for (const classificacao of classificacoesQueFecham) {
        // Lotes pequenos pra caber 4 iterações no estoque inicial (toalha=100).
        const lote = await c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
        });
        await expect(
          c.loteLavanderia.registrarRetornoEFinalizar({
            loteId: lote.id,
            responsavel: 'Bruno',
            itens: [{ itemId: TEST_ITENS.toalha, quantidade: 3 }],
            classificacao,
            motivoDescricao: 'teste', // exigido pra "outro", inofensivo nas outras
            responsavelFechamento: 'Gestor',
            reconhecimentoRisco: true,
          }),
        ).rejects.toBeInstanceOf(ValidationError);
      }
    });

    it('retorno_parcial PODE prosseguir SEM origem (lote permanece aberto)', async () => {
      const lote = await criarLoteAberto();
      const r = await c.loteLavanderia.registrarRetornoEFinalizar({
        loteId: lote.id,
        responsavel: 'Bruno',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 20 }],
        classificacao: 'retorno_parcial',
        // origemDivergencia ausente — válido pra retorno parcial
      });
      expect(r.status).toBe('registrado_parcial');
      expect(r.fechado).toBe(false);
      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe!.lote.origemDivergencia).toBeNull();
    });

    it('valor inválido de origem é rejeitado pelo service', async () => {
      const lote = await criarLoteAberto();
      await expect(
        c.loteLavanderia.registrarRetornoEFinalizar({
          loteId: lote.id,
          responsavel: 'Bruno',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 28 }],
          classificacao: 'perda',
          // Cast forçado pra simular bug de cliente que enviasse valor fora do enum
          origemDivergencia: 'fornecedor' as never,
          responsavelFechamento: 'Gestor',
          reconhecimentoRisco: true,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lote criado por criarEnvio inicia com origemDivergencia=null', async () => {
      // Sanity: campo é inicializado como null, não undefined.
      const lote = await criarLoteAberto();
      const detalhe = await c.loteLavanderia.detalhe(lote.id);
      expect(detalhe!.lote.origemDivergencia).toBeNull();
    });

    it('rejeita quantidade retornada maior que pendente (proteção anti-excesso)', async () => {
      const lote = await criarLoteAberto();
      await expect(
        c.loteLavanderia.registrarRetornoEFinalizar({
          loteId: lote.id,
          responsavel: 'Bruno',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 35 }], // só 30 pendentes
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lote já encerrado é rejeitado', async () => {
      const lote = await criarLoteAberto();
      await c.loteLavanderia.registrarRetornoEFinalizar({
        loteId: lote.id,
        responsavel: 'Bruno',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 28 }],
        classificacao: 'perda',
        origemDivergencia: 'lavanderia',
        responsavelFechamento: 'Gestor',
        reconhecimentoRisco: true,
      });
      // Tentativa de re-registrar após fechado
      await expect(
        c.loteLavanderia.registrarRetornoEFinalizar({
          loteId: lote.id,
          responsavel: 'Bruno',
          itens: [{ itemId: TEST_ITENS.fronha, quantidade: 1 }],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('lote inexistente é rejeitado com NotFoundError', async () => {
      await expect(
        c.loteLavanderia.registrarRetornoEFinalizar({
          loteId: LoteId('lote-fantasma'),
          responsavel: 'Bruno',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 1 }],
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('data operacional do envio (criarEnvio)', () => {
    // Helper: ymd em SP a partir de uma Date.
    function ymdSP(d: Date): string {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
      }).format(d);
    }

    function isoMeioDia(ymd: string): string {
      return `${ymd}T12:00:00.000Z`;
    }

    function deslocarDias(d: Date, dias: number): Date {
      const c = new Date(d);
      c.setUTCDate(c.getUTCDate() + dias);
      return c;
    }

    it('aceita dataEnvio = hoje (BRT) e persiste no header do lote', async () => {
      const agora = new Date(c.clock.agoraISO());
      const hojeYmd = ymdSP(agora);
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
        dataEnvio: isoMeioDia(hojeYmd),
      });
      // O lote.dataEnvio é exatamente o que foi passado (não substituído pelo clock).
      expect(lote.dataEnvio).toBe(isoMeioDia(hojeYmd));
      // criadoEm fica separado, ancorado no relógio do sistema.
      expect(lote.criadoEm).toBe(c.clock.agoraISO());
    });

    it('aceita dataEnvio retroativo (30 dias atrás)', async () => {
      const agora = new Date(c.clock.agoraISO());
      const ymdRetro = ymdSP(deslocarDias(agora, -30));
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
        dataEnvio: isoMeioDia(ymdRetro),
      });
      expect(lote.dataEnvio).toBe(isoMeioDia(ymdRetro));
      // Auditoria preservada: criadoEm reflete o instante real do registro,
      // diferente da dataEnvio operacional.
      expect(lote.criadoEm).not.toBe(lote.dataEnvio);
    });

    it('aceita dataEnvio no limite retroativo (90 dias atrás)', async () => {
      const agora = new Date(c.clock.agoraISO());
      const ymdLimite = ymdSP(deslocarDias(agora, -90));
      await expect(
        c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
          dataEnvio: isoMeioDia(ymdLimite),
        }),
      ).resolves.toBeDefined();
    });

    it('rejeita dataEnvio futura (amanhã)', async () => {
      const agora = new Date(c.clock.agoraISO());
      const ymdFuturo = ymdSP(deslocarDias(agora, 1));
      await expect(
        c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
          dataEnvio: isoMeioDia(ymdFuturo),
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringMatching(/não pode ser futura/i),
      });
    });

    it('rejeita dataEnvio retroativa além do limite (>90 dias)', async () => {
      const agora = new Date(c.clock.agoraISO());
      const ymdMuitoAntigo = ymdSP(deslocarDias(agora, -91));
      await expect(
        c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
          dataEnvio: isoMeioDia(ymdMuitoAntigo),
        }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringMatching(/muito antiga|limite/i),
      });
    });

    it('rejeita dataEnvio com formato inválido (string que não parsea)', async () => {
      await expect(
        c.loteLavanderia.criarEnvio({
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Ana',
          itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
          dataEnvio: 'isso-nao-eh-uma-data',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('default (sem dataEnvio): usa clock e NÃO valida (preserva comportamento legado)', async () => {
      // Quando o caller omite, o service usa `agoraISO()`. Isso é sempre
      // válido por construção (presente, não futuro). O guard de validação
      // só dispara quando dataEnvio é passado explicitamente.
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
      });
      expect(lote.dataEnvio).toBe(c.clock.agoraISO());
      expect(lote.criadoEm).toBe(c.clock.agoraISO());
    });

    it('movimentações vinculadas ao lote refletem a dataEnvio operacional (não o clock)', async () => {
      // Crítico pra auditoria: as movs `envio_lavanderia` carregam a data
      // operacional escolhida pelo operador, não o instante do registro.
      // Relatórios temporais (saldo histórico, divergências por mês)
      // dependem disso pra agrupar corretamente.
      const agora = new Date(c.clock.agoraISO());
      const ymdRetro = ymdSP(deslocarDias(agora, -7));
      const lote = await c.loteLavanderia.criarEnvio({
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'Ana',
        itens: [{ itemId: TEST_ITENS.toalha, quantidade: 5 }],
        dataEnvio: isoMeioDia(ymdRetro),
      });
      const movs = await c.movimentacoes.listar({ loteId: lote.id });
      expect(movs).toHaveLength(1);
      expect(movs[0]?.dataHora).toBe(isoMeioDia(ymdRetro));
      // E `registradoEm` (campo de auditoria da movimentação) reflete o clock.
      expect(movs[0]?.registradoEm).toBe(c.clock.agoraISO());
    });
  });
});
