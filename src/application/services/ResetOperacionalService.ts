import type { ItemRepository } from '../ports/ItemRepository';
import type { LocalRepository } from '../ports/LocalRepository';
import type { MovimentacaoRepository } from '../ports/MovimentacaoRepository';
import type { LoteRepository } from '../ports/LoteRepository';
import type { ContatoLavanderiaRepository } from '../ports/ContatoLavanderiaRepository';
import type { ControleDiarioRepository } from '../ports/ControleDiarioRepository';

export interface ResumoLimpeza {
  readonly removidos: {
    readonly movimentacoes: number;
    readonly lotes: number;
    readonly contatos: number;
    readonly controlesDiarios: number;
  };
  readonly preservados: {
    readonly itens: number;
    readonly locais: number;
  };
}

// Erro específico do reset. Carrega o step que falhou para que a UI
// possa mostrar ao operador EXATAMENTE onde a limpeza parou (em vez do
// genérico "erro inesperado"). Expõe `cause` para log com stack real.
export class ResetOperacionalError extends Error {
  readonly step: string;
  override readonly cause: unknown;
  constructor(step: string, cause: unknown) {
    const base = cause instanceof Error ? cause.message : String(cause);
    super(`Falha no step "${step}" do reset: ${base}`);
    this.name = 'ResetOperacionalError';
    this.step = step;
    this.cause = cause;
  }
}

// Orquestrador da limpeza administrativa. Opera só sobre as ports —
// roda idêntico contra InMemory (testes/dev) e Supabase (produção).
//
// ESCOPO PRESERVADO POR DESIGN: o reset zera apenas os 4 repos
// operacionais. Catálogo (itens, locais, categorias) NÃO é deletado —
// preservar categorias/itens/locais é intencional pra permitir reset
// de "movimento do mês" sem perder o cadastro.
//
// ORDEM FK-SAFE (importa em Supabase, irrelevante em InMemory):
//
//   FK relevantes do schema:
//     contatos_lavanderia.lote_id     → lotes_lavanderia(id) RESTRICT
//     movimentacoes.lote_id            → lotes_lavanderia(id) RESTRICT
//     lotes_lavanderia.{origem,destino}_id → locais(id) RESTRICT (preservado)
//     movimentacoes.{item,origem,destino}_id → itens/locais (preservado)
//
//   Topologia: filhos antes de pais.
//     1. contatos_lavanderia    (filho de lotes — RESTRICT)
//     2. movimentacoes          (filho de lotes — RESTRICT)
//     3. lotes_lavanderia       (após filhos zerados, pode deletar)
//     4. controles_diarios      (independente — sem FKs entrando ou saindo)
//
//   Inverter quebra com `update or delete on table "lotes_lavanderia"
//   violates foreign key constraint` em Supabase. Em InMemory passa
//   silenciosamente — por isso o teste de ordem explícita abaixo.
//
// PROJEÇÕES: divergências e perdas NÃO têm repositório — são projeções
// puras sobre lotes + movimentações. Zerar esses 2 já zera as projeções
// no próximo render.
export class ResetOperacionalService {
  constructor(
    private readonly movimentacoes: MovimentacaoRepository,
    private readonly lotes: LoteRepository,
    private readonly contatos: ContatoLavanderiaRepository,
    private readonly controlesDiarios: ControleDiarioRepository,
    private readonly itens: ItemRepository,
    private readonly locais: LocalRepository,
  ) {}

  async zerar(): Promise<ResumoLimpeza> {
    const contagem = await this.contarAntes();

    // Ordem FK-safe: filhos → pais. Mudar essa ordem quebra reset em
    // produção. O teste de ordem do ResetOperacionalService.test.ts
    // serve como rede de segurança contra refactor não-intencional.
    await this.executarStep('contatos/cobranças', () => this.contatos.limpar());
    await this.executarStep('movimentações', () => this.movimentacoes.limpar());
    await this.executarStep('lotes de lavanderia', () => this.lotes.limpar());
    await this.executarStep('controles diários', () => this.controlesDiarios.limpar());

    const preservados = await this.contarPreservados();

    return {
      removidos: contagem,
      preservados,
    };
  }

  // Exposto para a UI mostrar contagens atuais antes de pedir confirmação.
  async contagensAtuais(): Promise<
    ResumoLimpeza['removidos'] & ResumoLimpeza['preservados']
  > {
    const [removidos, preservados] = await Promise.all([
      this.contarAntes(),
      this.contarPreservados(),
    ]);
    return { ...removidos, ...preservados };
  }

  private async executarStep(nome: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.error(`[ResetOperacional] step="${nome}" falhou`, err);
      throw new ResetOperacionalError(nome, err);
    }
  }

  private async contarAntes(): Promise<ResumoLimpeza['removidos']> {
    const [movs, lotes, contatos, controles] = await Promise.all([
      this.movimentacoes.listar({ incluirCanceladas: true }),
      this.lotes.listar(),
      this.contatos.listar(),
      this.controlesDiarios.listar(),
    ]);
    return {
      movimentacoes: movs.length,
      lotes: lotes.length,
      contatos: contatos.length,
      controlesDiarios: controles.length,
    };
  }

  private async contarPreservados(): Promise<ResumoLimpeza['preservados']> {
    const [itens, locais] = await Promise.all([
      this.itens.listar(),
      this.locais.listar(),
    ]);
    return {
      itens: itens.length,
      locais: locais.length,
    };
  }
}
