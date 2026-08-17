-- ============================================================
-- Phase 2 — self-serve restaurant ("brand") creation
-- ------------------------------------------------------------
-- restaurants had no insert policy at all before this (db/phase0/
-- 01_schema.sql: "Restaurants are created by the service role during
-- onboarding"). This adds a self-serve path: an owner can spin up a
-- second brand from the dashboard itself, instead of needing manual
-- provisioning every time.
--
-- Runs as one security-definer function rather than opening a raw
-- client-side INSERT policy on restaurants, so the three writes
-- (restaurant, owner membership, first location) always happen
-- together — a bare INSERT policy would let a restaurant get created
-- with no owner membership and no location, which almost every query
-- in this app assumes exists.
--
-- No membership check needed here (unlike compute_par_levels, which
-- checks the caller already belongs to the restaurant_id it's passed)
-- — this creates a brand-new restaurant from scratch and makes the
-- caller its owner, so there's nothing pre-existing to validate
-- against. auth.uid() is trusted directly since it comes from the
-- caller's own verified JWT.
-- ============================================================
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
  return v_restaurant_id;
end;
$$;

revoke all on function create_restaurant(text, text, text) from public;
revoke all on function create_restaurant(text, text, text) from anon;
grant execute on function create_restaurant(text, text, text) to authenticated;
