-- Phase 3 Part F (phase 2) — tenant-side Setup checklist. Status is
-- derived from real data, not from onboarding_progress alone: that
-- table is only ever written by the company portal's create_tenant
-- (restaurant/owner rows), so every tenant created before it existed
-- (Thrasher's Pub, Pub 282) has zero rows in it. Reading only that
-- table would make an already-fully-set-up tenant show "nothing done"
-- the moment this ships. onboarding_progress is only consulted here
-- for the one thing derived data can't express: an explicit skip.
create or replace function get_setup_status(p_restaurant_id uuid)
returns table (
  pos_connected   boolean,
  menu_imported   boolean,
  recipes_done    boolean,
  recipes_skipped boolean,
  par_done        boolean,
  par_skipped     boolean,
  billing_active  boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from memberships
    where user_id = auth.uid() and restaurant_id = p_restaurant_id
  ) then
    raise exception 'not a member of this restaurant';
  end if;

  return query select
    exists(select 1 from pos_credentials where restaurant_id = p_restaurant_id),
    exists(select 1 from menu_items where restaurant_id = p_restaurant_id),
    exists(select 1 from recipe_lines where restaurant_id = p_restaurant_id),
    exists(
      select 1 from onboarding_progress
      where restaurant_id = p_restaurant_id and step = 'recipes' and status = 'skipped'
    ),
    exists(
      select 1 from par_levels
      where restaurant_id = p_restaurant_id and par_quantity is not null
    ),
    exists(
      select 1 from onboarding_progress
      where restaurant_id = p_restaurant_id and step = 'par' and status = 'skipped'
    ),
    exists(
      select 1 from subscriptions
      where restaurant_id = p_restaurant_id and status in ('active', 'trialing')
    );
end;
$$;

grant execute on function get_setup_status(uuid) to authenticated;
