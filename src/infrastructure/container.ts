import { MovimentacaoService } from '@/application/services/MovimentacaoService';
import { SaldoService } from '@/application/services/SaldoService';
import { RelatorioLavanderiaService } from '@/application/services/RelatorioLavanderiaService';
import { RelatorioPerdaService } from '@/application/services/RelatorioPerdaService';
import { LoteLavanderiaService } from '@/application/services/LoteLavanderiaService';
import { DashboardAdminService } from '@/application/services/DashboardAdminService';
import { ItemService } from '@/application/services/ItemService';
import { LocalService } from '@/application/services/LocalService';
import { DivergenciaService } from '@/application/services/DivergenciaService';
import { ContatoLavanderiaService } from '@/application/services/ContatoLavanderiaService';
import { ControleDiarioService } from '@/application/services/ControleDiarioService';
import { ResetOperacionalService } from '@/application/services/ResetOperacionalService';
import { CategoryService } from '@/application/services/CategoryService';
import { JsonFileItemRepository } from './repositories/JsonFileItemRepository';
import { JsonFileLocalRepository } from './repositories/JsonFileLocalRepository';
import { JsonFileMovimentacaoRepository } from './repositories/JsonFileMovimentacaoRepository';
import { JsonFileLoteRepository } from './repositories/JsonFileLoteRepository';
import { InMemoryContatoLavanderiaRepository } from './repositories/InMemoryContatoLavanderiaRepository';
import { JsonFileControleDiarioRepository } from './repositories/JsonFileControleDiarioRepository';
import { JsonFileCategoryRepository } from './repositories/JsonFileCategoryRepository';
import { SupabaseCategoryRepository } from './repositories/SupabaseCategoryRepository';
import { SupabaseLocalRepository } from './repositories/SupabaseLocalRepository';
import { SupabaseItemRepository } from './repositories/SupabaseItemRepository';
import { SupabaseLoteRepository } from './repositories/SupabaseLoteRepository';
import { SupabaseMovimentacaoRepository } from './repositories/SupabaseMovimentacaoRepository';
import { SupabaseControleDiarioRepository } from './repositories/SupabaseControleDiarioRepository';
import { SupabaseContatoLavanderiaRepository } from './repositories/SupabaseContatoLavanderiaRepository';
import { getSupabaseClient } from './db/supabaseClient';
import type { CategoryRepository } from '@/application/ports/CategoryRepository';
import type { LocalRepository } from '@/application/ports/LocalRepository';
import type { ItemRepository } from '@/application/ports/ItemRepository';
import type { LoteRepository } from '@/application/ports/LoteRepository';
import type { MovimentacaoRepository } from '@/application/ports/MovimentacaoRepository';
import type { ControleDiarioRepository } from '@/application/ports/ControleDiarioRepository';
import type { ContatoLavanderiaRepository } from '@/application/ports/ContatoLavanderiaRepository';
import { UuidGenerator } from './ids/idGenerator';
import { SystemClock } from './clock/SystemClock';

// Driver de persistência ativo. Lemos uma vez no boot do módulo — não muda
// em tempo de execução. Repositórios novos (Supabase*) são plugados aqui
// conforme migram do JSON; os ainda não migrados continuam JsonFile* até
// terem a versão Supabase e teste de paridade.
const PERSISTENCE_DRIVER = process.env.PERSISTENCE_DRIVER ?? 'json';

function criarRepoCategoria(): CategoryRepository {
  if (PERSISTENCE_DRIVER === 'supabase') {
    return new SupabaseCategoryRepository(getSupabaseClient());
  }
  return new JsonFileCategoryRepository();
}

function criarRepoLocal(): LocalRepository {
  if (PERSISTENCE_DRIVER === 'supabase') {
    return new SupabaseLocalRepository(getSupabaseClient());
  }
  return new JsonFileLocalRepository();
}

function criarRepoItem(): ItemRepository {
  if (PERSISTENCE_DRIVER === 'supabase') {
    return new SupabaseItemRepository(getSupabaseClient());
  }
  return new JsonFileItemRepository();
}

function criarRepoLote(): LoteRepository {
  if (PERSISTENCE_DRIVER === 'supabase') {
    return new SupabaseLoteRepository(getSupabaseClient());
  }
  return new JsonFileLoteRepository();
}

function criarRepoMovimentacao(): MovimentacaoRepository {
  if (PERSISTENCE_DRIVER === 'supabase') {
    return new SupabaseMovimentacaoRepository(getSupabaseClient());
  }
  return new JsonFileMovimentacaoRepository();
}

function criarRepoControleDiario(): ControleDiarioRepository {
  if (PERSISTENCE_DRIVER === 'supabase') {
    return new SupabaseControleDiarioRepository(getSupabaseClient());
  }
  return new JsonFileControleDiarioRepository();
}

function criarRepoContatoLavanderia(): ContatoLavanderiaRepository {
  if (PERSISTENCE_DRIVER === 'supabase') {
    return new SupabaseContatoLavanderiaRepository(getSupabaseClient());
  }
  // Fallback InMemory: latent bug em produção (perde histórico em cada
  // restart), tolerado só em dev local. Em PERSISTENCE_DRIVER=supabase
  // o histórico fica persistido como deveria desde o começo.
  return new InMemoryContatoLavanderiaRepository();
}

// Persistência em JSON (data/*.json) para:
//   - itens, locais, categorias, movimentações, lotes, controles diários.
// In-memory apenas:
//   - contatos/cobranças da lavanderia (registro de auditoria transitório;
//     se o time quiser persistir, mesma receita do padrão JsonFile*).
//
// A persistência de movimentações e lotes é CRÍTICA pro admin dashboard
// refletir os envios do operador através de restarts do dev server.
export interface Container {
  // Tipo é o port — em PERSISTENCE_DRIVER=supabase vira SupabaseItemRepository.
  itens: ItemRepository;
  // Tipo é o port — em PERSISTENCE_DRIVER=supabase vira SupabaseLocalRepository.
  locais: LocalRepository;
  // Tipo é o port (CategoryRepository), não o concreto, porque a partir
  // de PERSISTENCE_DRIVER=supabase passa a ser SupabaseCategoryRepository.
  // Demais repos seguem concretos até terem versão Supabase implementada.
  categorias: CategoryRepository;
  // Tipo é o port — em PERSISTENCE_DRIVER=supabase vira SupabaseMovimentacaoRepository.
  movimentacoes: MovimentacaoRepository;
  // Tipo é o port — em PERSISTENCE_DRIVER=supabase vira SupabaseLoteRepository.
  lotes: LoteRepository;
  // Tipo é o port — em PERSISTENCE_DRIVER=supabase vira SupabaseContatoLavanderiaRepository.
  contatosLavanderia: ContatoLavanderiaRepository;
  // Tipo é o port — em PERSISTENCE_DRIVER=supabase vira SupabaseControleDiarioRepository.
  controlesDiarios: ControleDiarioRepository;
  saldoService: SaldoService;
  movimentacaoService: MovimentacaoService;
  relatorioLavanderia: RelatorioLavanderiaService;
  relatorioPerda: RelatorioPerdaService;
  loteLavanderia: LoteLavanderiaService;
  dashboardAdmin: DashboardAdminService;
  itemService: ItemService;
  localService: LocalService;
  divergenciaService: DivergenciaService;
  contatoLavanderiaService: ContatoLavanderiaService;
  controleDiario: ControleDiarioService;
  resetOperacional: ResetOperacionalService;
  categoryService: CategoryService;
}

// Composition root: instancia adapters concretos e injeta nos serviços.
// Trocar persistência no futuro só altera este arquivo.
export function criarContainer(): Container {
  const itens = criarRepoItem();
  const locais = criarRepoLocal();
  const movimentacoes = criarRepoMovimentacao();
  const lotes = criarRepoLote();
  const contatosLavanderia = criarRepoContatoLavanderia();
  const controlesDiarios = criarRepoControleDiario();
  const categorias = criarRepoCategoria();
  const idGen = new UuidGenerator();
  const clock = new SystemClock();
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
  // Divergências e contatos são instanciados ANTES do LoteLavanderiaService
  // porque este agora depende deles para avaliar risco no encerramento.
  // Nenhum dos dois depende de LoteLavanderiaService, então não há ciclo.
  const divergenciaService = new DivergenciaService(lotes, itens, movimentacoes);
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
  const categoryService = new CategoryService(categorias, idGen, clock);
  return {
    itens,
    locais,
    categorias,
    movimentacoes,
    lotes,
    contatosLavanderia,
    controlesDiarios,
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
    itemService: new ItemService(itens, categorias, idGen, clock),
    localService: new LocalService(locais, idGen, clock),
    divergenciaService,
    contatoLavanderiaService,
    controleDiario,
    resetOperacional,
    categoryService,
  };
}
