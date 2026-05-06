-- =============================================================================
-- 0002_add_origem_divergencia.sql
-- =============================================================================
-- Adiciona `lotes_lavanderia.origem_divergencia` (text, nullable) com CHECK
-- restringindo a 4 valores: 'lavanderia', 'imovel', 'operacao', 'desconhecida'.
--
-- Coletado pelo operador no modal de classificação de divergência ao concluir
-- retorno de lote — permite relatórios agrupados (perda por origem) sem
-- texto livre. Mapeia 1:1 com `OrigemDivergencia` em src/domain/types/enums.ts.
--
-- IDEMPOTÊNCIA: pode ser executada N vezes contra qualquer estado:
--   1. banco virgem (criado pela 0001, sem o campo) → cria coluna + CHECK
--   2. banco com a coluna criada manualmente em produção (caso atual,
--      antes do versionamento desta migration) → re-aplica CHECK canônico
--   3. banco já com esta migration aplicada → no-op efetivo
--
-- Tudo dentro de uma transação: lock ACCESS EXCLUSIVE é mantido até COMMIT,
-- impedindo INSERT/UPDATE concorrente que pudesse violar o estado intermediário
-- entre DROP e ADD do CHECK.
-- =============================================================================

begin;

-- 1. Coluna. IF NOT EXISTS torna o passo seguro tanto no caso (1) quanto no (2).
alter table lotes_lavanderia
  add column if not exists origem_divergencia text;

-- 2. Remove qualquer CHECK pré-existente que envolva esta coluna,
--    independentemente do NOME (Postgres auto-gera nomes quando o CHECK é
--    definido inline com ADD COLUMN; produção pode ter nome diferente do
--    nosso). Sem isso, ficaríamos com 2 checks redundantes — sintaticamente
--    válido, mas confuso.
do $$
declare
  cstr record;
begin
  for cstr in
    select conname
      from pg_constraint
     where conrelid = 'lotes_lavanderia'::regclass
       and contype = 'c' -- só CHECK constraints
       and pg_get_constraintdef(oid) ilike '%origem_divergencia%'
  loop
    execute format('alter table lotes_lavanderia drop constraint %I', cstr.conname);
  end loop;
end$$;

-- 3. CHECK canônico com nome estável (futuras migrations podem referenciá-lo
--    diretamente sem precisar do scan via pg_constraint).
alter table lotes_lavanderia
  add constraint lotes_lavanderia_origem_divergencia_check
  check (
    origem_divergencia is null
    or origem_divergencia in ('lavanderia', 'imovel', 'operacao', 'desconhecida')
  );

commit;
