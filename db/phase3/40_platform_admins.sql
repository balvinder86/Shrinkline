-- Phase 3 Part F (company portal) — a platform-operator concept,
-- independent of memberships (which is entirely restaurant-scoped).
-- Only a platform admin can create new tenants and invite their
-- owners from the company portal (supabase/functions/company-portal).
create table if not exists platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table platform_admins enable row level security;

-- No insert/update/delete policy for authenticated — only a
-- service-role caller (i.e. me, via `supabase db query --linked`) can
-- grant platform-admin. Select-own-row exists so the client can check
-- "am I a platform admin" (src/lib/company/queries.ts's
-- usePlatformAdmin) without needing a round trip through an edge
-- function just to decide whether to show the nav item.
create policy "platform admins can read own row"
  on platform_admins for select
  using (user_id = auth.uid());
