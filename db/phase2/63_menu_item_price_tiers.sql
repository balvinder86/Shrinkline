-- ============================================================
-- Per-size price tiers (Bottle/Pint/Pitcher, well-liquor Single/
-- Double, Happy Hour variants, ...) — some menu items sell at
-- multiple real prices, and until now the whole system (menu_items,
-- pmix_sales, recipe_lines) only ever tracked ONE number for them:
-- menu_items already picks the cheapest tier as a "starting price"
-- (see 16_menu_item_starting_price.sql), pmix_sales blends every
-- tier's sales into one quantity/dollar total, and recipe_lines can
-- only hold one recipe per POS item — so a 16oz pint and a 60oz
-- pitcher of the same beer were priced identically, using whichever
-- tier happened to be cheapest.
--
-- Confirmed against a real, live Toast order payload before writing
-- any of this (not guessed from docs): a sale's selection carries a
-- `modifiers[]` array, and the modifier that actually determines the
-- served size/price is the one with `optionGroupPricingMode ===
-- 'REPLACES_PRICE'` — Toast's own explicit signal, distinct from
-- purely descriptive modifiers (e.g. a $0 "Reposado" flavor modifier
-- sits alongside a real $9 "Sgl" (Single) size modifier on the same
-- line). sync/ derives tiers from exactly that signal.
-- ============================================================

create table if not exists menu_item_price_tiers (
  id                       uuid primary key default gen_random_uuid(),
  restaurant_id            uuid not null references restaurants(id) on delete cascade,
  location_id              uuid not null references locations(id) on delete cascade,
  menu_item_pos_id         text not null,
  -- The modifier selection's own item guid (Toast models each size
  -- option as its own MenuItem entity) — this, not the tier name
  -- alone, is the stable identity; two different items could both
  -- have a tier literally named "Pint."
  toast_modifier_item_guid text not null,
  tier_name                text not null, -- e.g. "BTL", "PINT", "PITCHER", "Sgl"
  last_price_cents         bigint,        -- most recently observed realized price, informational only
  updated_at               timestamptz not null default now(),
  unique (location_id, menu_item_pos_id, toast_modifier_item_guid)
);

create index if not exists menu_item_price_tiers_lookup_idx
  on menu_item_price_tiers(restaurant_id, location_id, menu_item_pos_id);

alter table menu_item_price_tiers enable row level security;
drop policy if exists tenant_isolation on menu_item_price_tiers;
create policy tenant_isolation on menu_item_price_tiers
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));

-- Same shape as pmix_sales, one level more granular — a menu item
-- with tiers gets one row per (date, tier) here IN ADDITION TO its
-- existing single blended pmix_sales row (untouched, still the
-- source of truth for anything that doesn't care about size, like
-- par-level usage). Only created for items that actually have a
-- REPLACES_PRICE modifier on at least one sale; everything else never
-- gets a row here.
create table if not exists pmix_sales_by_tier (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  location_id       uuid not null references locations(id) on delete cascade,
  business_date     date not null,
  menu_item_pos_id  text not null,
  price_tier_id     uuid not null references menu_item_price_tiers(id) on delete cascade,
  quantity_sold     numeric not null default 0,
  net_sales_cents   bigint not null default 0,
  updated_at        timestamptz not null default now(),
  unique (location_id, business_date, menu_item_pos_id, price_tier_id)
);

create index if not exists pmix_sales_by_tier_lookup_idx
  on pmix_sales_by_tier(restaurant_id, location_id, business_date);

alter table pmix_sales_by_tier enable row level security;
drop policy if exists tenant_isolation on pmix_sales_by_tier;
create policy tenant_isolation on pmix_sales_by_tier
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));

-- recipe_lines: a menu item with price tiers can have a SEPARATE
-- recipe per tier (a pint pour costs differently than a pitcher).
-- null price_tier_id keeps meaning exactly what it always has — "the"
-- recipe for this item — so every one of the existing real recipe
-- rows is completely unaffected; this is purely additive.
alter table recipe_lines add column if not exists price_tier_id uuid references menu_item_price_tiers(id) on delete cascade;

alter table recipe_lines drop constraint if exists recipe_lines_location_id_menu_item_pos_id_ingredient_id_key;
create unique index if not exists recipe_lines_unique_line_idx
  on recipe_lines (
    location_id,
    menu_item_pos_id,
    coalesce(price_tier_id, '00000000-0000-0000-0000-000000000000'::uuid),
    ingredient_id
  );
