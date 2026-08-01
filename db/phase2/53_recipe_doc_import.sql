-- ============================================================
-- Bulk recipe import from uploaded Word/PDF documents.
-- - recipe-doc-uploads storage bucket: private, path-scoped by
--   restaurant_id, same shape as invoice-uploads. Given its own
--   policy name (NOT "tenant_isolation") because that name is already
--   taken by invoice-uploads' own policy on this same
--   storage.objects table — reusing it would silently replace that
--   policy (scoped only to bucket_id = 'invoice-uploads') and break
--   invoice uploads entirely.
-- - recipe_imports: one row per uploaded file. `status` plays the
--   same role invoices.ocr_status plays for the Mindee job lifecycle
--   (pending -> processing -> ready/failed), tracked by the Railway
--   OCR service exactly like invoice OCR is. No separate business-
--   approval status column, unlike invoices — nothing here is
--   "approved" at the file level, approval happens per recipe line in
--   the existing recipe review UI.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('recipe-doc-uploads', 'recipe-doc-uploads', false)
on conflict (id) do nothing;

drop policy if exists recipe_doc_tenant_isolation on storage.objects;
create policy recipe_doc_tenant_isolation on storage.objects
  for all
  using (
    bucket_id = 'recipe-doc-uploads'
    and (storage.foldername(name))[1]::uuid in (select my_restaurants())
  )
  with check (
    bucket_id = 'recipe-doc-uploads'
    and (storage.foldername(name))[1]::uuid in (select my_restaurants())
  );

create table if not exists recipe_imports (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  location_id      uuid not null references locations(id) on delete cascade,
  file_name        text not null,
  source_file_url  text not null,
  status           text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  error_detail     text,
  result           jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists recipe_imports_lookup_idx
  on recipe_imports(restaurant_id, location_id, status);

alter table recipe_imports enable row level security;
drop policy if exists tenant_isolation on recipe_imports;
create policy tenant_isolation on recipe_imports
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));
