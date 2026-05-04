import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ControleDiarioEnxoval,
  ControleDiarioStatus,
  LinhaEnviada,
  LinhaRetornada,
} from '@/domain/entities/ControleDiarioEnxoval';
import type { ControleDiarioId } from '@/domain/types/ids';
import type { ControleDiarioRepository } from '@/application/ports/ControleDiarioRepository';

// Linha snake_case da tabela `controles_diarios`. Os campos `enviado` e
// `retorno` são jsonb com a MESMA shape camelCase do TS (não há conversão
// interna): o domínio usa `itemId`, `recebidoSujo`, `recebidoLimpo`, e essas
// são exatamente as chaves armazenadas no JSONB. Schema documenta isso.
interface LinhaEnviadaRow {
  readonly itemId: string;
  readonly quantidade: number;
}
interface LinhaRetornadaRow {
  readonly itemId: string;
  readonly recebidoSujo: number;
  readonly recebidoLimpo: number;
}
interface ControleDiarioRow {
  readonly id: string;
  readonly data: string; // YYYY-MM-DD
  readonly status: string;
  readonly enviado: ReadonlyArray<LinhaEnviadaRow>;
  readonly retorno: ReadonlyArray<LinhaRetornadaRow>;
  readonly aberto_em: string;
  readonly fechado_em: string | null;
  readonly responsavel_envio: string | null;
  readonly responsavel_retorno: string | null;
  readonly responsavel_fechamento: string | null;
  readonly motivo_divergencia: string | null;
}

const TABELA = 'controles_diarios';

function rowToControle(row: ControleDiarioRow): ControleDiarioEnxoval {
  return {
    id: row.id as ControleDiarioId,
    data: row.data,
    // CHECK do schema garante valor dentro do enum.
    status: row.status as ControleDiarioStatus,
    // JSONB já vem parsed como JS array. Cast pra branded ItemId nas linhas
    // (runtime é string puro; brand é só compile-time).
    enviado: row.enviado as readonly LinhaEnviada[],
    retorno: row.retorno as readonly LinhaRetornada[],
    abertoEm: row.aberto_em,
    fechadoEm: row.fechado_em,
    responsavelEnvio: row.responsavel_envio,
    responsavelRetorno: row.responsavel_retorno,
    responsavelFechamento: row.responsavel_fechamento,
    motivoDivergencia: row.motivo_divergencia,
  };
}

function controleToRow(c: ControleDiarioEnxoval): ControleDiarioRow {
  return {
    id: c.id,
    data: c.data,
    status: c.status,
    // Arrays passam direto — Supabase JS serializa como JSONB. Não precisamos
    // de JSON.stringify manual; PostgREST lida com isso.
    enviado: c.enviado,
    retorno: c.retorno,
    aberto_em: c.abertoEm,
    fechado_em: c.fechadoEm,
    responsavel_envio: c.responsavelEnvio,
    responsavel_retorno: c.responsavelRetorno,
    responsavel_fechamento: c.responsavelFechamento,
    motivo_divergencia: c.motivoDivergencia,
  };
}

// Implementação Supabase do ControleDiarioRepository.
//
// Invariantes enforçados pelo banco:
//   - data UNIQUE — uma linha por dia. salvar() usa UPSERT (onConflict=data)
//     pra match a semântica do Json/InMemory que sobrescrevem por chave.
//   - status in ('aberto','fechado','fechado_com_divergencia')
//   - jsonb_typeof(enviado) = 'array' e jsonb_typeof(retorno) = 'array'
//   - controles_fechamento_consistente:
//       (status='aberto' ∧ fechado_em null) ∨
//       (status∈('fechado','fechado_com_divergencia') ∧ fechado_em not null)
//
// Os mesmos invariantes vivem no ControleDiarioService.fechar/registrar*,
// mas o banco é a rede de segurança final contra bugs de coordenação.
export class SupabaseControleDiarioRepository implements ControleDiarioRepository {
  constructor(private readonly client: SupabaseClient) {}

  async porData(data: string): Promise<ControleDiarioEnxoval | null> {
    const { data: row, error } = await this.client
      .from(TABELA)
      .select('*')
      .eq('data', data)
      .maybeSingle();
    if (error) throw new Error(`Falha ao buscar controle diário: ${error.message}`);
    return row ? rowToControle(row as ControleDiarioRow) : null;
  }

  async salvar(controle: ControleDiarioEnxoval): Promise<void> {
    // UPSERT por `data`: bate com a semântica do Json/InMemory que fazem
    // store.set(data, ...) — substitui o registro existente do mesmo dia.
    // ControleDiarioService garante unicidade de id via fluxo "fetch →
    // mutate → save", então o id do upsert é estável na prática.
    const { error } = await this.client
      .from(TABELA)
      .upsert(controleToRow(controle), { onConflict: 'data' });
    if (error) throw new Error(`Falha ao salvar controle diário: ${error.message}`);
  }

  async listar(): Promise<ControleDiarioEnxoval[]> {
    const { data, error } = await this.client.from(TABELA).select('*');
    if (error) throw new Error(`Falha ao listar controles diários: ${error.message}`);
    return (data ?? []).map((row) => rowToControle(row as ControleDiarioRow));
  }

  async limpar(): Promise<void> {
    const { error } = await this.client
      .from(TABELA)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw new Error(`Falha ao limpar controles diários: ${error.message}`);
  }
}
