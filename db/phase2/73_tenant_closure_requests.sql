-- Settings > Restaurant profile > "Close this brand". Deleting a whole
-- tenant is a platform-operator action (mirrors tenant creation, which
-- already only happens from the company portal, not this dashboard) —
-- an owner can request closure here, but the actual delete + Stripe
-- subscription cancellation happens from the company portal side, not
-- self-serve. This table is just the request queue.
create table if not exists tenant_closure_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  requested_by  uuid not null references auth.users(id),
  note          text,
  status        text not null default 'pending' check (status in ('pending', 'closed', 'cancelled')),
  created_at    timestamptz not null default now()
);

-- Owner-only, same reasoning/shape as restaurant_tax_settings
-- (db/phase2/72_tax_compliance.sql) — closing a brand is at least as
-- sensitive as its tax documents.
alter table tenant_closure_requests enable row level security;

drop policy if exists owner_write on tenant_closure_requests;
create policy owner_write on tenant_closure_requests
  using      (restaurant_id in (select restaurant_id from memberships where user_id = auth.uid() and role = 'owner'))
  with check (restaurant_id in (select restaurant_id from memberships where user_id = auth.uid() and role = 'owner'));
