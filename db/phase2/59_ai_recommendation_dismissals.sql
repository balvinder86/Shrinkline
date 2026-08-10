-- Lets an owner close/minimize the Price Alerts / Alerts panel
-- (src/components/insights/AiRecommendationsPanel.tsx) per tab, and
-- have that stick across reloads and re-logins — but only until the
-- next nightly batch actually produces something new for that tab, at
-- which point it should reappear on its own. Keyed on business_date
-- rather than a plain boolean so "new alert" has a real definition:
-- the frontend compares this row's dismissed_business_date against the
-- latest business_date actually present in ai_recommendations for that
-- (location_id, tab) and only stays collapsed while they match.
--
-- Same shape/RLS pattern as ai_recommendations (54_ai_recommendations.sql):
-- restaurant_id for the tenant_isolation policy, location_id since
-- that's what the panel is actually scoped by.
create table if not exists ai_recommendation_dismissals (
  restaurant_id            uuid not null references restaurants(id) on delete cascade,
  location_id              uuid not null references locations(id) on delete cascade,
  tab                      text not null check (tab in ('food_cost', 'inventory', 'invoices', 'recipes')),
  dismissed_business_date  date not null,
  dismissed_at             timestamptz not null default now(),
  primary key (location_id, tab)
);

alter table ai_recommendation_dismissals enable row level security;
drop policy if exists tenant_isolation on ai_recommendation_dismissals;
create policy tenant_isolation on ai_recommendation_dismissals
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));
