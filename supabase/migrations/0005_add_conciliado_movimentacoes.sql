-- =============================================================================
-- 0005_add_conciliado_movimentacoes.sql
-- =============================================================================
-- Adiciona a coluna `conciliado boolean NOT NULL DEFAULT true` em
-- `movimentacoes`. Todas as linhas pré-existentes ficam conciliadas
-- (default true) — a granularidade nasce a partir desta migration.
--
-- Razão: o canal "excedente operacional não conciliado" do recebimento
-- de lavanderia (ver LoteLavanderiaService.registrarRetornoEFinalizar)
-- precisa de marcação semântica diferente das movs normais. Antes
-- usávamos só `loteId IS NULL` como indício de excedente, mas isso é
-- ambíguo: ajustes manuais legítimos também têm loteId NULL. A coluna
-- explícita resolve a ambiguidade e permite:
--   - admin filtrar `WHERE conciliado=false` pra investigar sobras
--     sem parsear texto livre da observação;
--   - relatórios decomporem `totalRetornado` em conciliado vs não
--     conciliado sem afetar o agregado;
--   - alerta operacional automático (console.warn estruturado) ao
--     gravar mov não-conciliada — auditoria diária da operação.
--
-- O índice parcial `WHERE conciliado=false` mantém a varredura barata
-- mesmo com milhares de movs históricas conciliadas.
--
-- Idempotente: pode rodar várias vezes contra qualquer estado.
-- =============================================================================

begin;

alter table movimentacoes
  add column if not exists conciliado boolean not null default true;

create index if not exists movimentacoes_nao_conciliadas_idx
  on movimentacoes (item_id, registrado_em desc)
  where conciliado = false;

commit;
