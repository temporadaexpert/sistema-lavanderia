-- =============================================================================
-- aplicar_todas_migrations.sql
-- =============================================================================
-- CONSOLIDA as 6 migrations (0001 → 0006) em UM script idempotente.
-- Cada bloco é o conteúdo literal do arquivo correspondente — re-rodar
-- contra qualquer estado (banco virgem, banco parcial, banco completo)
-- não altera resultado.
--
-- COMO USAR (produção):
--   1. https://supabase.com/dashboard/project/<seu-project-ref>/sql/new
--   2. Cole TUDO abaixo
--   3. Run
--   4. Aguarde "Success. No rows returned." em cada bloco
--   5. Volte ao app e teste /operacao — banner deve sumir
--
-- Tempo estimado: ~3 segundos em banco virgem; instantâneo em banco que
-- já tem tudo.
-- =============================================================================


-- ##########################################################################
-- ## 0001_initial_schema.sql ###############################################
-- ##########################################################################
-- ATENÇÃO: este bloco usa `create table` SEM `if not exists` no schema
-- original. Adicionamos `if not exists` aqui pra tornar a aplicação
-- segura mesmo se algumas tabelas já existirem. Tipos e constraints
-- são idênticos ao 0001 original.

create extension if not exists pgcrypto;

create table if not exists categorias (
  id          text        primary key default gen_random_uuid()::text,
  nome        text        not null,
  ativo       boolean     not null default true,
  criado_em   timestamptz not null default now()
);

create unique index if not exists categorias_nome_lower_idx
  on categorias (lower(nome));

create table if not exists itens (
  id              text        primary key default gen_random_uuid()::text,
  nome            text        not null,
  categoria_id    text        not null references categorias(id) on delete restrict,
  categoria       text        not null,
  unidade         text        not null,
  valor_unitario  numeric(12,2),
  estoque_minimo  integer     check (estoque_minimo is null or estoque_minimo >= 0),
  estoque_total   integer     check (estoque_total is null or estoque_total >= 0),
  ativo           boolean     not null default true,
  criado_em       timestamptz not null default now()
);

create index if not exists itens_categoria_id_idx on itens (categoria_id);

create table if not exists locais (
  id          text        primary key default gen_random_uuid()::text,
  nome        text        not null,
  tipo        text        not null check (tipo in ('deposito','imovel','lavanderia')),
  ativo       boolean     not null default true,
  criado_em   timestamptz not null default now()
);

create table if not exists lotes_lavanderia (
  id                  text        primary key default gen_random_uuid()::text,
  codigo              text        not null unique,
  criado_em           timestamptz not null default now(),
  data_envio          timestamptz not null,
  origem_id           text        not null references locais(id) on delete restrict,
  destino_id          text        not null references locais(id) on delete restrict,
  responsavel         text        not null,
  observacao          text,
  encerrado_em        timestamptz,
  encerrado_por       text,
  motivo_fechamento   text,
  motivo_descricao    text,

  constraint lotes_encerramento_consistente check (
    (encerrado_em is null and encerrado_por is null and motivo_fechamento is null)
    or
    (encerrado_em is not null and encerrado_por is not null and motivo_fechamento is not null)
  )
);

create index if not exists lotes_lavanderia_data_envio_idx
  on lotes_lavanderia (data_envio desc);

create table if not exists movimentacoes (
  id                          text        primary key default gen_random_uuid()::text,
  data_hora                   timestamptz not null,
  item_id                     text        not null references itens(id) on delete restrict,
  quantidade                  integer     not null check (quantidade > 0),
  tipo                        text        not null check (tipo in
                                            ('entrada_deposito','saida_imovel','retorno_imovel',
                                             'envio_lavanderia','retorno_lavanderia','ajuste')),
  origem_id                   text        references locais(id) on delete restrict,
  destino_id                  text        references locais(id) on delete restrict,
  responsavel                 text        not null,
  observacao                  text,
  lote_id                     text        references lotes_lavanderia(id) on delete restrict,
  preco_unitario_snapshot     numeric(12,2),
  registrado_em               timestamptz not null default now(),
  cancelada                   boolean     not null default false,
  cancelado_em                timestamptz,
  cancelado_por               text,
  motivo_cancelamento         text,

  constraint movs_cancelamento_consistente check (
    (cancelada = false
       and cancelado_em is null
       and cancelado_por is null
       and motivo_cancelamento is null)
    or
    (cancelada = true
       and cancelado_em is not null
       and cancelado_por is not null
       and motivo_cancelamento is not null)
  )
);

create index if not exists movimentacoes_item_id_idx on movimentacoes (item_id);
create index if not exists movimentacoes_lote_id_idx on movimentacoes (lote_id);
create index if not exists movimentacoes_data_hora_idx on movimentacoes (data_hora desc);
create index if not exists movimentacoes_tipo_idx on movimentacoes (tipo);

create table if not exists controles_diarios (
  id                       text        primary key default gen_random_uuid()::text,
  data                     date        not null unique,
  status                   text        not null check (status in
                                          ('aberto','fechado','fechado_com_divergencia')),
  enviado                  jsonb       not null default '[]'::jsonb,
  retorno                  jsonb       not null default '[]'::jsonb,
  aberto_em                timestamptz not null default now(),
  fechado_em               timestamptz,
  responsavel_envio        text,
  responsavel_retorno      text,
  responsavel_fechamento   text,
  motivo_divergencia       text,

  constraint controles_enviado_e_array check (jsonb_typeof(enviado) = 'array'),
  constraint controles_retorno_e_array check (jsonb_typeof(retorno) = 'array'),

  constraint controles_fechamento_consistente check (
    (status = 'aberto' and fechado_em is null)
    or
    (status in ('fechado','fechado_com_divergencia') and fechado_em is not null)
  )
);

create table if not exists contatos_lavanderia (
  id                       text        primary key default gen_random_uuid()::text,
  lote_id                  text        not null references lotes_lavanderia(id) on delete restrict,
  data_hora                timestamptz not null,
  responsavel              text        not null,
  tipo                     text        not null check (tipo in
                                          ('whatsapp','telefone','email','presencial','outro')),
  observacao               text,
  proxima_acao             text,
  promessa_retorno_data    text,
  registrado_em            timestamptz not null default now()
);

create index if not exists contatos_lavanderia_lote_id_idx
  on contatos_lavanderia (lote_id);


-- ##########################################################################
-- ## 0002_add_origem_divergencia.sql #######################################
-- ##########################################################################

alter table lotes_lavanderia
  add column if not exists origem_divergencia text;

do $$
declare cstr record;
begin
  for cstr in
    select conname
      from pg_constraint
     where conrelid = 'lotes_lavanderia'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%origem_divergencia%'
  loop
    execute format('alter table lotes_lavanderia drop constraint %I', cstr.conname);
  end loop;
end$$;

alter table lotes_lavanderia
  add constraint lotes_lavanderia_origem_divergencia_check
  check (
    origem_divergencia is null
    or origem_divergencia in ('lavanderia', 'imovel', 'operacao', 'desconhecida')
  );


-- ##########################################################################
-- ## 0003_add_divergencia_diaria_classificacao.sql #########################
-- ##########################################################################

alter table controles_diarios
  add column if not exists classificacao_divergencia text;

alter table controles_diarios
  add column if not exists origem_divergencia text;

do $$
declare cstr record;
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

alter table controles_diarios
  add constraint controles_diarios_classificacao_divergencia_check
  check (
    classificacao_divergencia is null
    or classificacao_divergencia in (
      'perda', 'dano', 'extravio', 'erro_operacional', 'outro'
    )
  );

alter table controles_diarios
  add constraint controles_diarios_origem_divergencia_check
  check (
    origem_divergencia is null
    or origem_divergencia in (
      'lavanderia', 'imovel', 'operacao', 'desconhecida'
    )
  );


-- ##########################################################################
-- ## 0004_add_duplicado_motivo_fechamento.sql ##############################
-- ##########################################################################

do $$
declare cstr record;
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


-- ##########################################################################
-- ## 0005_add_conciliado_movimentacoes.sql #################################
-- ##########################################################################

alter table movimentacoes
  add column if not exists conciliado boolean not null default true;

create index if not exists movimentacoes_nao_conciliadas_idx
  on movimentacoes (item_id, registrado_em desc)
  where conciliado = false;


-- ##########################################################################
-- ## 0006_correcoes_admin.sql ##############################################
-- ##########################################################################

alter table movimentacoes
  add column if not exists operacao_id text;

create index if not exists movimentacoes_operacao_id_idx
  on movimentacoes (operacao_id)
  where operacao_id is not null;

create table if not exists correcoes_admin (
  id                       text        primary key default gen_random_uuid()::text,
  tipo_bloco               text        not null
                                       check (tipo_bloco in (
                                         'envio_lavanderia',
                                         'retorno_lavanderia',
                                         'saida_imovel',
                                         'retorno_imovel'
                                       )),
  operacao_id              text        null,
  item_id                  text        not null
                                       references itens(id) on delete restrict,
  nome_item_snapshot       text        not null,
  lote_id                  text        null
                                       references lotes_lavanderia(id) on delete restrict,
  local_id                 text        null
                                       references locais(id) on delete restrict,
  quantidade_anterior      integer     not null check (quantidade_anterior >= 0),
  quantidade_nova          integer     not null check (quantidade_nova >= 0),
  diferenca                integer     not null
                                       check (diferenca = quantidade_nova - quantidade_anterior),
  motivo                   text        not null check (length(trim(motivo)) >= 5),
  admin_responsavel        text        not null check (length(trim(admin_responsavel)) > 0),
  corrigido_em             timestamptz not null default now(),
  movs_canceladas_ids      jsonb       not null default '[]'::jsonb,
  movs_novas_ids           jsonb       not null default '[]'::jsonb,
  observacao_automatica    text        null
);

create index if not exists correcoes_admin_corrigido_em_idx
  on correcoes_admin (corrigido_em desc);

create index if not exists correcoes_admin_tipo_bloco_idx
  on correcoes_admin (tipo_bloco, corrigido_em desc);

create index if not exists correcoes_admin_item_id_idx
  on correcoes_admin (item_id, corrigido_em desc);

create index if not exists correcoes_admin_admin_responsavel_idx
  on correcoes_admin (admin_responsavel, corrigido_em desc);

create index if not exists correcoes_admin_operacao_id_idx
  on correcoes_admin (operacao_id)
  where operacao_id is not null;


-- ##########################################################################
-- Fim. Banner em /operacao deve sumir após o próximo carregamento.
-- ##########################################################################
