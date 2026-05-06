import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseLoteRepository } from './SupabaseLoteRepository';
import type { Lote } from '@/domain/entities/Lote';
import type { LocalId, LoteId } from '@/domain/types/ids';
import type { LocalTipo } from '@/domain/types/enums';

// Teste de integração contra Supabase real. Mesmo gating dos outros
// repos: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_TEST_OK=1.
//
// Cleanup respeita ordem de FK: lotes_lavanderia → locais. Inverter quebra
// com FK error pq lotes referenciam locais (RESTRICT).

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const optIn = process.env.SUPABASE_TEST_OK === '1';
const ativo = !!url && !!key && optIn;

const ID_ZERO = '00000000-0000-0000-0000-000000000000';

function novoLoteId(): LoteId {
  return crypto.randomUUID() as LoteId;
}

function novoLocalId(): LocalId {
  return crypto.randomUUID() as LocalId;
}

let proximoCodigo = 1;
function novoCodigo(): string {
  // Fixo + sequencial pra evitar colisão entre testes que rodam dentro da
  // mesma execução. Reset visual na descrição não é necessário.
  return `L-TST-${String(proximoCodigo++).padStart(5, '0')}`;
}

function novoLote(
  origemId: LocalId,
  destinoId: LocalId,
  overrides: Partial<Lote> = {},
): Lote {
  return {
    id: novoLoteId(),
    codigo: novoCodigo(),
    criadoEm: new Date().toISOString(),
    dataEnvio: new Date().toISOString(),
    origemId,
    destinoId,
    responsavel: 'Ana Teste',
    observacao: null,
    encerradoEm: null,
    encerradoPor: null,
    motivoFechamento: null,
    motivoDescricao: null,
    origemDivergencia: null,
    ...overrides,
  };
}

// Cleanup: ordem de FK importa. lotes_lavanderia primeiro (filhos), locais
// depois (pais). Senão Postgres rejeita com FK violation.
async function limpar(client: SupabaseClient): Promise<void> {
  const lotesErr = (await client.from('lotes_lavanderia').delete().neq('id', ID_ZERO)).error;
  if (lotesErr) throw new Error(`Falha no cleanup de lotes: ${lotesErr.message}`);
  const locaisErr = (await client.from('locais').delete().neq('id', ID_ZERO)).error;
  if (locaisErr) throw new Error(`Falha no cleanup de locais: ${locaisErr.message}`);
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

describe.skipIf(!ativo)('SupabaseLoteRepository (integração)', () => {
  let client: SupabaseClient;
  let repo: SupabaseLoteRepository;
  let origemId: LocalId;
  let destinoId: LocalId;

  beforeAll(() => {
    client = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    repo = new SupabaseLoteRepository(client);
  });

  beforeEach(async () => {
    await limpar(client);
    origemId = await seedLocal(client, 'Depósito Central', 'deposito');
    destinoId = await seedLocal(client, 'Lavanderia X', 'lavanderia');
  });

  it('criar lote válido + porId devolve o mesmo registro com mapping snake↔camel', async () => {
    const lote = novoLote(origemId, destinoId, {
      responsavel: 'Ana',
      observacao: 'Lote semanal',
      dataEnvio: '2026-04-15T10:00:00.000Z',
    });
    await repo.criar(lote);
    const lido = await repo.porId(lote.id);
    expect(lido).not.toBeNull();
    expect(lido!.id).toBe(lote.id);
    expect(lido!.codigo).toBe(lote.codigo);
    expect(lido!.origemId).toBe(origemId);
    expect(lido!.destinoId).toBe(destinoId);
    expect(lido!.responsavel).toBe('Ana');
    expect(lido!.observacao).toBe('Lote semanal');
    // Encerramento todo null em lote novo
    expect(lido!.encerradoEm).toBeNull();
    expect(lido!.encerradoPor).toBeNull();
    expect(lido!.motivoFechamento).toBeNull();
    expect(lido!.motivoDescricao).toBeNull();
    // Comparação semântica para timestamptz (vem com `+00:00` em vez de `Z`)
    expect(new Date(lido!.dataEnvio).toISOString()).toBe(lote.dataEnvio);
    expect(new Date(lido!.criadoEm).toISOString()).toBe(lote.criadoEm);
  });

  it('porCodigo encontra pelo código', async () => {
    const lote = novoLote(origemId, destinoId, { codigo: 'L-2026-001' });
    await repo.criar(lote);
    const lido = await repo.porCodigo('L-2026-001');
    expect(lido).not.toBeNull();
    expect(lido!.id).toBe(lote.id);
  });

  it('porCodigo devolve null para código inexistente', async () => {
    const lido = await repo.porCodigo('CÓDIGO-QUE-NÃO-EXISTE');
    expect(lido).toBeNull();
  });

  it('porId devolve null quando não existe', async () => {
    const lido = await repo.porId(novoLoteId());
    expect(lido).toBeNull();
  });

  it('listar sem filtro retorna todos', async () => {
    await repo.criar(novoLote(origemId, destinoId));
    await repo.criar(novoLote(origemId, destinoId));
    await repo.criar(novoLote(origemId, destinoId));
    const lista = await repo.listar();
    expect(lista).toHaveLength(3);
  });

  it('listar com filtro destinoId isola por destino', async () => {
    const outroDestino = await seedLocal(client, 'Outra Lavanderia', 'lavanderia');
    await repo.criar(novoLote(origemId, destinoId)); // L1 → destinoId
    await repo.criar(novoLote(origemId, destinoId)); // L2 → destinoId
    await repo.criar(novoLote(origemId, outroDestino)); // L3 → outroDestino

    const noDestino = await repo.listar({ destinoId });
    expect(noDestino).toHaveLength(2);
    expect(noDestino.every((l) => l.destinoId === destinoId)).toBe(true);

    const noOutro = await repo.listar({ destinoId: outroDestino });
    expect(noOutro).toHaveLength(1);
  });

  it('listar com filtro de data (desde/ate) respeita range temporal', async () => {
    await repo.criar(
      novoLote(origemId, destinoId, { dataEnvio: '2026-01-15T10:00:00.000Z' }),
    );
    await repo.criar(
      novoLote(origemId, destinoId, { dataEnvio: '2026-02-15T10:00:00.000Z' }),
    );
    await repo.criar(
      novoLote(origemId, destinoId, { dataEnvio: '2026-03-15T10:00:00.000Z' }),
    );

    const desdeFev = await repo.listar({ desdeDataEnvio: '2026-02-01T00:00:00.000Z' });
    expect(desdeFev).toHaveLength(2);

    const ateFev = await repo.listar({ ateDataEnvio: '2026-02-28T23:59:59.999Z' });
    expect(ateFev).toHaveLength(2);

    const apenasFev = await repo.listar({
      desdeDataEnvio: '2026-02-01T00:00:00.000Z',
      ateDataEnvio: '2026-02-28T23:59:59.999Z',
    });
    expect(apenasFev).toHaveLength(1);
  });

  it('atualizar para encerrado preenche os 3 campos juntos (CHECK passa)', async () => {
    const lote = novoLote(origemId, destinoId);
    await repo.criar(lote);
    const encerradoEm = '2026-05-01T12:00:00.000Z';
    await repo.atualizar({
      ...lote,
      encerradoEm,
      encerradoPor: 'Gestor',
      motivoFechamento: 'perda_confirmada',
      motivoDescricao: '5 peças extraviadas',
    });
    const lido = await repo.porId(lote.id);
    expect(lido!.encerradoPor).toBe('Gestor');
    expect(lido!.motivoFechamento).toBe('perda_confirmada');
    expect(lido!.motivoDescricao).toBe('5 peças extraviadas');
    expect(new Date(lido!.encerradoEm!).toISOString()).toBe(encerradoEm);
  });

  it('atualizar lança erro quando id não existe (mesma semântica do JSON/InMemory)', async () => {
    const fantasma = novoLote(origemId, destinoId);
    await expect(repo.atualizar(fantasma)).rejects.toThrow(
      /não encontrado para atualizar/i,
    );
  });

  it('FK origem inválida: criar com origemId inexistente é rejeitado', async () => {
    const origemFantasma = novoLocalId();
    const lote = novoLote(origemFantasma, destinoId);
    await expect(repo.criar(lote)).rejects.toThrow(/Falha ao criar lote/i);
    expect(await repo.listar()).toHaveLength(0);
  });

  it('FK destino inválida: criar com destinoId inexistente é rejeitado', async () => {
    const destinoFantasma = novoLocalId();
    const lote = novoLote(origemId, destinoFantasma);
    await expect(repo.criar(lote)).rejects.toThrow(/Falha ao criar lote/i);
    expect(await repo.listar()).toHaveLength(0);
  });

  it('CHECK encerramento: só encerradoEm sem motivo é rejeitado pelo banco', async () => {
    // Estado parcial: encerradoEm preenchido mas motivoFechamento null.
    // TS aceita a combinação (4 campos independentemente nullable), mas o
    // CHECK constraint do schema rejeita.
    const inconsistente = novoLote(origemId, destinoId, {
      encerradoEm: '2026-05-01T12:00:00.000Z',
      encerradoPor: 'Gestor',
      motivoFechamento: null,
    });
    await expect(repo.criar(inconsistente)).rejects.toThrow(
      /Falha ao criar lote/i,
    );
  });

  it('CHECK encerramento: só motivoFechamento sem encerradoEm é rejeitado', async () => {
    const inconsistente = novoLote(origemId, destinoId, {
      encerradoEm: null,
      encerradoPor: null,
      motivoFechamento: 'danificado',
    });
    await expect(repo.criar(inconsistente)).rejects.toThrow(
      /Falha ao criar lote/i,
    );
  });

  it('CHECK encerramento: encerradoEm + motivoFechamento sem encerradoPor é rejeitado', async () => {
    const inconsistente = novoLote(origemId, destinoId, {
      encerradoEm: '2026-05-01T12:00:00.000Z',
      encerradoPor: null,
      motivoFechamento: 'extravio',
    });
    await expect(repo.criar(inconsistente)).rejects.toThrow(
      /Falha ao criar lote/i,
    );
  });

  it('UNIQUE codigo: dois lotes com mesmo código é rejeitado pelo banco', async () => {
    const codigo = 'L-DUPLICADO-001';
    await repo.criar(novoLote(origemId, destinoId, { codigo }));
    await expect(
      repo.criar(novoLote(origemId, destinoId, { codigo })),
    ).rejects.toThrow(/Falha ao criar lote/i);
    // Apenas o primeiro persistiu
    expect(await repo.listar()).toHaveLength(1);
  });

  it('nullable fields (observacao + motivoDescricao) round-trip preservam null', async () => {
    const lote = novoLote(origemId, destinoId, {
      observacao: null,
      // Motivo descrição também null, mesmo num lote NÃO encerrado
    });
    await repo.criar(lote);
    const lido = await repo.porId(lote.id);
    expect(lido!.observacao).toBeNull();
    expect(lido!.motivoDescricao).toBeNull();
  });

  it('encerramento com motivoDescricao null (campo opcional) é aceito', async () => {
    // CHECK constraint exige encerradoEm + encerradoPor + motivoFechamento
    // juntos. motivoDescricao é independente — pode ser null mesmo encerrado.
    const lote = novoLote(origemId, destinoId);
    await repo.criar(lote);
    await repo.atualizar({
      ...lote,
      encerradoEm: '2026-05-01T12:00:00.000Z',
      encerradoPor: 'Gestor',
      motivoFechamento: 'outros',
      motivoDescricao: null,
    });
    const lido = await repo.porId(lote.id);
    expect(lido!.motivoFechamento).toBe('outros');
    expect(lido!.motivoDescricao).toBeNull();
  });

  it('FK ON DELETE RESTRICT: apagar local com lote filho é rejeitado', async () => {
    await repo.criar(novoLote(origemId, destinoId));
    const { error } = await client.from('locais').delete().eq('id', origemId);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/foreign key|violates|still referenced/i);
    // Lote ainda lá
    expect(await repo.listar()).toHaveLength(1);
  });

  it('limpar remove todos os lotes (mantém locais)', async () => {
    await repo.criar(novoLote(origemId, destinoId));
    await repo.criar(novoLote(origemId, destinoId));
    expect(await repo.listar()).toHaveLength(2);
    await repo.limpar();
    expect(await repo.listar()).toHaveLength(0);
    // Locais (pais) preservados — limpar é só lotes
    const { data: locais } = await client.from('locais').select('id');
    expect(locais).toHaveLength(2);
  });
});
