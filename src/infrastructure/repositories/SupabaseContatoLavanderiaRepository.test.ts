import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseContatoLavanderiaRepository } from './SupabaseContatoLavanderiaRepository';
import type { ContatoLavanderia } from '@/domain/entities/ContatoLavanderia';
import type {
  ContatoLavanderiaId,
  LocalId,
  LoteId,
} from '@/domain/types/ids';
import type {
  LocalTipo,
  TipoContatoLavanderia,
} from '@/domain/types/enums';

// Teste de integração contra Supabase real. Mesmo gating dos outros repos.
//
// Cleanup respeita ordem de FK (filhos antes de pais):
//   contatos_lavanderia → lotes_lavanderia → locais
// Inverter quebra com FK error.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const optIn = process.env.SUPABASE_TEST_OK === '1';
const ativo = !!url && !!key && optIn;

const ID_ZERO = '00000000-0000-0000-0000-000000000000';

function novoContatoId(): ContatoLavanderiaId {
  return crypto.randomUUID() as ContatoLavanderiaId;
}
function novoLoteId(): LoteId {
  return crypto.randomUUID() as LoteId;
}
function novoLocalId(): LocalId {
  return crypto.randomUUID() as LocalId;
}

let proximoCodigoLote = 1;
function novoCodigoLote(): string {
  return `L-CONT-${String(proximoCodigoLote++).padStart(5, '0')}`;
}

function novoContato(
  loteId: LoteId,
  overrides: Partial<ContatoLavanderia> = {},
): ContatoLavanderia {
  return {
    id: novoContatoId(),
    loteId,
    dataHora: new Date().toISOString(),
    responsavel: 'Op Teste',
    tipo: 'whatsapp',
    observacao: null,
    proximaAcao: null,
    promessaRetornoData: null,
    registradoEm: new Date().toISOString(),
    ...overrides,
  };
}

// Cleanup: contatos antes de lotes antes de locais (FK RESTRICT).
async function limpar(client: SupabaseClient): Promise<void> {
  const passos: Array<[string, string]> = [
    ['contatos_lavanderia', 'contatos'],
    ['lotes_lavanderia', 'lotes'],
    ['locais', 'locais'],
  ];
  for (const [tabela, nome] of passos) {
    const { error } = await client.from(tabela).delete().neq('id', ID_ZERO);
    if (error) throw new Error(`Falha no cleanup de ${nome}: ${error.message}`);
  }
}

async function seedLocal(
  client: SupabaseClient,
  nome: string,
  tipo: LocalTipo,
): Promise<LocalId> {
  const id = novoLocalId();
  const { error } = await client.from('locais').insert({
    id,
    nome,
    tipo,
    ativo: true,
    criado_em: new Date().toISOString(),
  });
  if (error) throw new Error(`Falha ao seed local: ${error.message}`);
  return id;
}

async function seedLote(
  client: SupabaseClient,
  origemId: LocalId,
  destinoId: LocalId,
): Promise<LoteId> {
  const id = novoLoteId();
  const { error } = await client.from('lotes_lavanderia').insert({
    id,
    codigo: novoCodigoLote(),
    criado_em: new Date().toISOString(),
    data_envio: new Date().toISOString(),
    origem_id: origemId,
    destino_id: destinoId,
    responsavel: 'Op',
    observacao: null,
    encerrado_em: null,
    encerrado_por: null,
    motivo_fechamento: null,
    motivo_descricao: null,
  });
  if (error) throw new Error(`Falha ao seed lote: ${error.message}`);
  return id;
}

describe.skipIf(!ativo)('SupabaseContatoLavanderiaRepository (integração)', () => {
  let client: SupabaseClient;
  let repo: SupabaseContatoLavanderiaRepository;
  let origemId: LocalId;
  let destinoId: LocalId;
  let loteId: LoteId;

  beforeAll(() => {
    client = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    repo = new SupabaseContatoLavanderiaRepository(client);
  });

  beforeEach(async () => {
    await limpar(client);
    origemId = await seedLocal(client, 'Depósito', 'deposito');
    destinoId = await seedLocal(client, 'Lavanderia', 'lavanderia');
    loteId = await seedLote(client, origemId, destinoId);
  });

  it('registrar e listarPorLote round-trip preserva todos os campos', async () => {
    const contato = novoContato(loteId, {
      responsavel: 'Ana',
      tipo: 'whatsapp',
      observacao: 'Cobrei devolução do lote.',
      proximaAcao: 'Aguardar retorno até sexta',
      promessaRetornoData: '2026-04-20',
      dataHora: '2026-04-15T14:30:00.000Z',
    });
    await repo.registrar(contato);

    const lista = await repo.listarPorLote(loteId);
    expect(lista).toHaveLength(1);
    const lido = lista[0]!;
    expect(lido.id).toBe(contato.id);
    expect(lido.loteId).toBe(loteId);
    expect(lido.responsavel).toBe('Ana');
    expect(lido.tipo).toBe('whatsapp');
    expect(lido.observacao).toBe('Cobrei devolução do lote.');
    expect(lido.proximaAcao).toBe('Aguardar retorno até sexta');
    expect(lido.promessaRetornoData).toBe('2026-04-20');
    expect(new Date(lido.dataHora).toISOString()).toBe(contato.dataHora);
  });

  it('listarPorLote devolve vazio para lote sem contatos', async () => {
    const lista = await repo.listarPorLote(loteId);
    expect(lista).toEqual([]);
  });

  it('listar retorna todos os contatos de todos os lotes', async () => {
    const outroLoteId = await seedLote(client, origemId, destinoId);
    await repo.registrar(novoContato(loteId));
    await repo.registrar(novoContato(loteId));
    await repo.registrar(novoContato(outroLoteId));

    const todos = await repo.listar();
    expect(todos).toHaveLength(3);
  });

  it('listarPorLote isola por loteId (não vaza contatos de outro lote)', async () => {
    const outroLoteId = await seedLote(client, origemId, destinoId);
    await repo.registrar(novoContato(loteId, { responsavel: 'A' }));
    await repo.registrar(novoContato(loteId, { responsavel: 'B' }));
    await repo.registrar(novoContato(outroLoteId, { responsavel: 'C' }));

    const doLote = await repo.listarPorLote(loteId);
    expect(doLote).toHaveLength(2);
    expect(doLote.map((c) => c.responsavel).sort()).toEqual(['A', 'B']);
    expect(doLote.every((c) => c.loteId === loteId)).toBe(true);

    const doOutro = await repo.listarPorLote(outroLoteId);
    expect(doOutro).toHaveLength(1);
    expect(doOutro[0]?.responsavel).toBe('C');
  });

  it('listarPorLote ordena por data_hora ASC (cronológico)', async () => {
    // Insere fora de ordem deliberadamente — verifica que o ORDER BY
    // do repo ordena, não a ordem de inserção.
    await repo.registrar(
      novoContato(loteId, {
        responsavel: 'Segundo',
        dataHora: '2026-04-15T14:00:00.000Z',
      }),
    );
    await repo.registrar(
      novoContato(loteId, {
        responsavel: 'Terceiro',
        dataHora: '2026-04-16T09:00:00.000Z',
      }),
    );
    await repo.registrar(
      novoContato(loteId, {
        responsavel: 'Primeiro',
        dataHora: '2026-04-15T10:00:00.000Z',
      }),
    );

    const lista = await repo.listarPorLote(loteId);
    expect(lista.map((c) => c.responsavel)).toEqual([
      'Primeiro',
      'Segundo',
      'Terceiro',
    ]);
  });

  it('listar global também ordena por data_hora ASC', async () => {
    const outroLoteId = await seedLote(client, origemId, destinoId);
    await repo.registrar(
      novoContato(loteId, {
        responsavel: 'Meio',
        dataHora: '2026-04-15T14:00:00.000Z',
      }),
    );
    await repo.registrar(
      novoContato(outroLoteId, {
        responsavel: 'Cedo',
        dataHora: '2026-04-15T08:00:00.000Z',
      }),
    );
    await repo.registrar(
      novoContato(loteId, {
        responsavel: 'Tarde',
        dataHora: '2026-04-15T20:00:00.000Z',
      }),
    );

    const todos = await repo.listar();
    expect(todos.map((c) => c.responsavel)).toEqual(['Cedo', 'Meio', 'Tarde']);
  });

  it('FK lote_id inválida: registrar contato com lote inexistente é rejeitado', async () => {
    const loteFantasma = novoLoteId();
    await expect(
      repo.registrar(novoContato(loteFantasma, { responsavel: 'X' })),
    ).rejects.toThrow(/Falha ao registrar contato/i);
    expect(await repo.listar()).toHaveLength(0);
  });

  it('CHECK tipo: valor fora do enum é rejeitado', async () => {
    await expect(
      repo.registrar(
        novoContato(loteId, {
          tipo: 'sms' as TipoContatoLavanderia,
          responsavel: 'X',
        }),
      ),
    ).rejects.toThrow(/Falha ao registrar contato/i);
  });

  it('os 5 tipos válidos são aceitos', async () => {
    const tipos: TipoContatoLavanderia[] = [
      'whatsapp',
      'telefone',
      'email',
      'presencial',
      'outro',
    ];
    for (const tipo of tipos) {
      await repo.registrar(
        novoContato(loteId, {
          tipo,
          responsavel: tipo,
          dataHora: new Date(`2026-04-15T${tipos.indexOf(tipo) + 10}:00:00.000Z`).toISOString(),
        }),
      );
    }
    const lista = await repo.listarPorLote(loteId);
    expect(lista).toHaveLength(5);
    expect(lista.map((c) => c.tipo).sort()).toEqual(tipos.slice().sort());
  });

  it('nullable fields (observacao, proximaAcao, promessaRetornoData) round-trip preservam null', async () => {
    const contato = novoContato(loteId, {
      observacao: null,
      proximaAcao: null,
      promessaRetornoData: null,
    });
    await repo.registrar(contato);
    const lista = await repo.listarPorLote(loteId);
    expect(lista).toHaveLength(1);
    const lido = lista[0]!;
    expect(lido.observacao).toBeNull();
    expect(lido.proximaAcao).toBeNull();
    expect(lido.promessaRetornoData).toBeNull();
  });

  it('promessaRetornoData aceita ISO date (YYYY-MM-DD) e ISO datetime', async () => {
    // Schema usa text — aceita os dois formatos sem normalizar.
    const c1 = novoContato(loteId, {
      responsavel: 'date-only',
      promessaRetornoData: '2026-04-20',
      dataHora: '2026-04-15T10:00:00.000Z',
    });
    const c2 = novoContato(loteId, {
      responsavel: 'datetime',
      promessaRetornoData: '2026-04-21T15:00:00.000Z',
      dataHora: '2026-04-15T11:00:00.000Z',
    });
    await repo.registrar(c1);
    await repo.registrar(c2);
    const lista = await repo.listarPorLote(loteId);
    expect(lista[0]?.promessaRetornoData).toBe('2026-04-20');
    expect(lista[1]?.promessaRetornoData).toBe('2026-04-21T15:00:00.000Z');
  });

  it('FK ON DELETE RESTRICT: apagar lote com contato filho é rejeitado', async () => {
    await repo.registrar(novoContato(loteId));
    const { error } = await client
      .from('lotes_lavanderia')
      .delete()
      .eq('id', loteId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/foreign key|violates|still referenced/i);
    // Contato segue lá
    expect(await repo.listar()).toHaveLength(1);
  });

  it('limpar remove todos os contatos (mantém lote/locais)', async () => {
    await repo.registrar(novoContato(loteId));
    await repo.registrar(novoContato(loteId));
    expect(await repo.listar()).toHaveLength(2);
    await repo.limpar();
    expect(await repo.listar()).toHaveLength(0);
    // Pais preservados
    const { data: lotes } = await client.from('lotes_lavanderia').select('id');
    expect(lotes).toHaveLength(1);
    const { data: locais } = await client.from('locais').select('id');
    expect(locais).toHaveLength(2);
  });
});
