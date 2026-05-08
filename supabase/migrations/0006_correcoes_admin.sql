-- =============================================================================
-- 0006_correcoes_admin.sql
-- =============================================================================
-- Adiciona infra de CORREÇÃO ADMINISTRATIVA de lançamentos, em duas peças:
--
-- 1. `movimentacoes.operacao_id text NULL` (+ índice)
--    Correlaciona movs criadas pela MESMA operação de UI:
--      - 1 envio de lote → 1 operacao_id, todas as N movs envio_lavanderia
--      - 1 recebimento de lote → 1 operacao_id, TODAS as N movs retorno_lavanderia
--        (incluindo as redirecionadas pra lote anterior e o excedente avulso)
--      - 1 saída/retorno de imóvel → 1 operacao_id (1 mov)
--    Movs anteriores à migration ficam com operacao_id NULL — UI lida graciosa.
--    NÃO é FK pra outra tabela: é só correlacional. Não há "operacoes" como
--    entidade — operação é derivada das movs que compartilham o id.
--
-- 2. `correcoes_admin` (tabela nova)
--    Trilha de auditoria forte de toda correção feita por admin. Uma linha
--    POR ITEM corrigido (operação com 3 itens corrigidos = 3 linhas com
--    mesmo operacao_id, mesmo motivo, mesmo admin, mesmo timestamp).
--    Snapshot completo: anterior, novo, diferença, motivo, ids das movs
--    canceladas e novas.
--
-- Estratégia de correção (registrada aqui pra contexto histórico, código
-- vive em CorrecaoAdminService):
--   - NUNCA UPDATE destrutivo em `movimentacoes.quantidade`. Movimentação
--     é evento imutável.
--   - Correção = `marcarCancelada` na mov original + `registrar` mov nova
--     (mesmo loteId/origem/destino/snapshot_preço/operacao_id) com a
--     quantidade corrigida.
--   - O snapshot de preço HERDA o da mov original cancelada — preserva
--     contexto financeiro histórico (impostômetro, custo, margem).
--
-- Idempotente: pode rodar várias vezes contra qualquer estado.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Coluna operacao_id em movimentacoes
-- -----------------------------------------------------------------------------
alter table movimentacoes
  add column if not exists operacao_id text;

-- Índice para reagrupar movs por operação (usado pela tela de correções
-- e pelo CorrecaoAdminService.cancelar-todas-da-operacao).
create index if not exists movimentacoes_operacao_id_idx
  on movimentacoes (operacao_id)
  where operacao_id is not null;


-- -----------------------------------------------------------------------------
-- 2. Tabela correcoes_admin
-- -----------------------------------------------------------------------------
create table if not exists correcoes_admin (
  id                       text        primary key default gen_random_uuid()::text,

  -- Qual bloco operacional foi corrigido. Mesmo enum dos 4 fluxos suportados.
  tipo_bloco               text        not null
                                       check (tipo_bloco in (
                                         'envio_lavanderia',
                                         'retorno_lavanderia',
                                         'saida_imovel',
                                         'retorno_imovel'
                                       )),

  -- Operação corrigida. Para fluxos lavanderia, várias linhas de correção
  -- podem compartilhar o mesmo operacao_id (uma por item alterado).
  -- Para fluxos imóvel (1 mov = 1 operação), também 1:1 normalmente.
  -- Pode ser NULL apenas em correções de movs antigas pré-0006.
  operacao_id              text        null,

  -- Snapshot do item alterado. Guardamos o nome também pra preservar
  -- legibilidade caso o item seja renomeado/excluído depois.
  item_id                  text        not null
                                       references itens(id) on delete restrict,
  nome_item_snapshot       text        not null,

  -- Lote ou local relevante. Apenas um deles é preenchido por linha,
  -- conforme o tipo_bloco. Lote pra fluxos de lavanderia, local (imóvel)
  -- pros fluxos casa.
  lote_id                  text        null
                                       references lotes_lavanderia(id) on delete restrict,
  local_id                 text        null
                                       references locais(id) on delete restrict,

  -- Quantidades. Diferença é coluna persistida pra evitar erro de cálculo
  -- em queries de relatório — verificada pela CHECK contra anterior/nova.
  quantidade_anterior      integer     not null check (quantidade_anterior >= 0),
  quantidade_nova          integer     not null check (quantidade_nova >= 0),
  diferenca                integer     not null
                                       check (diferenca = quantidade_nova - quantidade_anterior),

  -- Motivo livre digitado pelo admin. Mínimo 5 chars enforçado também
  -- no service (mensagem amigável); aqui ficamos com check estrutural.
  motivo                   text        not null check (length(trim(motivo)) >= 5),

  -- Quem corrigiu. Hoje é nome livre (igual `responsavel` em movimentacoes
  -- e lotes); quando virar usuário first-class, evolui pra fk.
  admin_responsavel        text        not null check (length(trim(admin_responsavel)) > 0),

  corrigido_em             timestamptz not null default now(),

  -- Trilha de evidência: quais movs foram canceladas pela correção e
  -- quais movs novas foram criadas. Arrays jsonb permitem 1+ ids
  -- (especialmente fluxo retorno_lavanderia, que pode cancelar 3 movs
  -- e criar 1 mov nova após nova distribuição).
  movs_canceladas_ids      jsonb       not null default '[]'::jsonb,
  movs_novas_ids           jsonb       not null default '[]'::jsonb,

  -- Texto livre gerado pelo sistema com contexto do que foi feito —
  -- aparece no relatório de correções como linha legível.
  observacao_automatica    text        null
);

-- Índices úteis pros filtros do relatório de correções (§L do ticket).
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

commit;
