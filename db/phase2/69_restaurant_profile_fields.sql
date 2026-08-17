-- ============================================================
-- Phase 2 — Restaurant profile fields
-- ------------------------------------------------------------
-- Settings' Restaurant Profile page (src/routes/settings.tsx) had a
-- second card of profile fields (logo, legal name, cuisine, price
-- tier, public contact info, description) that was pure mockup —
-- no columns existed for any of it. This adds them, plus a public
-- storage bucket for the logo upload.
--
-- Write access reuses the owner_update policy already on `restaurants`
-- (db/phase2/68_restaurant_owner_update.sql) — that policy covers the
-- whole row, so no new table-level RLS is needed here, only the
-- storage bucket's own policy.
-- ============================================================
alter table restaurants add column if not exists logo_url text;
alter table restaurants add column if not exists legal_name text;
alter table restaurants add column if not exists cuisine text;
alter table restaurants add column if not exists price_tier text;
alter table restaurants add column if not exists public_email text;
alter table restaurants add column if not exists phone text;
alter table restaurants add column if not exists website text;
alter table restaurants add column if not exists description text;

-- Public so the logo can be shown with a plain <img src> across the
-- dashboard (and later, receipts/email) without minting signed URLs —
-- unlike invoice-uploads/recipe-doc-uploads, which are private because
-- their contents are sensitive.
insert into storage.buckets (id, name, public)
values ('restaurant-logos', 'restaurant-logos', true)
on conflict (id) do nothing;

-- Public read comes from the bucket's public flag (served via the
-- /storage/v1/object/public/ URL, which bypasses RLS entirely) — this
-- policy only needs to gate the authenticated write path, mirroring
-- the owner-only scope of owner_update on restaurants itself.
drop policy if exists owner_write on storage.objects;
create policy owner_write on storage.objects
  for all
  using (
    bucket_id = 'restaurant-logos'
    and (storage.foldername(name))[1]::uuid in (
      select restaurant_id from memberships where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    bucket_id = 'restaurant-logos'
    and (storage.foldername(name))[1]::uuid in (
      select restaurant_id from memberships where user_id = auth.uid() and role = 'owner'
    )
  );
