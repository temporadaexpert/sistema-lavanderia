-- =============================================================================
-- TE Lavanderia Control — Schema inicial (Supabase / Postgres)
-- =============================================================================
-- 7 tabelas correspondendo 1:1 às entidades de domínio em src/domain/entities/*.ts
--
-- Convenções:
--   - snake_case em todas as colunas (repos Supabase fazem snake↔camel mapping).
--   - id é TEXT (string UUID) — bate com o tipo branded `*Id` no TS, sem
--     fricção de cast em testes e seeds (UuidGenerator gera UUIDs no app;
--     `gen_random_uuid()::text` cobre inserts SQL puros).
--   - timestamptz pra data+hora; date pra granularidade de dia.
--   - jsonb pra arrays de linha em controle diário (curtos, lidos junto).
--   - Enums codados como TEXT + CHECK — adicionar valor é DROP/ADD CONSTRAINT,
--     sem ALTER TYPE.
--   - Toda FK ON DELETE RESTRICT para preservar histórico operacional.
--     IMPORTANTE: ResetOperacionalService deve apagar filhos antes de pais
--     (movimentacoes/contatos_lavanderia ANTES de lotes_lavanderia). Com
--     RESTRICT, ordem inversa quebra. Não há CASCADE neste schema.
--   - RLS NÃO habilitada nesta migration — toda autorização vive na camada
--     de aplicação (middleware + service role). Habilitar quando tipos de
--     usuário (operador/admin) virarem first-class no domínio.
-- =============================================================================

create extension if not exists pgcrypto;


-- -----------------------------------------------------------------------------
-- categorias
-- -----------------------------------------------------------------------------
create table categorias (
  id          text        primary key default gen_random_uuid()::text,
  nome        text        not null,
  ativo       boolean     not null default true,
  criado_em   timestamptz not null default now()
);

-- Unicidade case-insensitive — CategoryService.obterOuCriarPorNome assume.
create unique index categorias_nome_lower_idx on categorias (lower(nome));


-- -----------------------------------------------------------------------------
-- itens
-- -----------------------------------------------------------------------------
-- `categoria` (text) é cache denormalizado do nome da categoria — ItemService
-- mantém em sincronia com categorias.nome. Evita join em hot path.
create table itens (
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

create index itens_categoria_id_idx on itens (categoria_id);


-- -----------------------------------------------------------------------------
-- locais
-- -----------------------------------------------------------------------------
create table locais (
  id          text        primary key default gen_random_uuid()::text,
  nome        text        not null,
  tipo        text        not null check (tipo in ('deposito','imovel','lavanderia')),
  ativo       boolean     not null default true,
  criado_em   timestamptz not null default now()
);


-- -----------------------------------------------------------------------------
-- lotes_lavanderia
-- -----------------------------------------------------------------------------
-- Cabeçalho da remessa. Quantidades NÃO ficam aqui — derivam de movimentacoes
-- vinculadas via lote_id (ver Lote.ts).
create table lotes_lavanderia (
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
  motivo_fechamento   text        check (
                        motivo_fechamento is null
                        or motivo_fechamento in
                          ('perda_confirmada','danificado','extravio',
                           'erro_operacional','outros')
                      ),
  motivo_descricao    text,

  -- Encerramento all-or-nothing: LoteLavanderiaService.encerrarComPendencia
  -- não permite gravar lote encerrado sem motivo + responsável.
  constraint lotes_encerramento_consistente check (
    (encerrado_em is null and encerrado_por is null and motivo_fechamento is null)
    or
    (encerrado_em is not null and encerrado_por is not null and motivo_fechamento is not null)
  )
);

create index lotes_lavanderia_data_envio_idx on lotes_lavanderia (data_envio desc);


-- -----------------------------------------------------------------------------
-- movimentacoes
-- -----------------------------------------------------------------------------
-- Append-only event log. NUNCA editar campos operacionais. Correções via
-- novo lançamento tipo 'ajuste'. Cancelamento marca a linha como ignorada
-- pra projeções (saldo, relatórios) sem alterar campos originais.
create table movimentacoes (
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

  -- Cancelamento all-or-nothing: marcarCancelada aplica os 3 campos juntos.
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

create index movimentacoes_item_id_idx on movimentacoes (item_id);
create index movimentacoes_lote_id_idx on movimentacoes (lote_id);
create index movimentacoes_data_hora_idx on movimentacoes (data_hora desc);
create index movimentacoes_tipo_idx on movimentacoes (tipo);


-- -----------------------------------------------------------------------------
-- controles_diarios
-- -----------------------------------------------------------------------------
-- Um registro por dia (UNIQUE em data). enviado/retorno como jsonb porque
-- são arrays curtos (1 entrada por item de enxoval), 100% lidos junto.
--
-- Shape esperada (validada na camada de aplicação):
--   enviado: [{ "itemId": text, "quantidade": integer }]
--   retorno: [{ "itemId": text, "recebidoSujo": integer, "recebidoLimpo": integer }]
create table controles_diarios (
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

  -- status fechado/fechado_com_divergencia exige fechado_em preenchido;
  -- aberto exige fechado_em null. Espelha ControleDiarioService.fechar.
  constraint controles_fechamento_consistente check (
    (status = 'aberto' and fechado_em is null)
    or
    (status in ('fechado','fechado_com_divergencia') and fechado_em is not null)
  )
);


-- -----------------------------------------------------------------------------
-- contatos_lavanderia
-- -----------------------------------------------------------------------------
-- Append-only de tentativas de cobrança sobre lotes em aberto. RESTRICT
-- preserva histórico — apagar um lote com contatos é proibido. Reset
-- operacional precisa apagar contatos ANTES de lotes.
create table contatos_lavanderia (
  id                       text        primary key default gen_random_uuid()::text,
  lote_id                  text        not null references lotes_lavanderia(id) on delete restrict,
  data_hora                timestamptz not null,
  responsavel              text        not null,
  tipo                     text        not null check (tipo in
                                          ('whatsapp','telefone','email','presencial','outro')),
  observacao               text,
  proxima_acao             text,
  -- Aceita ISO date (YYYY-MM-DD) ou ISO datetime — domain trata os dois.
  promessa_retorno_data    text,
  registrado_em            timestamptz not null default now()
);

create index contatos_lavanderia_lote_id_idx on contatos_lavanderia (lote_id);
