import { InMemoryItemRepository } from '@/infrastructure/repositories/InMemoryItemRepository';
import { InMemoryLocalRepository } from '@/infrastructure/repositories/InMemoryLocalRepository';
import { InMemoryMovimentacaoRepository } from '@/infrastructure/repositories/InMemoryMovimentacaoRepository';
import { InMemoryLoteRepository } from '@/infrastructure/repositories/InMemoryLoteRepository';
import { SaldoService } from '@/application/services/SaldoService';
import {
  MovimentacaoService,
  type Clock,
  type IdGenerator,
} from '@/application/services/MovimentacaoService';
import { LoteLavanderiaService } from '@/application/services/LoteLavanderiaService';
import { RelatorioLavanderiaService } from '@/application/services/RelatorioLavanderiaService';
import { RelatorioPerdaService } from '@/application/services/RelatorioPerdaService';
import { ItemService } from '@/application/services/ItemService';
import { LocalService } from '@/application/services/LocalService';
import { DivergenciaService } from '@/application/services/DivergenciaService';
import { ContatoLavanderiaService } from '@/application/services/ContatoLavanderiaService';
import { InMemoryContatoLavanderiaRepository } from '@/infrastructure/repositories/InMemoryContatoLavanderiaRepository';
import { ControleDiarioService } from '@/application/services/ControleDiarioService';
import { InMemoryControleDiarioRepository } from '@/infrastructure/repositories/InMemoryControleDiarioRepository';
import { ResetOperacionalService } from '@/application/services/ResetOperacionalService';
import { CategoryService } from '@/application/services/CategoryService';
import { InMemoryCategoryRepository } from '@/infrastructure/repositories/InMemoryCategoryRepository';

// Clock controlável — permite testar cenários que dependem de data sem
// usar timers reais. set() move o tempo para qualquer ponto; tests de
// "mês atual" vs "mês passado" ficam determinísticos.
export class FakeClock implements Clock {
  private atual: Date;
  constructor(agora: Date = new Date('2026-01-01T12:00:00.000Z')) {
    this.atual = new Date(agora);
  }
  agoraISO(): string {
    return this.atual.toISOString();
  }
  set(iso: string): void {
    this.atual = new Date(iso);
  }
  avancarDias(dias: number): void {
    this.atual = new Date(this.atual.getTime() + dias * 24 * 60 * 60 * 1000);
  }
}

// ID sequencial — testes não dependem de valores aleatórios e ficam
// determinísticos/diffáveis.
export class SequentialIdGen implements IdGenerator {
  private contador = 0;
  gerar(): string {
    return `id-${String(++this.contador).padStart(4, '0')}`;
  }
}

export function criarContainerDeTeste(
  agoraInicial = '2026-01-01T12:00:00.000Z',
) {
  const itens = new InMemoryItemRepository();
  const locais = new InMemoryLocalRepository();
  const movimentacoes = new InMemoryMovimentacaoRepository();
  const lotes = new InMemoryLoteRepository();
  const clock = new FakeClock(new Date(agoraInicial));
  const idGen = new SequentialIdGen();
  const saldoService = new SaldoService(movimentacoes, itens);
  const movimentacaoService = new MovimentacaoService(
    itens,
    locais,
    movimentacoes,
    saldoService,
    idGen,
    clock,
  );
  const relatorioLavanderia = new RelatorioLavanderiaService(movimentacoes, itens);
  const relatorioPerda = new RelatorioPerdaService(lotes, movimentacoes, itens);
  const divergenciaService = new DivergenciaService(lotes, itens, movimentacoes);
  const contatosLavanderia = new InMemoryContatoLavanderiaRepository();
  const contatoLavanderiaService = new ContatoLavanderiaService(
    contatosLavanderia,
    lotes,
    idGen,
    clock,
  );
  const loteLavanderia = new LoteLavanderiaService(
    lotes,
    itens,
    locais,
    movimentacoes,
    movimentacaoService,
    saldoService,
    idGen,
    clock,
    divergenciaService,
    contatoLavanderiaService,
  );
  const categorias = new InMemoryCategoryRepository();
  const categoryService = new CategoryService(categorias, idGen, clock);
  const itemService = new ItemService(itens, categorias, idGen, clock);
  const localService = new LocalService(locais, idGen, clock);
  const controlesDiarios = new InMemoryControleDiarioRepository();
  const controleDiario = new ControleDiarioService(
    controlesDiarios,
    itens,
    idGen,
    clock,
  );
  const resetOperacional = new ResetOperacionalService(
    movimentacoes,
    lotes,
    contatosLavanderia,
    controlesDiarios,
    itens,
    locais,
  );

  return {
    itens,
    locais,
    movimentacoes,
    lotes,
    clock,
    idGen,
    saldoService,
    movimentacaoService,
    relatorioLavanderia,
    relatorioPerda,
    loteLavanderia,
    itemService,
    localService,
    divergenciaService,
    contatosLavanderia,
    contatoLavanderiaService,
    controlesDiarios,
    controleDiario,
    resetOperacional,
    categorias,
    categoryService,
  };
}

export type ContainerDeTeste = ReturnType<typeof criarContainerDeTeste>;
