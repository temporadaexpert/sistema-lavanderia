import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseMovimentacaoRepository } from './SupabaseMovimentacaoRepository';
import type { Movimentacao } from '@/domain/entities/Movimentacao';
import type {
  ItemId,
  LocalId,
  LoteId,
  MovimentacaoId,
} from '@/domain/types/ids';
import type { LocalTipo, MovimentacaoTipo } from '@/domain/types/enums';

// Teste de integração contra Supabase real. Mesmo gating dos outros repos.
//
// Cleanup respeita ordem de FK (filhos antes de pais):
//   movimentacoes → lotes_lavanderia → itens → categorias → locais
// Inverter quebra com "violates foreign key constraint".

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const optIn = process.env.SUPABASE_TEST_OK === '1';
const ativo = !!url && !!key && optIn;

const ID_ZERO = '00000000-0000-0000-0000-000000000000';

function novoMovId(): MovimentacaoId {
  return crypto.randomUUID() as MovimentacaoId;
}
function novoItemId(): ItemId {
  return crypto.randomUUID() as ItemId;
}
function novoLocalId(): LocalId {
  return crypto.randomUUID() as LocalId;
}
function novoLoteId(): LoteId {
  return crypto.randomUUID() as LoteId;
}

let proximoCodigoLote = 1;
function novoCodigoLote(): string {
  return `L-MOV-${String(proximoCodigoLote++).padStart(5, '0')}`;
}

function novaMovimentacao(
  itemId: ItemId,
  overrides: Partial<Movimentacao> = {},
): Movimentacao {
  return {
    id: novoMovId(),
    dataHora: new Date().toISOString(),
    itemId,
    quantidade: 1,
    tipo: 'ajuste',
    origemId: null,
    destinoId: null,
    responsavel: 'Op Teste',
    observacao: null,
    loteId: null,
    precoUnitarioSnapshot: null,
    registradoEm: new Date().toISOString(),
    cancelada: false,
    canceladoEm: null,
    canceladoPor: null,
    motivoCancelamento: null,
    conciliado: true,
    ...overrides,
  };
}

// Cleanup: ordem importa (filhos antes de pais por causa de FK RESTRICT).
async function limpar(client: SupabaseClient): Promise<void> {
  const passos: Array<[string, string]> = [
    ['movimentacoes', 'movimentações'],
    ['lotes_lavanderia', 'lotes'],
    ['itens', 'itens'],
    ['categorias', 'categorias'],
    ['locais', 'locais'],
  ];
  for (const [tabela, nome] of passos) {
    const { error } = await client.from(tabela).delete().neq('id', ID_ZERO);
    if (error) throw new Error(`Falha no cleanup de ${nome}: ${error.message}`);
  }
}

async function seedCategoria(client: SupabaseClient): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await client.from('categorias').insert({
    id,
    nome: `Cat-${id.slice(0, 8)}`,
    ativo: true,
    criado_em: new Date().toISOString(),
  });
  if (error) throw new Error(`Falha ao seed categoria: ${error.message}`);
  return id;
}

async function seedItem(client: SupabaseClient, categoriaId: string): Promise<ItemId> {
  const id = novoItemId();
  const { error } = await client.from('itens').insert({
    id,
    nome: 'Toalha Teste',
    categoria_id: categoriaId,
    categoria: 'Cat Teste',
    unidade: 'un',
    valor_unitario: 30,
    estoque_minimo: null,
    estoque_total: 100,
    ativo: true,
    criado_em: new Date().toISOString(),
  });
  if (error) throw new Error(`Falha ao seed item: ${error.message}`);
  return id;
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

describe.skipIf(!ativo)('SupabaseMovimentacaoRepository (integração)', () => {
  let client: SupabaseClient;
  let repo: SupabaseMovimentacaoRepository;
  let categoriaId: string;
  let itemId: ItemId;
  let origemId: LocalId;
  let destinoId: LocalId;

  beforeAll(() => {
    client = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    repo = new SupabaseMovimentacaoRepository(client);
  });

  beforeEach(async () => {
    await limpar(client);
    categoriaId = await seedCategoria(client);
    itemId = await seedItem(client, categoriaId);
    origemId = await seedLocal(client, 'Depósito', 'deposito');
    destinoId = await seedLocal(client, 'Lavanderia', 'lavanderia');
  });

  it('registrar e porId devolve a mesma movimentação com mapping snake↔camel', async () => {
    const mov = novaMovimentacao(itemId, {
      tipo: 'envio_lavanderia',
      quantidade: 10,
      origemId,
      destinoId,
      responsavel: 'Ana',
      observacao: 'Lote semanal',
      precoUnitarioSnapshot: 30.5,
      dataHora: '2026-04-15T10:00:00.000Z',
    });
    await repo.registrar(mov);
    const lido = await repo.porId(mov.id);
    expect(lido).not.toBeNull();
    expect(lido!.id).toBe(mov.id);
    expect(lido!.itemId).toBe(itemId);
    expect(lido!.quantidade).toBe(10);
    expect(lido!.tipo).toBe('envio_lavanderia');
    expect(lido!.origemId).toBe(origemId);
    expect(lido!.destinoId).toBe(destinoId);
    expect(lido!.responsavel).toBe('Ana');
    expect(lido!.observacao).toBe('Lote semanal');
    expect(lido!.precoUnitarioSnapshot).toBe(30.5);
    expect(lido!.cancelada).toBe(false);
    expect(lido!.canceladoEm).toBeNull();
    expect(lido!.canceladoPor).toBeNull();
    expect(lido!.motivoCancelamento).toBeNull();
    expect(new Date(lido!.dataHora).toISOString()).toBe(mov.dataHora);
  });

  it('porId devolve null quando id não existe', async () => {
    const lido = await repo.porId(novoMovId());
    expect(lido).toBeNull();
  });

  it('listar sem filtro retorna apenas não-canceladas', async () => {
    await repo.registrar(novaMovimentacao(itemId, { tipo: 'ajuste', quantidade: 5 }));
    await repo.registrar(novaMovimentacao(itemId, { tipo: 'ajuste', quantidade: 3 }));
    const lista = await repo.listar();
    expect(lista).toHaveLength(2);
    expect(lista.every((m) => !m.cancelada)).toBe(true);
  });

  it('listar com incluirCanceladas=true mostra todas, inclusive canceladas', async () => {
    const mov1 = novaMovimentacao(itemId, { quantidade: 5 });
    const mov2 = novaMovimentacao(itemId, { quantidade: 3 });
    await repo.registrar(mov1);
    await repo.registrar(mov2);
    await repo.marcarCancelada(mov1.id, {
      canceladoEm: new Date().toISOString(),
      canceladoPor: 'Admin',
      motivoCancelamento: 'Erro de digitação',
    });

    const sem = await repo.listar();
    expect(sem).toHaveLength(1);
    expect(sem[0]?.id).toBe(mov2.id);

    const com = await repo.listar({ incluirCanceladas: true });
    expect(com).toHaveLength(2);
  });

  it('filtro por itemId isola apenas movs do item', async () => {
    const outroItemId = await seedItem(client, categoriaId);
    await repo.registrar(novaMovimentacao(itemId, { quantidade: 5 }));
    await repo.registrar(novaMovimentacao(itemId, { quantidade: 3 }));
    await repo.registrar(novaMovimentacao(outroItemId, { quantidade: 7 }));

    const apenasItem = await repo.listar({ itemId });
    expect(apenasItem).toHaveLength(2);
    expect(apenasItem.every((m) => m.itemId === itemId)).toBe(true);
  });

  it('filtro por localId casa origem OR destino (não só um lado)', async () => {
    // Cenário: 3 movs com diferentes papéis para o `origemId`
    //   - mov A: origem=origemId, destino=destinoId  → match
    //   - mov B: origem=destinoId, destino=origemId  → match (origemId vira destino)
    //   - mov C: origem=destinoId, destino=null      → não-match (origemId não aparece)
    await repo.registrar(novaMovimentacao(itemId, {
      tipo: 'envio_lavanderia',
      origemId,
      destinoId,
      quantidade: 1,
    }));
    await repo.registrar(novaMovimentacao(itemId, {
      tipo: 'retorno_lavanderia',
      origemId: destinoId,
      destinoId: origemId,
      quantidade: 1,
    }));
    await repo.registrar(novaMovimentacao(itemId, {
      tipo: 'saida_imovel',
      origemId: destinoId,
      destinoId: null,
      quantidade: 1,
    }));

    const lista = await repo.listar({ localId: origemId });
    expect(lista).toHaveLength(2);
    expect(
      lista.every((m) => m.origemId === origemId || m.destinoId === origemId),
    ).toBe(true);
  });

  it('filtro por tipo isola apenas o tipo escolhido', async () => {
    await repo.registrar(novaMovimentacao(itemId, { tipo: 'ajuste', quantidade: 1 }));
    await repo.registrar(novaMovimentacao(itemId, {
      tipo: 'envio_lavanderia',
      origemId,
      destinoId,
      quantidade: 1,
    }));
    await repo.registrar(novaMovimentacao(itemId, {
      tipo: 'retorno_lavanderia',
      origemId: destinoId,
      destinoId: origemId,
      quantidade: 1,
    }));

    const ajustes = await repo.listar({ tipo: 'ajuste' });
    expect(ajustes).toHaveLength(1);

    const envios = await repo.listar({ tipo: 'envio_lavanderia' });
    expect(envios).toHaveLength(1);
  });

  it('filtro por loteId isola movs do lote', async () => {
    const loteId = await seedLote(client, origemId, destinoId);
    await repo.registrar(novaMovimentacao(itemId, {
      tipo: 'envio_lavanderia',
      origemId,
      destinoId,
      loteId,
      quantidade: 5,
    }));
    await repo.registrar(novaMovimentacao(itemId, {
      tipo: 'envio_lavanderia',
      origemId,
      destinoId,
      loteId,
      quantidade: 3,
    }));
    // Mov sem lote
    await repo.registrar(novaMovimentacao(itemId, { tipo: 'ajuste', quantidade: 1 }));

    const doLote = await repo.listar({ loteId });
    expect(doLote).toHaveLength(2);
    expect(doLote.every((m) => m.loteId === loteId)).toBe(true);
  });

  it('filtro por desdeDataHora/ateDataHora respeita range inclusivo', async () => {
    await repo.registrar(novaMovimentacao(itemId, {
      dataHora: '2026-01-15T10:00:00.000Z',
      quantidade: 1,
    }));
    await repo.registrar(novaMovimentacao(itemId, {
      dataHora: '2026-02-15T10:00:00.000Z',
      quantidade: 2,
    }));
    await repo.registrar(novaMovimentacao(itemId, {
      dataHora: '2026-03-15T10:00:00.000Z',
      quantidade: 3,
    }));

    const desdeFev = await repo.listar({ desdeDataHora: '2026-02-01T00:00:00.000Z' });
    expect(desdeFev).toHaveLength(2);

    const ateFev = await repo.listar({ ateDataHora: '2026-02-28T23:59:59.999Z' });
    expect(ateFev).toHaveLength(2);

    const apenasFev = await repo.listar({
      desdeDataHora: '2026-02-01T00:00:00.000Z',
      ateDataHora: '2026-02-28T23:59:59.999Z',
    });
    expect(apenasFev).toHaveLength(1);
    expect(apenasFev[0]?.quantidade).toBe(2);
  });

  it('filtros combinados (item + tipo + lote + range) compõem com AND', async () => {
    const loteId = await seedLote(client, origemId, destinoId);
    await repo.registrar(novaMovimentacao(itemId, {
      tipo: 'envio_lavanderia',
      origemId,
      destinoId,
      loteId,
      dataHora: '2026-04-10T10:00:00.000Z',
      quantidade: 5,
    }));
    // Não casa o tipo
    await repo.registrar(novaMovimentacao(itemId, {
      tipo: 'ajuste',
      loteId,
      dataHora: '2026-04-10T11:00:00.000Z',
      quantidade: 2,
    }));
    // Fora do range
    await repo.registrar(novaMovimentacao(itemId, {
      tipo: 'envio_lavanderia',
      origemId,
      destinoId,
      loteId,
      dataHora: '2026-05-10T10:00:00.000Z',
      quantidade: 8,
    }));

    const filtrado = await repo.listar({
      itemId,
      tipo: 'envio_lavanderia',
      loteId,
      desdeDataHora: '2026-04-01T00:00:00.000Z',
      ateDataHora: '2026-04-30T23:59:59.999Z',
    });
    expect(filtrado).toHaveLength(1);
    expect(filtrado[0]?.quantidade).toBe(5);
  });

  it('marcarCancelada preenche os 4 campos juntos preservando o resto', async () => {
    const mov = novaMovimentacao(itemId, {
      tipo: 'envio_lavanderia',
      origemId,
      destinoId,
      quantidade: 10,
      observacao: 'Original',
      precoUnitarioSnapshot: 30,
    });
    await repo.registrar(mov);
    const cancelEm = '2026-05-01T15:00:00.000Z';
    await repo.marcarCancelada(mov.id, {
      canceladoEm: cancelEm,
      canceladoPor: 'Admin',
      motivoCancelamento: 'Erro do operador',
    });

    const lido = await repo.porId(mov.id);
    expect(lido!.cancelada).toBe(true);
    expect(lido!.canceladoPor).toBe('Admin');
    expect(lido!.motivoCancelamento).toBe('Erro do operador');
    expect(new Date(lido!.canceladoEm!).toISOString()).toBe(cancelEm);
    // Campos operacionais preservados (não foram tocados pelo patch)
    expect(lido!.tipo).toBe('envio_lavanderia');
    expect(lido!.quantidade).toBe(10);
    expect(lido!.origemId).toBe(origemId);
    expect(lido!.destinoId).toBe(destinoId);
    expect(lido!.observacao).toBe('Original');
    expect(lido!.precoUnitarioSnapshot).toBe(30);
  });

  it('marcarCancelada lança erro quando id não existe', async () => {
    await expect(
      repo.marcarCancelada(novoMovId(), {
        canceladoEm: new Date().toISOString(),
        canceladoPor: 'Admin',
        motivoCancelamento: 'X',
      }),
    ).rejects.toThrow(/não encontrada para cancelar/i);
  });

  it('marcarCancelada lança erro quando já está cancelada', async () => {
    const mov = novaMovimentacao(itemId);
    await repo.registrar(mov);
    await repo.marcarCancelada(mov.id, {
      canceladoEm: new Date().toISOString(),
      canceladoPor: 'Admin',
      motivoCancelamento: 'Primeira',
    });
    await expect(
      repo.marcarCancelada(mov.id, {
        canceladoEm: new Date().toISOString(),
        canceladoPor: 'Admin',
        motivoCancelamento: 'Segunda',
      }),
    ).rejects.toThrow(/já cancelada/i);
  });

  it('CHECK movs_cancelamento_consistente: update parcial via raw client é rejeitado', async () => {
    // Bypass do repo pra testar a CHECK do banco diretamente. O repo
    // garante consistência sempre via marcarCancelada, mas a regra do
    // schema é a rede de segurança final: tentativa de gravar cancelada=true
    // sem os 3 campos de auditoria → CHECK rejeita.
    const mov = novaMovimentacao(itemId);
    await repo.registrar(mov);
    const { error } = await client
      .from('movimentacoes')
      .update({ cancelada: true })
      .eq('id', mov.id);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/check constraint|movs_cancelamento_consistente|violates/i);
    // Estado original preservado
    const lido = await repo.porId(mov.id);
    expect(lido!.cancelada).toBe(false);
  });

  it('FK item_id inválida: registrar com item inexistente é rejeitado', async () => {
    const itemFantasma = novoItemId();
    await expect(
      repo.registrar(novaMovimentacao(itemFantasma, { quantidade: 1 })),
    ).rejects.toThrow(/Falha ao registrar movimentação/i);
    expect(await repo.listar({ incluirCanceladas: true })).toHaveLength(0);
  });

  it('FK origem_id inválida: registrar com origem inexistente é rejeitado', async () => {
    const origemFantasma = novoLocalId();
    await expect(
      repo.registrar(novaMovimentacao(itemId, {
        tipo: 'envio_lavanderia',
        origemId: origemFantasma,
        destinoId,
        quantidade: 1,
      })),
    ).rejects.toThrow(/Falha ao registrar movimentação/i);
  });

  it('FK destino_id inválida: registrar com destino inexistente é rejeitado', async () => {
    const destinoFantasma = novoLocalId();
    await expect(
      repo.registrar(novaMovimentacao(itemId, {
        tipo: 'envio_lavanderia',
        origemId,
        destinoId: destinoFantasma,
        quantidade: 1,
      })),
    ).rejects.toThrow(/Falha ao registrar movimentação/i);
  });

  it('FK lote_id inválida: registrar com lote inexistente é rejeitado', async () => {
    const loteFantasma = novoLoteId();
    await expect(
      repo.registrar(novaMovimentacao(itemId, {
        tipo: 'envio_lavanderia',
        origemId,
        destinoId,
        loteId: loteFantasma,
        quantidade: 1,
      })),
    ).rejects.toThrow(/Falha ao registrar movimentação/i);
  });

  it('CHECK quantidade > 0: quantidade zero é rejeitada', async () => {
    await expect(
      repo.registrar(novaMovimentacao(itemId, { quantidade: 0 })),
    ).rejects.toThrow(/Falha ao registrar movimentação/i);
  });

  it('CHECK quantidade > 0: quantidade negativa é rejeitada', async () => {
    await expect(
      repo.registrar(novaMovimentacao(itemId, { quantidade: -5 })),
    ).rejects.toThrow(/Falha ao registrar movimentação/i);
  });

  it('CHECK tipo inválido: tipo fora do enum é rejeitado', async () => {
    await expect(
      repo.registrar(novaMovimentacao(itemId, {
        tipo: 'tipo_inexistente' as MovimentacaoTipo,
        quantidade: 1,
      })),
    ).rejects.toThrow(/Falha ao registrar movimentação/i);
  });

  it('nullable fields (origem, destino, lote, observacao, preco) round-trip preservam null', async () => {
    const mov = novaMovimentacao(itemId, {
      tipo: 'ajuste',
      origemId: null,
      destinoId: null,
      loteId: null,
      observacao: null,
      precoUnitarioSnapshot: null,
      quantidade: 1,
    });
    await repo.registrar(mov);
    const lido = await repo.porId(mov.id);
    expect(lido!.origemId).toBeNull();
    expect(lido!.destinoId).toBeNull();
    expect(lido!.loteId).toBeNull();
    expect(lido!.observacao).toBeNull();
    expect(lido!.precoUnitarioSnapshot).toBeNull();
  });

  it('limpar remove todas as movimentações (mantém pais)', async () => {
    await repo.registrar(novaMovimentacao(itemId, { quantidade: 1 }));
    await repo.registrar(novaMovimentacao(itemId, { quantidade: 2 }));
    expect(await repo.listar()).toHaveLength(2);
    await repo.limpar();
    expect(await repo.listar()).toHaveLength(0);
    // Pais preservados
    const { data: itens } = await client.from('itens').select('id');
    expect(itens).toHaveLength(1);
    const { data: locais } = await client.from('locais').select('id');
    expect(locais).toHaveLength(2);
  });
});
