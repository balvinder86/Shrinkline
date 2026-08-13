-- Lets a recipe line be written in whatever unit it's actually used in
-- (a 5oz pour) even when the ingredient itself is purchased as a count
-- unit (a 750ml bottle) — container_size_ml is the bridge fact: how
-- much volume is in one purchase unit. Null/unset for ingredients
-- where this doesn't apply (nothing to bridge to for dry goods, case
-- goods measured by weight, etc).
alter table ingredients add column if not exists container_size_ml numeric;
alter table ingredients drop constraint if exists ingredients_container_size_ml_check;
alter table ingredients add constraint ingredients_container_size_ml_check
  check (container_size_ml is null or container_size_ml > 0);

-- Mirrors src/lib/units.ts's convertQuantityToIngredientUnit exactly
-- (same mL-per-unit / g-per-unit ratios) — needed here because
-- compute_par_levels sums recipe_lines.quantity in Postgres, not JS.
-- Keep both in sync if the unit list ever changes.
create or replace function convert_to_ingredient_unit(
  p_quantity numeric,
  p_from_unit text,
  p_ingredient_unit text,
  p_container_size_ml numeric
) returns numeric
language sql
immutable
as $$
  select case
    when p_from_unit = p_ingredient_unit then p_quantity
    when p_from_unit in ('oz','cup','pt','qt','gal','ml','L')
     and p_ingredient_unit in ('oz','cup','pt','qt','gal','ml','L') then
      p_quantity
      * (case p_from_unit
           when 'oz' then 29.5735 when 'cup' then 236.588 when 'pt' then 473.176
           when 'qt' then 946.353 when 'gal' then 3785.41 when 'ml' then 1 when 'L' then 1000
         end)
      / (case p_ingredient_unit
           when 'oz' then 29.5735 when 'cup' then 236.588 when 'pt' then 473.176
           when 'qt' then 946.353 when 'gal' then 3785.41 when 'ml' then 1 when 'L' then 1000
         end)
    when p_from_unit in ('lb','g') and p_ingredient_unit in ('lb','g') then
      p_quantity
      * (case p_from_unit when 'lb' then 453.592 when 'g' then 1 end)
      / (case p_ingredient_unit when 'lb' then 453.592 when 'g' then 1 end)
    when p_from_unit in ('oz','cup','pt','qt','gal','ml','L')
     and p_ingredient_unit not in ('oz','cup','pt','qt','gal','ml','L','lb','g')
     and p_container_size_ml is not null then
      p_quantity
      * (case p_from_unit
           when 'oz' then 29.5735 when 'cup' then 236.588 when 'pt' then 473.176
           when 'qt' then 946.353 when 'gal' then 3785.41 when 'ml' then 1 when 'L' then 1000
         end)
      / p_container_size_ml
    else null
  end;
$$;

-- Same shape as before, plus: joins ingredients so the usage sum can
-- convert each line's unit against the ingredient's real purchase
-- unit (a recipe line written in oz now correctly contributes a
-- fraction of a bottle to avg_daily_usage, not a raw oz count treated
-- as whole bottles). Falls back to the raw quantity via coalesce only
-- when conversion is impossible (shouldn't happen for a valid line,
-- but avoid losing the whole ingredient's usage over one bad row).
-- Also now filters out prep-recipe-only lines (ingredient_id null) —
-- those were previously grouped under a null key that could never
-- match an existing par_levels row.
create or replace function compute_par_levels(
  p_restaurant_id uuid,
  p_location_id uuid,
  p_window_days int default 28
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_restaurant_id not in (select my_restaurants()) then
    raise exception 'not a member of this restaurant';
  end if;

  if not exists (
    select 1 from locations
    where id = p_location_id and restaurant_id = p_restaurant_id
  ) then
    raise exception 'location does not belong to this restaurant';
  end if;

  insert into par_levels (
    restaurant_id, location_id, ingredient_id,
    par_quantity, safety_stock, days_to_delivery,
    avg_daily_usage, suggested_par_quantity, updated_at
  )
  select
    p_restaurant_id,
    p_location_id,
    usage.ingredient_id,
    coalesce(existing.par_quantity, 0),
    coalesce(existing.safety_stock, 0),
    coalesce(existing.days_to_delivery, 3),
    usage.avg_daily_usage,
    (usage.avg_daily_usage * coalesce(existing.days_to_delivery, 3)) + coalesce(existing.safety_stock, 0),
    now()
  from (
    select
      rl.ingredient_id,
      sum(
        coalesce(
          convert_to_ingredient_unit(rl.quantity, rl.unit, ing.unit, ing.container_size_ml),
          rl.quantity
        ) * ps.quantity_sold
      ) / p_window_days::numeric as avg_daily_usage
    from recipe_lines rl
    join ingredients ing on ing.id = rl.ingredient_id
    join pmix_sales ps
      on ps.menu_item_pos_id = rl.menu_item_pos_id
     and ps.location_id = rl.location_id
     and ps.restaurant_id = rl.restaurant_id
    where rl.restaurant_id = p_restaurant_id
      and rl.location_id = p_location_id
      and rl.ingredient_id is not null
      and ps.business_date >= current_date - p_window_days
    group by rl.ingredient_id
  ) usage
  left join par_levels existing
    on existing.location_id = p_location_id
   and existing.ingredient_id = usage.ingredient_id
  on conflict (location_id, ingredient_id)
  do update set
    avg_daily_usage = excluded.avg_daily_usage,
    suggested_par_quantity = excluded.suggested_par_quantity,
    updated_at = now();
end;
$$;
