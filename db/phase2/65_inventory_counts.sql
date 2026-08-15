-- ============================================================
-- Inventory Counts — a dedicated physical-count workflow, separate
-- from the day-to-day on-hand number Items & Orders tracks for
-- reordering. ingredient_stock.on_hand_quantity is a running number
-- nudged by manual +/- edits and smart-cart math; it drifts from
-- reality over time (shrinkage, uncounted breakage, miscounts). This
-- table pair lets a real physical count be saved as its own dated
-- record, so total inventory value can be compared count-to-count
-- (catching shrinkage/theft) instead of only ever showing "whatever
-- the running number currently says."
--
-- Saving a count also syncs ingredient_stock.on_hand_quantity to the
-- counted quantities — a real physical count is the most authoritative
-- source of truth available, so it should become the new baseline for
-- par-level/reorder math too, not just sit in its own silo.
-- ============================================================

create table if not exists inventory_counts (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  location_id       uuid not null references locations(id) on delete cascade,
  counted_at        date not null default current_date,
  -- Denormalized summary, computed once at save time from this
  -- count's own lines — avoids re-summing inventory_count_lines every
  -- time the history list renders.
  total_value_cents bigint not null default 0,
  item_count        integer not null default 0,
  notes             text,
  created_at        timestamptz not null default now()
);

create index if not exists inventory_counts_lookup_idx
  on inventory_counts(restaurant_id, location_id, counted_at);

alter table inventory_counts enable row level security;
drop policy if exists tenant_isolation on inventory_counts;
create policy tenant_isolation on inventory_counts
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));

create table if not exists inventory_count_lines (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  inventory_count_id uuid not null references inventory_counts(id) on delete cascade,
  ingredient_id      uuid not null references ingredients(id) on delete cascade,
  quantity           numeric not null default 0,
  -- Snapshot of the ingredient's cost AT COUNT TIME, same point-in-time
  -- philosophy as waste_log.cost_cents — a past count's valuation must
  -- stay accurate even after the ingredient's price later changes.
  unit_cost_cents    bigint,
  value_cents        bigint,
  unique (inventory_count_id, ingredient_id)
);

create index if not exists inventory_count_lines_count_idx
  on inventory_count_lines(inventory_count_id);

alter table inventory_count_lines enable row level security;
drop policy if exists tenant_isolation on inventory_count_lines;
create policy tenant_isolation on inventory_count_lines
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));
