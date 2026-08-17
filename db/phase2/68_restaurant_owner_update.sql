-- restaurants had a read policy only (db/phase0/01_schema.sql: "No
-- insert/update/delete policy on restaurants for normal users —
-- restaurants are created by the service role during onboarding").
-- Settings' Restaurant Profile section needs a real way for the
-- owner to rename their own restaurant — narrowly scoped to owners
-- only (not manager/staff) and only their own restaurant, same
-- my_restaurants()-style isolation every other write policy in this
-- schema already uses.
drop policy if exists owner_update on restaurants;
create policy owner_update on restaurants
  for update
  using (
    id in (select restaurant_id from memberships where user_id = auth.uid() and role = 'owner')
  )
  with check (
    id in (select restaurant_id from memberships where user_id = auth.uid() and role = 'owner')
  );
