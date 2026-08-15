-- ============================================================
-- Waste Log — record ingredient waste (spoilage, over-production,
-- breakage, spills, expired stock, prep errors) with its dollar cost,
-- so it's visible as its own line item instead of silently showing up
-- as an unexplained gap between theoretical and actual food cost.
--
-- Deliberately ingredient-only (not menu items) — matches how recipe
-- cost and food cost % already work, and every ingredient already has
-- a priced native unit (unit_cost_cents) to resolve a cost from.
--
-- Deliberately does NOT touch ingredient_stock.on_hand_quantity — this
-- is a cost/reporting ledger, not a perpetual-inventory system. Wiring
-- it into on-hand counts would need careful reversal logic on
-- edit/delete that isn't worth the complexity until real inventory
-- counts are a core workflow.
-- ============================================================

create table if not exists waste_log (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  location_id    uuid not null references locations(id) on delete cascade,
  ingredient_id  uuid not null references ingredients(id) on delete cascade,
  quantity       numeric not null check (quantity > 0),
  -- The unit the quantity was logged in — may differ from the
  -- ingredient's own priced unit (e.g. "3 oz" of a wine bought
  -- "each"), same convention as recipe_lines.unit. Converted via
  -- convertQuantityToIngredientUnit before costing.
  unit           text not null,
  reason         text not null check (
    reason in ('spoilage', 'over_production', 'breakage', 'spill', 'expired', 'prep_error', 'other')
  ),
  -- Resolved client-side at log time (quantity converted to the
  -- ingredient's native unit × unit_cost_cents) and stored, not
  -- recomputed live — so a later change to the ingredient's cost
  -- doesn't retroactively rewrite what a past waste event actually
  -- cost. Null when the ingredient had no cost yet or the unit
  -- couldn't convert — never a silently-wrong $0.
  cost_cents     bigint,
  notes          text,
  logged_at      date not null default current_date,
  created_at     timestamptz not null default now()
);

create index if not exists waste_log_lookup_idx
  on waste_log(restaurant_id, location_id, logged_at);

alter table waste_log enable row level security;
drop policy if exists tenant_isolation on waste_log;
create policy tenant_isolation on waste_log
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));
