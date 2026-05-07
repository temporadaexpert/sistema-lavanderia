import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SupabaseControleDiarioRepository } from './SupabaseControleDiarioRepository';
import type {
  ControleDiarioEnxoval,
  LinhaEnviada,
  LinhaRetornada,
} from '@/domain/entities/ControleDiarioEnxoval';
import type { ControleDiarioId, ItemId } from '@/domain/types/ids';

// Teste de integração contra Supabase real. Mesmo gating dos outros repos.
//
// controles_diarios é uma tabela "isolada" — sem FKs entrando ou saindo.
// Cleanup é simples: apaga só ela. Os itemIds dentro do JSONB são strings
// quaisquer (o schema NÃO faz FK pro conteúdo do JSONB), então não é
// necessário seedar itens reais pra preencher enviado/retorno.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const optIn = process.env.SUPABASE_TEST_OK === '1';
const ativo = !!url && !!key && optIn;

const ID_ZERO = '00000000-0000-0000-0000-000000000000';

function novoId(): ControleDiarioId {
  return crypto.randomUUID() as ControleDiarioId;
}
function novoItemId(): ItemId {
  return crypto.randomUUID() as ItemId;
}

function novoControle(
  data: string,
  overrides: Partial<ControleDiarioEnxoval> = {},
): ControleDiarioEnxoval {
  return {
    id: novoId(),
    data,
    status: 'aberto',
    enviado: [],
    retorno: [],
    abertoEm: new Date().toISOString(),
    fechadoEm: null,
    responsavelEnvio: null,
    responsavelRetorno: null,
    responsavelFechamento: null,
    motivoDivergencia: null,
    classificacaoDivergencia: null,
    origemDivergencia: null,
    ...overrides,
  };
}

async function limpar(client: SupabaseClient): Promise<void> {
  const { error } = await client
    .from('controles_diarios')
    .delete()
    .neq('id', ID_ZERO);
  if (error) throw new Error(`Falha no cleanup: ${error.message}`);
}

describe.skipIf(!ativo)('SupabaseControleDiarioRepository (integração)', () => {
  let client: SupabaseClient;
  let repo: SupabaseControleDiarioRepository;

  beforeAll(() => {
    client = createClient(url!, key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    repo = new SupabaseControleDiarioRepository(client);
  });

  beforeEach(async () => {
    await limpar(client);
  });

  it('salvar novo + porData round-trip preserva todos os campos top-level', async () => {
    const itemId1 = novoItemId();
    const itemId2 = novoItemId();
    const controle = novoControle('2026-04-15', {
      enviado: [
        { itemId: itemId1, quantidade: 30 },
        { itemId: itemId2, quantidade: 20 },
      ],
      retorno: [],
      responsavelEnvio: 'Ana',
      abertoEm: '2026-04-15T08:00:00.000Z',
    });
    await repo.salvar(controle);
    const lido = await repo.porData('2026-04-15');
    expect(lido).not.toBeNull();
    expect(lido!.id).toBe(controle.id);
    expect(lido!.data).toBe('2026-04-15');
    expect(lido!.status).toBe('aberto');
    expect(lido!.responsavelEnvio).toBe('Ana');
    expect(lido!.responsavelRetorno).toBeNull();
    expect(lido!.responsavelFechamento).toBeNull();
    expect(lido!.motivoDivergencia).toBeNull();
    expect(lido!.fechadoEm).toBeNull();
    expect(new Date(lido!.abertoEm).toISOString()).toBe(controle.abertoEm);
  });

  it('porData devolve null para data inexistente', async () => {
    const lido = await repo.porData('2026-12-31');
    expect(lido).toBeNull();
  });

  it('listar retorna todos os controles', async () => {
    await repo.salvar(novoControle('2026-04-10'));
    await repo.salvar(novoControle('2026-04-11'));
    await repo.salvar(novoControle('2026-04-12'));
    const lista = await repo.listar();
    expect(lista).toHaveLength(3);
    expect(lista.map((c) => c.data).sort()).toEqual([
      '2026-04-10',
      '2026-04-11',
      '2026-04-12',
    ]);
  });

  it('salvar UPSERT: duas vezes na mesma data substitui (não duplica)', async () => {
    const c1 = novoControle('2026-04-15', { responsavelEnvio: 'Ana' });
    await repo.salvar(c1);

    // Mesma data, conteúdo diferente. UPSERT bate em UNIQUE(data) e atualiza.
    const c2 = novoControle('2026-04-15', { responsavelEnvio: 'Bruno' });
    await repo.salvar(c2);

    const lista = await repo.listar();
    expect(lista).toHaveLength(1);
    const lido = await repo.porData('2026-04-15');
    expect(lido!.responsavelEnvio).toBe('Bruno');
  });

  it('JSONB enviado: array de múltiplos itens com itemId/quantidade preserva chaves camelCase', async () => {
    const item1 = novoItemId();
    const item2 = novoItemId();
    const item3 = novoItemId();
    const enviado: LinhaEnviada[] = [
      { itemId: item1, quantidade: 10 },
      { itemId: item2, quantidade: 25 },
      { itemId: item3, quantidade: 5 },
    ];
    await repo.salvar(novoControle('2026-04-15', { enviado }));

    const lido = await repo.porData('2026-04-15');
    expect(lido!.enviado).toHaveLength(3);
    expect(lido!.enviado[0]?.itemId).toBe(item1);
    expect(lido!.enviado[0]?.quantidade).toBe(10);
    expect(lido!.enviado[1]?.itemId).toBe(item2);
    expect(lido!.enviado[1]?.quantidade).toBe(25);
    expect(lido!.enviado[2]?.itemId).toBe(item3);
    expect(lido!.enviado[2]?.quantidade).toBe(5);
  });

  it('JSONB retorno: array com recebidoSujo + recebidoLimpo preserva todas as chaves', async () => {
    const item1 = novoItemId();
    const item2 = novoItemId();
    const retorno: LinhaRetornada[] = [
      { itemId: item1, recebidoSujo: 8, recebidoLimpo: 2 },
      { itemId: item2, recebidoSujo: 20, recebidoLimpo: 5 },
    ];
    await repo.salvar(novoControle('2026-04-15', { retorno }));

    const lido = await repo.porData('2026-04-15');
    expect(lido!.retorno).toHaveLength(2);
    expect(lido!.retorno[0]?.itemId).toBe(item1);
    expect(lido!.retorno[0]?.recebidoSujo).toBe(8);
    expect(lido!.retorno[0]?.recebidoLimpo).toBe(2);
    expect(lido!.retorno[1]?.recebidoSujo).toBe(20);
    expect(lido!.retorno[1]?.recebidoLimpo).toBe(5);
  });

  it('JSONB enviado e retorno vazios são aceitos (default da coluna é [])', async () => {
    await repo.salvar(novoControle('2026-04-15'));
    const lido = await repo.porData('2026-04-15');
    expect(lido!.enviado).toEqual([]);
    expect(lido!.retorno).toEqual([]);
  });

  it('fechar dia: aberto → fechado preserva enviado/retorno', async () => {
    const item1 = novoItemId();
    const dataDia = '2026-04-15';
    // Manhã: abre o dia com envio
    await repo.salvar(
      novoControle(dataDia, {
        status: 'aberto',
        enviado: [{ itemId: item1, quantidade: 10 }],
        responsavelEnvio: 'Ana',
      }),
    );
    // Tarde: fetch + adiciona retorno + fecha (mesmo id, status muda)
    const aberto = await repo.porData(dataDia);
    await repo.salvar({
      ...aberto!,
      status: 'fechado',
      retorno: [{ itemId: item1, recebidoSujo: 7, recebidoLimpo: 3 }],
      fechadoEm: '2026-04-15T18:00:00.000Z',
      responsavelRetorno: 'Bruno',
      responsavelFechamento: 'Bruno',
    });

    const fechado = await repo.porData(dataDia);
    expect(fechado!.status).toBe('fechado');
    expect(fechado!.responsavelEnvio).toBe('Ana'); // preservado
    expect(fechado!.responsavelRetorno).toBe('Bruno');
    expect(fechado!.responsavelFechamento).toBe('Bruno');
    expect(fechado!.enviado).toHaveLength(1);
    expect(fechado!.retorno).toHaveLength(1);
    expect(new Date(fechado!.fechadoEm!).toISOString()).toBe(
      '2026-04-15T18:00:00.000Z',
    );
  });

  it('fechar com divergência: fechado_com_divergencia + motivo + responsavel', async () => {
    await repo.salvar(
      novoControle('2026-04-15', {
        status: 'fechado_com_divergencia',
        fechadoEm: '2026-04-15T18:00:00.000Z',
        responsavelFechamento: 'Gestor',
        motivoDivergencia: 'Faltam 2 toalhas — provavelmente extravio',
      }),
    );
    const lido = await repo.porData('2026-04-15');
    expect(lido!.status).toBe('fechado_com_divergencia');
    expect(lido!.responsavelFechamento).toBe('Gestor');
    expect(lido!.motivoDivergencia).toBe(
      'Faltam 2 toalhas — provavelmente extravio',
    );
  });

  it('CHECK fechamento: status=fechado SEM fechadoEm é rejeitado', async () => {
    const inconsistente = novoControle('2026-04-15', {
      status: 'fechado',
      fechadoEm: null,
    });
    await expect(repo.salvar(inconsistente)).rejects.toThrow(
      /Falha ao salvar controle diário/i,
    );
    expect(await repo.listar()).toHaveLength(0);
  });

  it('CHECK fechamento: status=aberto COM fechadoEm é rejeitado', async () => {
    const inconsistente = novoControle('2026-04-15', {
      status: 'aberto',
      fechadoEm: '2026-04-15T18:00:00.000Z',
    });
    await expect(repo.salvar(inconsistente)).rejects.toThrow(
      /Falha ao salvar controle diário/i,
    );
  });

  it('CHECK fechamento: fechado_com_divergencia SEM fechadoEm é rejeitado', async () => {
    const inconsistente = novoControle('2026-04-15', {
      status: 'fechado_com_divergencia',
      fechadoEm: null,
    });
    await expect(repo.salvar(inconsistente)).rejects.toThrow(
      /Falha ao salvar controle diário/i,
    );
  });

  it('CHECK jsonb_typeof: enviado como objeto (não-array) é rejeitado pelo banco', async () => {
    // Bypass do repo: TS impede passar não-array via controleToRow,
    // mas o CHECK do banco existe como rede de segurança. Testamos via raw.
    const id = novoId();
    const { error } = await client.from('controles_diarios').insert({
      id,
      data: '2026-04-20',
      status: 'aberto',
      enviado: { naoSouArray: true }, // OBJETO, não array
      retorno: [],
      aberto_em: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/check constraint|controles_enviado_e_array|violates/i);
  });

  it('CHECK jsonb_typeof: retorno como string (não-array) é rejeitado pelo banco', async () => {
    const id = novoId();
    const { error } = await client.from('controles_diarios').insert({
      id,
      data: '2026-04-21',
      status: 'aberto',
      enviado: [],
      retorno: 'nao sou array', // STRING, não array
      aberto_em: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/check constraint|controles_retorno_e_array|violates/i);
  });

  it('CHECK status: valor fora do enum é rejeitado', async () => {
    const inconsistente = novoControle('2026-04-15', {
      // Cast forçado pra simular bug de service que envie status inválido
      status: 'em_andamento' as 'aberto',
    });
    await expect(repo.salvar(inconsistente)).rejects.toThrow(
      /Falha ao salvar controle diário/i,
    );
  });

  it('UNIQUE data: tentativa de INSERT direto (não upsert) com data duplicada é rejeitada', async () => {
    // O repo usa UPSERT então não dispara unique violation. Testa direto
    // via raw client pra confirmar que a constraint UNIQUE existe.
    const c = novoControle('2026-04-15');
    await repo.salvar(c);

    const { error } = await client.from('controles_diarios').insert({
      id: novoId(),
      data: '2026-04-15', // mesma data
      status: 'aberto',
      enviado: [],
      retorno: [],
      aberto_em: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/duplicate|unique|already exists/i);
  });

  it('nullable fields: 4 responsáveis + motivoDivergencia + fechadoEm null preservados', async () => {
    await repo.salvar(novoControle('2026-04-15')); // todos null por default
    const lido = await repo.porData('2026-04-15');
    expect(lido!.responsavelEnvio).toBeNull();
    expect(lido!.responsavelRetorno).toBeNull();
    expect(lido!.responsavelFechamento).toBeNull();
    expect(lido!.motivoDivergencia).toBeNull();
    expect(lido!.fechadoEm).toBeNull();
  });

  it('limpar remove todos os controles', async () => {
    await repo.salvar(novoControle('2026-04-10'));
    await repo.salvar(novoControle('2026-04-11'));
    expect(await repo.listar()).toHaveLength(2);
    await repo.limpar();
    expect(await repo.listar()).toHaveLength(0);
  });
});
