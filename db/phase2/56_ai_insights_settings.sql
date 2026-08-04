-- ============================================================
-- Per-tenant tunables for the insights service's recommendation
-- rules. First (and only, for now) field: the invoice price-drift
-- inclusion threshold — see insights/src/invoiceDrift.ts. Same shape
-- as review_agent_settings (restaurant_id primary key, one row per
-- tenant, defaulted in application code when no row exists yet rather
-- than requiring a row to be seeded on signup).
-- ============================================================

create table if not exists ai_insights_settings (
  restaurant_id                uuid primary key references restaurants(id) on delete cascade,
  invoice_drift_threshold_pct  numeric not null default 10
    check (invoice_drift_threshold_pct > 0 and invoice_drift_threshold_pct <= 100),
  updated_at                   timestamptz not null default now()
);

alter table ai_insights_settings enable row level security;
drop policy if exists tenant_isolation on ai_insights_settings;
create policy tenant_isolation on ai_insights_settings
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));
