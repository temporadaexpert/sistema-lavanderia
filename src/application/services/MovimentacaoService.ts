import type { Movimentacao } from '@/domain/entities/Movimentacao';
import { MovimentacaoId } from '@/domain/types/ids';
import { REGRAS_MOVIMENTACAO } from '@/domain/rules/movimentacaoRules';
import { NotFoundError, ValidationError } from '@/domain/errors/DomainErrors';
import type { ItemRepository } from '../ports/ItemRepository';
import type { LocalRepository } from '../ports/LocalRepository';
import type { MovimentacaoRepository } from '../ports/MovimentacaoRepository';
import type { RegistrarMovimentacaoInput } from '../dto/RegistrarMovimentacaoInput';
import type { SaldoService } from './SaldoService';

export interface IdGenerator {
  gerar(): string;
}

export interface Clock {
  agoraISO(): string;
}

// Serviço de caso de uso: valida, gera ID/timestamps e persiste. Toda a
// consistência é garantida aqui, antes do append no log. Entidades continuam
// como estruturas de dados puras.
export class MovimentacaoService {
  constructor(
    private readonly itens: ItemRepository,
    private readonly locais: LocalRepository,
    private readonly movimentacoes: MovimentacaoRepository,
    private readonly saldos: SaldoService,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async registrar(input: RegistrarMovimentacaoInput): Promise<Movimentacao> {
    this.validarFormato(input);

    const [item, origem, destino] = await Promise.all([
      this.itens.porId(input.itemId),
      input.origemId ? this.locais.porId(input.origemId) : Promise.resolve(null),
      input.destinoId ? this.locais.porId(input.destinoId) : Promise.resolve(null),
    ]);

    if (!item) throw new NotFoundError('Item', input.itemId);
    if (!item.ativo) throw new ValidationError(`Item ${item.id} está inativo`);
    if (input.origemId && !origem) throw new NotFoundError('Local (origem)', input.origemId);
    if (input.destinoId && !destino) throw new NotFoundError('Local (destino)', input.destinoId);

    const regra = REGRAS_MOVIMENTACAO[input.tipo];

    if (regra.origemObrigatoria && !origem) {
      throw new ValidationError(`Tipo '${input.tipo}' exige origem`);
    }
    if (regra.destinoObrigatorio && !destino) {
      throw new ValidationError(`Tipo '${input.tipo}' exige destino`);
    }
    if (input.tipo === 'ajuste' && !origem && !destino) {
      throw new ValidationError("Movimentação 'ajuste' exige origem OU destino (pelo menos um)");
    }
    if (regra.tiposOrigemPermitidos && origem && !regra.tiposOrigemPermitidos.includes(origem.tipo)) {
      throw new ValidationError(
        `Origem do tipo '${origem.tipo}' não é permitida para '${input.tipo}' (esperado: ${regra.tiposOrigemPermitidos.join(', ')})`,
      );
    }
    if (regra.tiposDestinoPermitidos && destino && !regra.tiposDestinoPermitidos.includes(destino.tipo)) {
      throw new ValidationError(
        `Destino do tipo '${destino.tipo}' não é permitido para '${input.tipo}' (esperado: ${regra.tiposDestinoPermitidos.join(', ')})`,
      );
    }
    if (!regra.permiteOrigemIgualDestino && origem && destino && origem.id === destino.id) {
      throw new ValidationError('Origem e destino não podem ser o mesmo local');
    }
    if (input.loteId && !regra.permiteLote) {
      throw new ValidationError(`Tipo '${input.tipo}' não aceita vínculo a lote de lavanderia`);
    }

    if (regra.exigeSaldoNaOrigem && input.origemId) {
      // Ponto único de validação: respeita o novo modelo (estoqueTotal
      // definido → disponibilidade) com fallback legacy (saldo por local).
      await this.saldos.garantirEstoqueParaSaida(
        input.itemId,
        input.origemId,
        input.quantidade,
      );
    }

    const agora = this.clock.agoraISO();
    // Snapshot de preço: congela o valorUnitario atual do item para que
    // relatórios financeiros históricos permaneçam estáveis frente a
    // reajustes futuros do cadastro. A captura é decisão da regra do tipo
    // (capturaSnapshotPreco) — tipos sem impacto financeiro ficam null.
    // Quando o item não tem preço cadastrado no momento do registro, o
    // snapshot também fica null e os relatórios tratam transparente.
    const precoUnitarioSnapshot = regra.capturaSnapshotPreco
      ? (item.valorUnitario ?? null)
      : null;

    const mov: Movimentacao = {
      id: MovimentacaoId(this.idGen.gerar()),
      dataHora: input.dataHora ?? agora,
      itemId: input.itemId,
      quantidade: input.quantidade,
      tipo: input.tipo,
      origemId: input.origemId,
      destinoId: input.destinoId,
      responsavel: input.responsavel,
      observacao: input.observacao ?? null,
      loteId: input.loteId ?? null,
      precoUnitarioSnapshot,
      registradoEm: agora,
      cancelada: false,
      canceladoEm: null,
      canceladoPor: null,
      motivoCancelamento: null,
    };

    await this.movimentacoes.registrar(mov);
    return mov;
  }

  // Tipos que a equipe operacional pode corrigir sem quebrar cadeia de
  // lote: entradas/saídas/retornos puros e ajustes manuais (não ligados a
  // encerramento de lote). Cancelar uma movimentação de lote corromperia
  // o estado do lote — bloqueado de propósito.
  static readonly TIPOS_CANCELAVEIS = new Set([
    'entrada_deposito',
    'saida_imovel',
    'retorno_imovel',
    'ajuste',
  ] as const);

  async cancelar(input: {
    readonly id: MovimentacaoId;
    readonly motivo: string;
    readonly responsavel: string;
  }): Promise<Movimentacao> {
    const motivo = input.motivo?.trim();
    const responsavel = input.responsavel?.trim();
    if (!motivo) throw new ValidationError('Motivo do cancelamento é obrigatório');
    if (!responsavel) throw new ValidationError('Responsável é obrigatório');

    const mov = await this.movimentacoes.porId(input.id);
    if (!mov) throw new NotFoundError('Movimentação', input.id);
    if (mov.cancelada) {
      throw new ValidationError('Movimentação já foi cancelada anteriormente');
    }
    if (!MovimentacaoService.TIPOS_CANCELAVEIS.has(mov.tipo as never)) {
      throw new ValidationError(
        `Movimentação do tipo '${mov.tipo}' não pode ser cancelada. Tipos cancelável: ${Array.from(MovimentacaoService.TIPOS_CANCELAVEIS).join(', ')}`,
      );
    }
    if (mov.loteId) {
      throw new ValidationError(
        'Movimentação vinculada a lote de lavanderia não pode ser cancelada isoladamente — use o fluxo do lote',
      );
    }

    const canceladoEm = this.clock.agoraISO();
    await this.movimentacoes.marcarCancelada(mov.id, {
      canceladoEm,
      canceladoPor: responsavel,
      motivoCancelamento: motivo,
    });
    return {
      ...mov,
      cancelada: true,
      canceladoEm,
      canceladoPor: responsavel,
      motivoCancelamento: motivo,
    };
  }

  private validarFormato(input: RegistrarMovimentacaoInput): void {
    if (!Number.isInteger(input.quantidade) || input.quantidade <= 0) {
      throw new ValidationError('Quantidade deve ser inteiro positivo');
    }
    if (!input.responsavel?.trim()) {
      throw new ValidationError('Responsável é obrigatório');
    }
    if (input.dataHora && Number.isNaN(Date.parse(input.dataHora))) {
      throw new ValidationError('dataHora inválida (esperado ISO 8601)');
    }
  }
}
