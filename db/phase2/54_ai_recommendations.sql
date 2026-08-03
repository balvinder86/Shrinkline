-- ============================================================
-- AI recommendations — scheduled Batch API insights layer.
-- - ai_recommendation_batches: one row per business_date, tracking the
--   single Anthropic Batch API job that covers every tenant for that
--   day. Not tenant-scoped (a batch spans all restaurants), so RLS is
--   enabled with no policies — only the insights Railway service
--   (service role, bypasses RLS) ever touches it; no tenant should see
--   other tenants' batch/job metadata via PostgREST.
-- - ai_recommendations: the actual per-tenant, per-tab output. Same
--   idempotent-upsert shape as pmix_sales/menu_items — re-ingesting a
--   batch (or a retried poll) overwrites in place on
--   (location_id, tab, business_date) rather than duplicating rows.
-- ============================================================

create table if not exists ai_recommendation_batches (
  id                  uuid primary key default gen_random_uuid(),
  business_date       date not null unique,
  anthropic_batch_id  text not null,
  status              text not null default 'submitted' check (status in ('submitted', 'ended', 'ingested')),
  tenant_count        int not null default 0,
  submitted_at        timestamptz not null default now(),
  ended_at            timestamptz,
  ingested_at         timestamptz
);

alter table ai_recommendation_batches enable row level security;

create table if not exists ai_recommendations (
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  location_id    uuid not null references locations(id) on delete cascade,
  tab            text not null check (tab in ('food_cost', 'inventory', 'invoices', 'recipes')),
  severity       text not null check (severity in ('info', 'warning', 'critical')),
  headline       text not null,
  body           text not null,
  business_date  date not null,
  generated_at   timestamptz not null default now(),
  primary key (location_id, tab, business_date)
);

create index if not exists ai_recommendations_lookup_idx
  on ai_recommendations(restaurant_id, location_id, business_date);

alter table ai_recommendations enable row level security;
drop policy if exists tenant_isolation on ai_recommendations;
create policy tenant_isolation on ai_recommendations
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));
