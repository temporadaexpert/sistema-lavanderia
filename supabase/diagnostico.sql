-- =============================================================================
-- diagnostico.sql — execução read-only que diz QUAL é o problema
-- =============================================================================
-- Como usar:
--   1. Supabase Dashboard → Projeto → SQL Editor → New query
--   2. Cole TUDO abaixo
--   3. Run
--   4. Cole o resultado de volta no chat
--
-- O script é 100% read-only — não altera nada.
-- =============================================================================

-- 1) Quais tabelas do schema esperado existem?
select 'TABELAS PRESENTES' as secao;
select tablename
  from pg_tables
 where schemaname = 'public'
   and tablename in (
     'categorias',
     'itens',
     'locais',
     'lotes_lavanderia',
     'movimentacoes',
     'controles_diarios',
     'contatos_lavanderia',
     'correcoes_admin'
   )
 order by tablename;

-- 2) Colunas críticas que vieram em migrations posteriores (0005/0006)
select 'COLUNAS NOVAS' as secao;
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and (
     (table_name = 'movimentacoes' and column_name in ('conciliado', 'operacao_id'))
     or (table_name = 'lotes_lavanderia' and column_name in ('origem_divergencia',
                                                              'motivo_fechamento'))
     or (table_name = 'controles_diarios' and column_name in ('classificacao_divergencia',
                                                               'origem_divergencia'))
   )
 order by table_name, column_name;

-- 3) Contagem de linhas em cada tabela (revela se a tabela existe mas está vazia)
select 'CONTAGENS' as secao;
do $$
declare
  rec record;
  cnt bigint;
begin
  for rec in
    select unnest(array[
      'categorias','itens','locais','lotes_lavanderia',
      'movimentacoes','controles_diarios','contatos_lavanderia',
      'correcoes_admin'
    ]) as t
  loop
    begin
      execute format('select count(*) from %I', rec.t) into cnt;
      raise notice 'tabela=% count=%', rec.t, cnt;
    exception when undefined_table then
      raise notice 'tabela=% AUSENTE', rec.t;
    end;
  end loop;
end$$;

-- 4) RLS habilitada nas tabelas? (service role bypassa, mas anon não)
select 'RLS STATUS' as secao;
select c.relname as tabela,
       c.relrowsecurity as rls_habilitada,
       c.relforcerowsecurity as rls_forcada
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in (
     'categorias','itens','locais','lotes_lavanderia',
     'movimentacoes','controles_diarios','contatos_lavanderia',
     'correcoes_admin'
   )
 order by c.relname;

-- 5) Versão do Postgres + extensions (só pra confirmar projeto certo)
select 'INFO PROJETO' as secao;
select version() as postgres_version;
select current_database() as banco_atual;
