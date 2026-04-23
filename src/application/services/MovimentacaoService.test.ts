import { beforeEach, describe, expect, it } from 'vitest';
import { criarContainerDeTeste, type ContainerDeTeste } from '@/testing/testContainer';
import {
  semearBasico,
  TEST_ITENS,
  TEST_LOCAIS,
  itemToalha,
} from '@/testing/testSeed';
import {
  NotFoundError,
  SaldoInsuficienteError,
  ValidationError,
} from '@/domain/errors/DomainErrors';
import { ItemId, LoteId } from '@/domain/types/ids';

describe('MovimentacaoService', () => {
  let c: ContainerDeTeste;

  beforeEach(async () => {
    c = criarContainerDeTeste();
    await semearBasico(c);
  });

  describe('registro básico', () => {
    it('registra entrada_deposito e persiste no log', async () => {
      const mov = await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 100,
        tipo: 'entrada_deposito',
        origemId: null,
        destinoId: TEST_LOCAIS.deposito,
        responsavel: 'Teste',
      });
      expect(mov.tipo).toBe('entrada_deposito');
      expect(mov.quantidade).toBe(100);
      const todas = await c.movimentacoes.listar();
      expect(todas).toHaveLength(1);
    });

    it('registra saida_imovel quando há saldo suficiente no depósito', async () => {
      await entradaBase(c, 100);
      const mov = await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 20,
        tipo: 'saida_imovel',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.imovel,
        responsavel: 'Teste',
      });
      expect(mov.quantidade).toBe(20);
    });
  });

  describe('validação de saldo', () => {
    it('rejeita saída sem saldo na origem', async () => {
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 10,
          tipo: 'saida_imovel',
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.imovel,
          responsavel: 'Teste',
        }),
      ).rejects.toBeInstanceOf(SaldoInsuficienteError);
    });

    it('aceita envio_lavanderia apenas após entrada no depósito', async () => {
      await entradaBase(c, 50);
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 60,
          tipo: 'envio_lavanderia',
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Teste',
        }),
      ).rejects.toBeInstanceOf(SaldoInsuficienteError);
    });
  });

  describe('validação de regras por tipo', () => {
    it('rejeita origem de tipo não permitido', async () => {
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 10,
          tipo: 'envio_lavanderia',
          origemId: TEST_LOCAIS.imovel, // deveria ser depósito
          destinoId: TEST_LOCAIS.lavanderia,
          responsavel: 'Teste',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita destino de tipo não permitido', async () => {
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 10,
          tipo: 'entrada_deposito',
          origemId: null,
          destinoId: TEST_LOCAIS.imovel, // deveria ser depósito
          responsavel: 'Teste',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita ajuste sem origem nem destino', async () => {
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 10,
          tipo: 'ajuste',
          origemId: null,
          destinoId: null,
          responsavel: 'Teste',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita origem == destino', async () => {
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 10,
          tipo: 'ajuste',
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.deposito,
          responsavel: 'Teste',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita loteId em tipo que não permite lote', async () => {
      await entradaBase(c, 50);
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 5,
          tipo: 'saida_imovel',
          origemId: TEST_LOCAIS.deposito,
          destinoId: TEST_LOCAIS.imovel,
          responsavel: 'Teste',
          loteId: LoteId('lote-fake'),
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('validação de formato', () => {
    it('rejeita quantidade zero', async () => {
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 0,
          tipo: 'entrada_deposito',
          origemId: null,
          destinoId: TEST_LOCAIS.deposito,
          responsavel: 'Teste',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita quantidade negativa', async () => {
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: -5,
          tipo: 'entrada_deposito',
          origemId: null,
          destinoId: TEST_LOCAIS.deposito,
          responsavel: 'Teste',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita quantidade fracionária', async () => {
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 3.5,
          tipo: 'entrada_deposito',
          origemId: null,
          destinoId: TEST_LOCAIS.deposito,
          responsavel: 'Teste',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita responsável vazio', async () => {
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 10,
          tipo: 'entrada_deposito',
          origemId: null,
          destinoId: TEST_LOCAIS.deposito,
          responsavel: '  ',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('validação de existência', () => {
    it('rejeita item inexistente', async () => {
      await expect(
        c.movimentacaoService.registrar({
          itemId: ItemId('item-fake'),
          quantidade: 10,
          tipo: 'entrada_deposito',
          origemId: null,
          destinoId: TEST_LOCAIS.deposito,
          responsavel: 'Teste',
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejeita item inativo', async () => {
      await c.itens.atualizar({ ...itemToalha(), ativo: false });
      await expect(
        c.movimentacaoService.registrar({
          itemId: TEST_ITENS.toalha,
          quantidade: 10,
          tipo: 'entrada_deposito',
          origemId: null,
          destinoId: TEST_LOCAIS.deposito,
          responsavel: 'Teste',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('captura de snapshot de preço', () => {
    it('captura snapshot em envio_lavanderia', async () => {
      await entradaBase(c, 100);
      const mov = await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 10,
        tipo: 'envio_lavanderia',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
      });
      expect(mov.precoUnitarioSnapshot).toBe(30);
    });

    it('captura snapshot em retorno_lavanderia', async () => {
      await entradaBase(c, 100);
      await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 10,
        tipo: 'envio_lavanderia',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
      });
      const mov = await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 10,
        tipo: 'retorno_lavanderia',
        origemId: TEST_LOCAIS.lavanderia,
        destinoId: TEST_LOCAIS.deposito,
        responsavel: 'T',
      });
      expect(mov.precoUnitarioSnapshot).toBe(30);
    });

    it('captura snapshot em ajuste', async () => {
      const mov = await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 5,
        tipo: 'ajuste',
        origemId: null,
        destinoId: TEST_LOCAIS.deposito,
        responsavel: 'T',
      });
      expect(mov.precoUnitarioSnapshot).toBe(30);
    });

    it('NÃO captura snapshot em entrada_deposito', async () => {
      const mov = await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 100,
        tipo: 'entrada_deposito',
        origemId: null,
        destinoId: TEST_LOCAIS.deposito,
        responsavel: 'T',
      });
      expect(mov.precoUnitarioSnapshot).toBeNull();
    });

    it('NÃO captura snapshot em saida_imovel', async () => {
      await entradaBase(c, 50);
      const mov = await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 5,
        tipo: 'saida_imovel',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.imovel,
        responsavel: 'T',
      });
      expect(mov.precoUnitarioSnapshot).toBeNull();
    });

    it('snapshot é null quando item não tem valorUnitario', async () => {
      const mov = await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.semPreco,
        quantidade: 5,
        tipo: 'ajuste',
        origemId: null,
        destinoId: TEST_LOCAIS.deposito,
        responsavel: 'T',
      });
      expect(mov.precoUnitarioSnapshot).toBeNull();
    });

    it('snapshot preserva preço histórico quando o item é reajustado depois', async () => {
      await entradaBase(c, 100);
      const mov1 = await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 10,
        tipo: 'envio_lavanderia',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
      });
      expect(mov1.precoUnitarioSnapshot).toBe(30);

      // reajuste
      await c.itens.atualizar({ ...itemToalha(), valorUnitario: 50 });

      const mov2 = await c.movimentacaoService.registrar({
        itemId: TEST_ITENS.toalha,
        quantidade: 10,
        tipo: 'envio_lavanderia',
        origemId: TEST_LOCAIS.deposito,
        destinoId: TEST_LOCAIS.lavanderia,
        responsavel: 'T',
      });
      expect(mov2.precoUnitarioSnapshot).toBe(50);

      const persistida = (await c.movimentacoes.listar()).find((m) => m.id === mov1.id);
      expect(persistida?.precoUnitarioSnapshot).toBe(30);
    });
  });
});

async function entradaBase(c: ContainerDeTeste, qtd: number): Promise<void> {
  await c.movimentacaoService.registrar({
    itemId: TEST_ITENS.toalha,
    quantidade: qtd,
    tipo: 'entrada_deposito',
    origemId: null,
    destinoId: TEST_LOCAIS.deposito,
    responsavel: 'Seed',
  });
}
