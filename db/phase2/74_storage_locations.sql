-- ============================================================
-- Storage locations — Inventory Count. A second, independent axis
-- from ingredients.category: category is the menu/costing taxonomy
-- shared with Recipes (Beverages, Alcohol, Food, Dry Goods,
-- Miscellaneous); storage location is "where it physically lives"
-- (Walk-in, Freezer, Prep area, Liquor…), assigned manually per
-- ingredient purely to make walking a physical count easier and let
-- the count sheet be grouped by where you'd actually go find the
-- item, not what it costs into.
--
-- A real per-tenant table (not a fixed enum like CATEGORIES) since the
-- whole point is a custom, editable list — "Walk-in/Freezer/Prep
-- area/Liquor" are just sensible defaults, not the only options.
-- ============================================================
create table if not exists storage_locations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, name)
);

create index if not exists storage_locations_restaurant_idx
  on storage_locations(restaurant_id);

alter table storage_locations enable row level security;
drop policy if exists tenant_isolation on storage_locations;
create policy tenant_isolation on storage_locations
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));

-- Nullable — existing ingredients start unassigned rather than forcing
-- a backfill guess; set null on delete so removing a storage location
-- un-assigns its items instead of deleting them.
alter table ingredients
  add column if not exists storage_location_id uuid references storage_locations(id) on delete set null;

-- Seed sensible defaults for every restaurant that already exists —
-- new restaurants get the same defaults from create_restaurant() below.
insert into storage_locations (restaurant_id, name)
select r.id, d.name
from restaurants r
cross join (values ('Walk-in'), ('Freezer'), ('Prep area'), ('Liquor')) as d(name)
on conflict (restaurant_id, name) do nothing;

-- create_restaurant() (db/phase2/70_create_restaurant.sql) — re-created
-- here with the same default-storage-location seeding as the backfill
-- above, so a brand created after this migration isn't missing what
-- every pre-existing restaurant now has.
create or replace function create_restaurant(
  p_name text,
  p_location_name text default 'Main',
  p_location_timezone text default 'America/Chicago'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
begin
  insert into restaurants (name) values (p_name) returning id into v_restaurant_id;
  insert into memberships (user_id, restaurant_id, role)
    values (auth.uid(), v_restaurant_id, 'owner');
  insert into locations (restaurant_id, name, timezone)
    values (v_restaurant_id, p_location_name, p_location_timezone);
  insert into storage_locations (restaurant_id, name)
    values (v_restaurant_id, 'Walk-in'), (v_restaurant_id, 'Freezer'),
           (v_restaurant_id, 'Prep area'), (v_restaurant_id, 'Liquor');
  return v_restaurant_id;
end;
$$;

revoke all on function create_restaurant(text, text, text) from public;
revoke all on function create_restaurant(text, text, text) from anon;
grant execute on function create_restaurant(text, text, text) to authenticated;
