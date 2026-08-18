-- ============================================================
-- Phase 3 — Billing schema (Part B of phase3-billing-onboarding-spec)
-- ------------------------------------------------------------
-- Stripe is the source of truth; this table only MIRRORS it. The
-- webhook receiver (Part C, not yet built) runs as service_role and
-- is the ONLY writer of `subscriptions` — everything the app does is
-- read status/plan_tier/quantity off this table, never call Stripe
-- inline. Billing unit is per location: quantity = the restaurant's
-- location count, kept in sync by updating the Stripe subscription's
-- quantity (the webhook mirrors the change back).
-- ============================================================

-- One Stripe Customer per restaurant.
alter table restaurants add column if not exists stripe_customer_id text;

create table if not exists subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  restaurant_id          uuid not null references restaurants(id) on delete cascade,
  stripe_subscription_id text unique,
  -- Stored verbatim from Stripe ('trialing','active','past_due',
  -- 'canceled','incomplete', etc.) rather than translated into our own
  -- enum, so there's nothing to keep in sync as Stripe adds statuses.
  status                 text not null,
  plan_tier              text not null check (plan_tier in ('boh', 'full')),
  quantity               int not null default 1,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now(),
  unique (restaurant_id)
);

create index if not exists subscriptions_restaurant_idx on subscriptions(restaurant_id);

-- Tracks progress through the self-serve onboarding wizard (Part F) —
-- one row per step so a user can leave mid-onboarding and resume
-- exactly where they left off instead of starting over.
create table if not exists onboarding_progress (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  step           text not null check (
    step in ('restaurant', 'owner', 'pos', 'menu', 'recipes', 'par', 'billing')
  ),
  status         text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  completed_at   timestamptz,
  unique (restaurant_id, step)
);

create index if not exists onboarding_progress_restaurant_idx on onboarding_progress(restaurant_id);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- subscriptions: read-only for tenant members, deliberately NOT the
-- usual "for all" tenant_isolation pattern used everywhere else in
-- this schema. Only a `using` clause is defined (no `with check`), so
-- there is no policy under which an authenticated/anon client can
-- insert/update/delete a row here — those verbs fall through to
-- Postgres's default deny. Only service_role (the webhook, which
-- bypasses RLS entirely) can write, which is the whole point of
-- "Stripe is the source of truth."
alter table subscriptions enable row level security;
drop policy if exists tenant_read on subscriptions;
create policy tenant_read on subscriptions
  for select
  using (restaurant_id in (select my_restaurants()));

-- onboarding_progress: standard tenant_isolation — the wizard itself
-- is client-driven (an owner/staff member ticking through steps), so
-- the app needs real read+write access here, unlike subscriptions.
alter table onboarding_progress enable row level security;
drop policy if exists tenant_isolation on onboarding_progress;
create policy tenant_isolation on onboarding_progress
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));
