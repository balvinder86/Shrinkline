-- Settings > Branding, made real (was a pure mockup — see
-- BrandingSection in src/routes/settings.tsx before this migration).
-- Scope confirmed with the user: colors/tagline/voice-tone are saved
-- data only — this app's own UI does not re-theme per tenant from
-- them, and typeface choice was dropped entirely (no font-loading
-- infrastructure exists for anything beyond the two fonts already
-- baked into the app).
create table if not exists restaurant_branding (
  restaurant_id uuid primary key references restaurants(id) on delete cascade,
  palette       text[] not null default '{}',
  tagline       text,
  voice_tone    text check (
    voice_tone in (
      'warm', 'playful', 'refined', 'casual', 'straightforward'
    )
  ),
  updated_at    timestamptz not null default now()
);

alter table restaurant_branding enable row level security;

drop policy if exists tenant_isolation on restaurant_branding;
create policy tenant_isolation on restaurant_branding
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));
