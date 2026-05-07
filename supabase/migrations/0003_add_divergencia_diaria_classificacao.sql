-- =============================================================================
-- 0003_add_divergencia_diaria_classificacao.sql
-- =============================================================================
-- Adiciona dois campos enum em `controles_diarios` para auditoria estruturada
-- do fechamento com divergência:
--
--   classificacao_divergencia text  CHECK (perda | dano | extravio |
--                                          erro_operacional | outro | NULL)
--   origem_divergencia text         CHECK (lavanderia | imovel | operacao |
--                                          desconhecida | NULL)
--
-- Por que separados de `motivo_divergencia`:
--   - `motivo_divergencia` continua sendo texto livre (descrição do gestor)
--   - `classificacao_divergencia` é categoria fechada para relatórios
--   - `origem_divergencia` aponta o canal provável (mesma semântica usada
--     em `lotes_lavanderia.origem_divergencia` da migration 0002)
--
-- IDEMPOTÊNCIA: pode rodar N vezes contra qualquer estado:
--   1. Banco virgem (criado pela 0001/0002, sem esses campos) → cria
--   2. Banco com algum campo já criado manualmente → no-op nesse passo
--   3. Banco com esta migration já aplicada → recria CHECK canônico
--
-- Tudo dentro de uma transação: lock ACCESS EXCLUSIVE preserva atomicidade.
-- =============================================================================

begin;

-- 1. Coluna classificacao_divergencia.
alter table controles_diarios
  add column if not exists classificacao_divergencia text;

-- 2. Coluna origem_divergencia.
alter table controles_diarios
  add column if not exists origem_divergencia text;

-- 3. Remove qualquer CHECK pré-existente sobre essas colunas (caso elas
--    tenham sido criadas inline com CHECK auto-nomeado em alguma rodada
--    manual). Cobre nomes auto-gerados pelo Postgres.
do $$
declare
  cstr record;
begin
  for cstr in
    select conname
      from pg_constraint
     where conrelid = 'controles_diarios'::regclass
       and contype = 'c'
       and (
         pg_get_constraintdef(oid) ilike '%classificacao_divergencia%'
         or pg_get_constraintdef(oid) ilike '%origem_divergencia%'
       )
  loop
    execute format('alter table controles_diarios drop constraint %I', cstr.conname);
  end loop;
end$$;

-- 4. CHECK canônico para classificacao_divergencia.
--
--    NOTA: vocabulário INTENCIONALMENTE diferente de `lotes_lavanderia.
--    motivo_fechamento` (que tem 'perda_confirmada', 'danificado', 'outros').
--    Daily expressa CLASSIFICAÇÃO crua do operador no dia; lote expressa
--    MOTIVO_FECHAMENTO administrativo (vocabulário mais formal). Mapping
--    1:1 da UI fica em `ClassificacaoRetorno` no TS.
alter table controles_diarios
  add constraint controles_diarios_classificacao_divergencia_check
  check (
    classificacao_divergencia is null
    or classificacao_divergencia in (
      'perda', 'dano', 'extravio', 'erro_operacional', 'outro'
    )
  );

-- 5. CHECK canônico para origem_divergencia (mesmo enum de lotes_lavanderia).
alter table controles_diarios
  add constraint controles_diarios_origem_divergencia_check
  check (
    origem_divergencia is null
    or origem_divergencia in (
      'lavanderia', 'imovel', 'operacao', 'desconhecida'
    )
  );

commit;
