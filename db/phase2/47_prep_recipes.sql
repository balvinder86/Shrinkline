create table if not exists prep_recipes (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  location_id    uuid not null references locations(id) on delete cascade,
  name           text not null,
  yield_qty      numeric not null default 1,
  yield_unit     text not null default 'each',
  updated_at     timestamptz not null default now(),
  unique (location_id, name)
);

alter table prep_recipes enable row level security;
drop policy if exists tenant_isolation on prep_recipes;
create policy tenant_isolation on prep_recipes
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));

create table if not exists prep_recipe_lines (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  prep_recipe_id     uuid not null references prep_recipes(id) on delete cascade,
  ingredient_id      uuid references ingredients(id) on delete cascade,
  sub_prep_recipe_id uuid references prep_recipes(id) on delete restrict,
  quantity           numeric not null,
  unit               text not null,
  check (
    (ingredient_id is not null and sub_prep_recipe_id is null) or
    (ingredient_id is null and sub_prep_recipe_id is not null)
  )
);

alter table prep_recipe_lines enable row level security;
drop policy if exists tenant_isolation on prep_recipe_lines;
create policy tenant_isolation on prep_recipe_lines
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));

create index if not exists prep_recipe_lines_prep_recipe_id_idx on prep_recipe_lines(prep_recipe_id);
create index if not exists prep_recipe_lines_sub_prep_recipe_id_idx on prep_recipe_lines(sub_prep_recipe_id);

-- Purely additive to the existing, live recipe_lines table — no data
-- migration, the 168 existing real rows (all ingredient_id, all
-- matching "each" units) are untouched and keep working exactly as
-- today. A menu item's recipe line can now point at a prep recipe
-- (e.g. a house sauce) instead of a raw ingredient.
alter table recipe_lines alter column ingredient_id drop not null;
alter table recipe_lines add column if not exists prep_recipe_id uuid references prep_recipes(id) on delete restrict;
alter table recipe_lines drop constraint if exists recipe_lines_line_target_check;
alter table recipe_lines add constraint recipe_lines_line_target_check check (
  (ingredient_id is not null and prep_recipe_id is null) or
  (ingredient_id is null and prep_recipe_id is not null)
);
