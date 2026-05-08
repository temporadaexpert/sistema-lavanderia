-- =============================================================================
-- 0004_add_duplicado_motivo_fechamento.sql
-- =============================================================================
-- Adiciona o valor 'duplicado' ao CHECK de `lotes_lavanderia.motivo_fechamento`.
--
-- Razão: até agora as 5 opções (perda_confirmada/danificado/extravio/
-- erro_operacional/outros) eram TODAS interpretadas como perda real pelos
-- relatórios. Quando um operador encerrava um lote duplicado pra "tirá-lo
-- do caminho", o sistema gerava ajustes (baixa de saldo) E somava esse
-- lote em "Perdas no mês" — gerando perda fictícia.
--
-- A nova classificação 'duplicado' marca lotes que NÃO devem contar como
-- perda. O caminho `cancelarLoteDuplicado` no LoteLavanderiaService:
--   1. Cancela todas as movimentações vinculadas ao lote (envios E ajustes
--      eventuais que tenham sido criados por encerrarComPendencia anterior)
--   2. Atualiza o header com motivo='duplicado'
--   3. RelatorioPerdaService filtra `motivo_fechamento != 'duplicado'`
--
-- Idempotente: pode rodar várias vezes contra qualquer estado.
-- =============================================================================

begin;

-- Remove qualquer CHECK existente sobre motivo_fechamento (cobre nome
-- auto-gerado pelo Postgres no schema 0001 inline e qualquer rerodada).
do $$
declare
  cstr record;
begin
  for cstr in
    select conname
      from pg_constraint
     where conrelid = 'lotes_lavanderia'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%motivo_fechamento%'
  loop
    execute format('alter table lotes_lavanderia drop constraint %I', cstr.conname);
  end loop;
end$$;

-- CHECK canônico com 'duplicado' incluído.
alter table lotes_lavanderia
  add constraint lotes_lavanderia_motivo_fechamento_check
  check (
    motivo_fechamento is null
    or motivo_fechamento in (
      'perda_confirmada',
      'danificado',
      'extravio',
      'erro_operacional',
      'outros',
      'duplicado'
    )
  );

commit;
