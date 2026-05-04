/**
 * Migração one-shot de data/*.json → Supabase.
 *
 * Uso:
 *   set -a; source .env.local; set +a   # carrega SUPABASE_URL/SERVICE_ROLE
 *   npx tsx scripts/migrate-json-to-supabase.ts          # dry-run (default)
 *   npx tsx scripts/migrate-json-to-supabase.ts --apply  # aplica de fato
 *   npx tsx scripts/migrate-json-to-supabase.ts --apply --force
 *                                                        # ignora trava de
 *                                                        # tabelas não-vazias
 *   npx tsx scripts/migrate-json-to-supabase.ts --reset --apply
 *                                                        # limpa Supabase em
 *                                                        # ordem FK-safe ANTES
 *                                                        # de inserir o JSON
 *
 * Comportamento:
 *  - Default = dry-run: lê os arquivos, conta, valida invariantes, mostra
 *    plano. NÃO escreve nada no Supabase.
 *  - --apply: insere em ordem FK-safe (categorias → locais → itens →
 *    lotes → movs → controles → contatos), em chunks de 500.
 *  - --reset: antes do insert, apaga TUDO do Supabase em ordem inversa
 *    (filhos → pais). Usar em conjunto com --apply pra reciclar resíduos
 *    de teste de integração ou re-migrar do zero. Sem --apply, o --reset
 *    só mostra o que seria apagado (dry-run da limpeza).
 *  - Pre-flight: aborta se qualquer tabela do Supabase já tiver linhas,
 *    a menos que --force ou --reset seja passado. Protege contra duplicação.
 *  - Idempotência preservada: rodar dry-run várias vezes é seguro;
 *    rodar --apply duas vezes na mesma conta é bloqueado pela trava.
 *
 * Não toca em data/*.json (read-only). Não muda schema. Não chama services.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// -----------------------------------------------------------------------------
// CLI flags + env
// -----------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const FORCE = args.has('--force');
const RESET = args.has('--reset');
const MODO = (() => {
  const partes = [];
  if (RESET) partes.push('RESET');
  partes.push(APPLY ? 'APPLY' : 'DRY-RUN');
  if (FORCE) partes.push('(--force)');
  return partes.join(' + ');
})();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    '✗ SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.\n' +
      '  Rode antes: set -a; source .env.local; set +a',
  );
  process.exit(1);
}

const DATA_DIR = resolve(process.cwd(), 'data');

// -----------------------------------------------------------------------------
// Leitura tolerante de arquivos (alguns podem não existir)
// -----------------------------------------------------------------------------

async function lerJson<T>(arquivo: string): Promise<T[]> {
  const path = resolve(DATA_DIR, arquivo);
  try {
    const conteudo = await readFile(path, 'utf-8');
    const parsed = JSON.parse(conteudo);
    if (!Array.isArray(parsed)) {
      throw new Error(`${arquivo} não é um array JSON`);
    }
    return parsed as T[];
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'ENOENT') {
      return []; // arquivo ausente = sem dados pra migrar (não é erro)
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Mapping camelCase (TS) → snake_case (SQL row).
// Replica fielmente os helpers `*ToRow` dos Supabase*Repository.
// -----------------------------------------------------------------------------

function categoriaToRow(c: any) {
  return { id: c.id, nome: c.nome, ativo: c.ativo, criado_em: c.criadoEm };
}

function localToRow(l: any) {
  return {
    id: l.id,
    nome: l.nome,
    tipo: l.tipo,
    ativo: l.ativo,
    criado_em: l.criadoEm,
  };
}

function itemToRow(i: any) {
  return {
    id: i.id,
    nome: i.nome,
    categoria_id: i.categoriaId,
    categoria: i.categoria,
    unidade: i.unidade,
    valor_unitario: i.valorUnitario ?? null,
    estoque_minimo: i.estoqueMinimo ?? null,
    estoque_total: i.estoqueTotal ?? null,
    ativo: i.ativo,
    criado_em: i.criadoEm,
  };
}

function loteToRow(l: any) {
  return {
    id: l.id,
    codigo: l.codigo,
    criado_em: l.criadoEm,
    data_envio: l.dataEnvio,
    origem_id: l.origemId,
    destino_id: l.destinoId,
    responsavel: l.responsavel,
    observacao: l.observacao ?? null,
    encerrado_em: l.encerradoEm ?? null,
    encerrado_por: l.encerradoPor ?? null,
    motivo_fechamento: l.motivoFechamento ?? null,
    motivo_descricao: l.motivoDescricao ?? null,
  };
}

function movimentacaoToRow(m: any) {
  return {
    id: m.id,
    data_hora: m.dataHora,
    item_id: m.itemId,
    quantidade: m.quantidade,
    tipo: m.tipo,
    origem_id: m.origemId ?? null,
    destino_id: m.destinoId ?? null,
    responsavel: m.responsavel,
    observacao: m.observacao ?? null,
    lote_id: m.loteId ?? null,
    preco_unitario_snapshot: m.precoUnitarioSnapshot ?? null,
    registrado_em: m.registradoEm,
    cancelada: m.cancelada ?? false,
    cancelado_em: m.canceladoEm ?? null,
    cancelado_por: m.canceladoPor ?? null,
    motivo_cancelamento: m.motivoCancelamento ?? null,
  };
}

function controleToRow(c: any) {
  return {
    id: c.id,
    data: c.data,
    status: c.status,
    enviado: c.enviado ?? [],
    retorno: c.retorno ?? [],
    aberto_em: c.abertoEm,
    fechado_em: c.fechadoEm ?? null,
    responsavel_envio: c.responsavelEnvio ?? null,
    responsavel_retorno: c.responsavelRetorno ?? null,
    responsavel_fechamento: c.responsavelFechamento ?? null,
    motivo_divergencia: c.motivoDivergencia ?? null,
  };
}

function contatoToRow(c: any) {
  return {
    id: c.id,
    lote_id: c.loteId,
    data_hora: c.dataHora,
    responsavel: c.responsavel,
    tipo: c.tipo,
    observacao: c.observacao ?? null,
    proxima_acao: c.proximaAcao ?? null,
    promessa_retorno_data: c.promessaRetornoData ?? null,
    registrado_em: c.registradoEm,
  };
}

// -----------------------------------------------------------------------------
// Validações pre-flight (não-fatais; viram warnings)
// -----------------------------------------------------------------------------

interface Aviso {
  readonly tabela: string;
  readonly mensagem: string;
}

function validar(
  categorias: any[],
  itens: any[],
  locais: any[],
  lotes: any[],
  movs: any[],
  contatos: any[],
): Aviso[] {
  const avisos: Aviso[] = [];
  const idsCat = new Set(categorias.map((c) => c.id));
  const idsLocal = new Set(locais.map((l) => l.id));
  const idsItem = new Set(itens.map((i) => i.id));
  const idsLote = new Set(lotes.map((l) => l.id));

  // Itens devem referenciar categoria existente
  for (const i of itens) {
    if (!i.categoriaId) {
      avisos.push({ tabela: 'itens', mensagem: `item ${i.id} sem categoriaId` });
    } else if (!idsCat.has(i.categoriaId)) {
      avisos.push({
        tabela: 'itens',
        mensagem: `item ${i.id}: categoriaId ${i.categoriaId} não existe em categorias.json`,
      });
    }
  }
  // Lotes referenciam locais
  for (const l of lotes) {
    if (!idsLocal.has(l.origemId)) {
      avisos.push({ tabela: 'lotes', mensagem: `lote ${l.id}: origemId ${l.origemId} não existe` });
    }
    if (!idsLocal.has(l.destinoId)) {
      avisos.push({ tabela: 'lotes', mensagem: `lote ${l.id}: destinoId ${l.destinoId} não existe` });
    }
  }
  // Movs referenciam itens, locais, lotes
  for (const m of movs) {
    if (!idsItem.has(m.itemId)) {
      avisos.push({ tabela: 'movimentacoes', mensagem: `mov ${m.id}: itemId ${m.itemId} não existe` });
    }
    if (m.origemId && !idsLocal.has(m.origemId)) {
      avisos.push({ tabela: 'movimentacoes', mensagem: `mov ${m.id}: origemId ${m.origemId} não existe` });
    }
    if (m.destinoId && !idsLocal.has(m.destinoId)) {
      avisos.push({ tabela: 'movimentacoes', mensagem: `mov ${m.id}: destinoId ${m.destinoId} não existe` });
    }
    if (m.loteId && !idsLote.has(m.loteId)) {
      avisos.push({ tabela: 'movimentacoes', mensagem: `mov ${m.id}: loteId ${m.loteId} não existe` });
    }
  }
  // Contatos referenciam lotes
  for (const c of contatos) {
    if (!idsLote.has(c.loteId)) {
      avisos.push({ tabela: 'contatos', mensagem: `contato ${c.id}: loteId ${c.loteId} não existe` });
    }
  }
  return avisos;
}

// -----------------------------------------------------------------------------
// Supabase: contagem e insert
// -----------------------------------------------------------------------------

const TABELAS_FK_ORDEM = [
  'categorias',
  'locais',
  'itens',
  'lotes_lavanderia',
  'movimentacoes',
  'controles_diarios',
  'contatos_lavanderia',
] as const;

// Ordem de DELETE para --reset: filhos → pais.
// FKs RESTRICT exigem que dependentes saiam antes dos referenciados.
const TABELAS_RESET_ORDEM = [
  'contatos_lavanderia', // filho de lotes
  'movimentacoes', // filho de itens, locais, lotes
  'lotes_lavanderia', // filho de locais
  'controles_diarios', // independente (sem FK in/out)
  'itens', // filho de categorias
  'locais', // raiz
  'categorias', // raiz
] as const;

async function contarTodas(client: SupabaseClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const tabela of TABELAS_FK_ORDEM) {
    const { count, error } = await client.from(tabela).select('*', { count: 'exact', head: true });
    if (error) throw new Error(`Falha ao contar ${tabela}: ${error.message}`);
    out[tabela] = count ?? 0;
  }
  return out;
}

async function resetarTabela(client: SupabaseClient, tabela: string): Promise<void> {
  // Mesmo idiom dos repositórios Supabase: filtro tautológico pra contornar
  // a proteção do JS SDK contra delete sem WHERE.
  const { error } = await client
    .from(tabela)
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw new Error(`Falha ao resetar ${tabela}: ${error.message}`);
}

async function inserir(
  client: SupabaseClient,
  tabela: string,
  rows: any[],
): Promise<void> {
  if (rows.length === 0) return;
  const tamChunk = 500;
  for (let i = 0; i < rows.length; i += tamChunk) {
    const chunk = rows.slice(i, i + tamChunk);
    const { error } = await client.from(tabela).insert(chunk);
    if (error) {
      throw new Error(
        `Insert ${tabela} (chunk ${i}–${i + chunk.length}): ${error.message}`,
      );
    }
  }
}

// -----------------------------------------------------------------------------
// Output helpers
// -----------------------------------------------------------------------------

function linhaSep(): void {
  console.log('─'.repeat(60));
}

function painelContagens(titulo: string, contagens: Record<string, number>): void {
  console.log(titulo);
  for (const tabela of TABELAS_FK_ORDEM) {
    const n = contagens[tabela] ?? 0;
    console.log(`  ${tabela.padEnd(22)} ${String(n).padStart(6)}`);
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Modo: ${MODO}`);
  console.log(`data/: ${DATA_DIR}`);
  console.log(`supabase: ${SUPABASE_URL!.replace(/^https:\/\//, '').slice(0, 30)}…`);
  linhaSep();

  // 1. Ler todos os arquivos JSON
  const [categorias, locais, itens, lotes, movs, controles, contatos] = await Promise.all([
    lerJson<any>('categorias.json'),
    lerJson<any>('locais.json'),
    lerJson<any>('itens.json'),
    lerJson<any>('lotes.json'),
    lerJson<any>('movimentacoes.json'),
    lerJson<any>('controles-diarios.json'),
    lerJson<any>('contatos-lavanderia.json'),
  ]);

  const contagensJson: Record<string, number> = {
    categorias: categorias.length,
    locais: locais.length,
    itens: itens.length,
    lotes_lavanderia: lotes.length,
    movimentacoes: movs.length,
    controles_diarios: controles.length,
    contatos_lavanderia: contatos.length,
  };
  painelContagens('Encontrado em data/*.json:', contagensJson);
  linhaSep();

  // 2. Validar invariantes
  const avisos = validar(categorias, itens, locais, lotes, movs, contatos);
  if (avisos.length > 0) {
    console.log(`⚠ ${avisos.length} aviso(s) de integridade:`);
    for (const a of avisos.slice(0, 20)) {
      console.log(`  [${a.tabela}] ${a.mensagem}`);
    }
    if (avisos.length > 20) console.log(`  … (+${avisos.length - 20} mais)`);
    console.log('  Esses registros vão falhar FK no banco. Corrija em data/*.json antes de --apply.');
    linhaSep();
  } else {
    console.log('✓ Sem violações de integridade detectadas no JSON.');
    linhaSep();
  }

  // 3. Pre-flight: estado atual no Supabase
  const client = createClient(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const contagensSupabase = await contarTodas(client);
  painelContagens('Estado atual no Supabase:', contagensSupabase);
  linhaSep();

  // 4. Reset (se solicitado): limpa tabelas em ordem FK-safe (filhos → pais)
  // antes de qualquer insert. Útil pra reciclar resíduos de teste de
  // integração ou pra re-migrar do zero. Sem --apply, mostra plano e sai.
  if (RESET) {
    console.log('Plano de RESET (filhos → pais):');
    for (const tabela of TABELAS_RESET_ORDEM) {
      const n = contagensSupabase[tabela] ?? 0;
      const acao = n > 0 ? `apagar ${n}` : '(vazio, skip)';
      console.log(`  ${tabela.padEnd(22)} ${acao}`);
    }
    if (APPLY) {
      console.log('\nApagando…');
      for (const tabela of TABELAS_RESET_ORDEM) {
        const t0 = Date.now();
        await resetarTabela(client, tabela);
        const ms = Date.now() - t0;
        console.log(`  ${tabela.padEnd(22)} OK (${ms}ms)`);
      }
      const aposReset = await contarTodas(client);
      painelContagens('\nPós-reset no Supabase:', aposReset);
      const aindaCheia = TABELAS_FK_ORDEM.filter((t) => (aposReset[t] ?? 0) > 0);
      if (aindaCheia.length > 0) {
        console.error('✗ Reset incompleto, ainda há dados em:', aindaCheia.join(', '));
        process.exit(2);
      }
      // Atualiza a baseline pra divergência final (esperado = base + json).
      // Após reset bem-sucedido, base = 0 em todas as tabelas.
      for (const tabela of TABELAS_FK_ORDEM) {
        contagensSupabase[tabela] = 0;
      }
    } else {
      console.log('  (dry-run: nada apagado)');
    }
    linhaSep();
  }

  // 5. Pre-flight anti-duplicação: aborta se Supabase já tem dados.
  // Pulado quando --reset foi usado (já limpamos) ou --force (override
  // explícito do operador).
  const naoVazias = TABELAS_FK_ORDEM.filter((t) => (contagensSupabase[t] ?? 0) > 0);
  if (!RESET && naoVazias.length > 0 && !FORCE) {
    console.error('✗ Supabase já tem dados em:', naoVazias.join(', '));
    console.error('  Migração abortada para evitar duplicação.');
    console.error('  Opções:');
    console.error('    --reset --apply   limpa o Supabase e re-migra do zero');
    console.error('    --apply --force   ignora a trava (pode duplicar IDs)');
    process.exit(1);
  }

  // 4. Dry-run para aqui
  if (!APPLY) {
    console.log('Plano de inserção (dry-run):');
    for (const tabela of TABELAS_FK_ORDEM) {
      const n = contagensJson[tabela] ?? 0;
      const acao = n > 0 ? `inserir ${n}` : '(vazio, skip)';
      console.log(`  ${tabela.padEnd(22)} ${acao}`);
    }
    linhaSep();
    console.log('Nada foi gravado. Para aplicar:');
    console.log('  npx tsx scripts/migrate-json-to-supabase.ts --apply');
    return;
  }

  // 5. APPLY: inserir em ordem FK-safe
  if (avisos.length > 0 && !FORCE) {
    console.error('✗ Apply abortado: avisos de integridade pendentes. Use --force pra ignorar.');
    process.exit(1);
  }

  console.log('Inserindo no Supabase…');
  const passos: Array<[string, any[], (x: any) => any]> = [
    ['categorias', categorias, categoriaToRow],
    ['locais', locais, localToRow],
    ['itens', itens, itemToRow],
    ['lotes_lavanderia', lotes, loteToRow],
    ['movimentacoes', movs, movimentacaoToRow],
    ['controles_diarios', controles, controleToRow],
    ['contatos_lavanderia', contatos, contatoToRow],
  ];

  for (const [tabela, registros, mapper] of passos) {
    if (registros.length === 0) {
      console.log(`  ${tabela.padEnd(22)} (vazio, skip)`);
      continue;
    }
    const t0 = Date.now();
    await inserir(client, tabela, registros.map(mapper));
    const ms = Date.now() - t0;
    console.log(`  ${tabela.padEnd(22)} ${registros.length} OK (${ms}ms)`);
  }

  // 6. Validar contagens pós-insert
  linhaSep();
  const final = await contarTodas(client);
  painelContagens('Pós-insert no Supabase:', final);
  linhaSep();

  // 7. Sanity: as contagens batem com o esperado
  const divergencias = TABELAS_FK_ORDEM.filter(
    (t) => final[t] !== (contagensSupabase[t] ?? 0) + (contagensJson[t] ?? 0),
  );
  if (divergencias.length > 0) {
    console.error('⚠ Contagens pós-insert divergem do esperado:', divergencias.join(', '));
    process.exit(2);
  }
  console.log('✓ Migração concluída. Contagens batem com o esperado.');
}

main().catch((err: unknown) => {
  console.error('✗ Erro:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
