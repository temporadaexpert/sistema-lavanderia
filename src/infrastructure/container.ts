import { MovimentacaoService } from '@/application/services/MovimentacaoService';
import { SaldoService } from '@/application/services/SaldoService';
import { RelatorioLavanderiaService } from '@/application/services/RelatorioLavanderiaService';
import { RelatorioPerdaService } from '@/application/services/RelatorioPerdaService';
import { LoteLavanderiaService } from '@/application/services/LoteLavanderiaService';
import { DashboardAdminService } from '@/application/services/DashboardAdminService';
import { ItemService } from '@/application/services/ItemService';
import { LocalService } from '@/application/services/LocalService';
import { DivergenciaService } from '@/application/services/DivergenciaService';
import { InMemoryItemRepository } from './repositories/InMemoryItemRepository';
import { InMemoryLocalRepository } from './repositories/InMemoryLocalRepository';
import { InMemoryMovimentacaoRepository } from './repositories/InMemoryMovimentacaoRepository';
import { InMemoryLoteRepository } from './repositories/InMemoryLoteRepository';
import { UuidGenerator } from './ids/idGenerator';
import { SystemClock } from './clock/SystemClock';

export interface Container {
  itens: InMemoryItemRepository;
  locais: InMemoryLocalRepository;
  movimentacoes: InMemoryMovimentacaoRepository;
  lotes: InMemoryLoteRepository;
  saldoService: SaldoService;
  movimentacaoService: MovimentacaoService;
  relatorioLavanderia: RelatorioLavanderiaService;
  relatorioPerda: RelatorioPerdaService;
  loteLavanderia: LoteLavanderiaService;
  dashboardAdmin: DashboardAdminService;
  itemService: ItemService;
  localService: LocalService;
  divergenciaService: DivergenciaService;
}

// Composition root: instancia adapters concretos e injeta nos serviços.
// Trocar persistência no futuro só altera este arquivo.
export function criarContainer(): Container {
  const itens = new InMemoryItemRepository();
  const locais = new InMemoryLocalRepository();
  const movimentacoes = new InMemoryMovimentacaoRepository();
  const lotes = new InMemoryLoteRepository();
  const idGen = new UuidGenerator();
  const clock = new SystemClock();
  const saldoService = new SaldoService(movimentacoes);
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
  const loteLavanderia = new LoteLavanderiaService(
    lotes,
    itens,
    locais,
    movimentacoes,
    movimentacaoService,
    saldoService,
    idGen,
    clock,
  );
  return {
    itens,
    locais,
    movimentacoes,
    lotes,
    saldoService,
    movimentacaoService,
    relatorioLavanderia,
    relatorioPerda,
    loteLavanderia,
    dashboardAdmin: new DashboardAdminService(
      itens,
      locais,
      movimentacoes,
      lotes,
      saldoService,
      loteLavanderia,
      relatorioLavanderia,
      relatorioPerda,
    ),
    itemService: new ItemService(itens, idGen, clock),
    localService: new LocalService(locais, idGen, clock),
    divergenciaService: new DivergenciaService(lotes, itens, movimentacoes),
  };
}
