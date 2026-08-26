-- Real backend for Settings > Notifications (src/routes/settings.tsx's
-- NotificationsSection), replacing the fully-fake placeholder (8
-- illustrative toggles, all disabled, nothing sent or saved). Only 4
-- events ship for v1 — the ones with a real data source; Schedule
-- conflicts/Reservation activity/Campaign performance/Segment
-- milestones are dropped entirely, same call as the AI-native
-- rollout skipping Loyalty/Scheduling for having no real backend.
--
-- Per-(user, restaurant), not per-restaurant: a person on staff at
-- two restaurants can want different preferences at each. Absence of
-- a row means "on" (the client defaults every toggle to checked) — a
-- row is only written when someone actually changes something, same
-- lazy-write approach as other real Settings toggles in this app.
create table if not exists notification_preferences (
  user_id        uuid not null references auth.users(id) on delete cascade,
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  event_key      text not null check (event_key in
                   ('low_inventory', 'new_review', 'negative_review', 'ai_recommendations')),
  email_enabled  boolean not null default true,
  updated_at     timestamptz not null default now(),
  primary key (user_id, restaurant_id, event_key)
);

alter table notification_preferences enable row level security;
drop policy if exists own_preferences on notification_preferences;
create policy own_preferences on notification_preferences
  using      (user_id = auth.uid() and restaurant_id in (select my_restaurants()))
  with check (user_id = auth.uid() and restaurant_id in (select my_restaurants()));

-- One row per restaurant — when the nightly insights digest last went
-- out, and for what business_date. Drives "reviews since the last
-- digest" and guards against a double-send if the insights cron's
-- 15-minute poll loop runs again the same day after ingestion already
-- completed (see insights/src/index.ts's getTodaysBatch idempotency,
-- same spirit applied here for the digest step that comes after it).
create table if not exists notification_digest_log (
  restaurant_id  uuid primary key references restaurants(id) on delete cascade,
  last_sent_at   timestamptz not null default now(),
  business_date  date not null
);

alter table notification_digest_log enable row level security;
drop policy if exists tenant_isolation on notification_digest_log;
create policy tenant_isolation on notification_digest_log
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));
