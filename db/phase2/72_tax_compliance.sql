-- Settings > Tax & compliance, made real (was a pure mockup). Owner-
-- only write access on both tables — tax IDs and legal documents are
-- at least as sensitive as the business-identity fields on
-- `restaurants` itself, which already use owner-only RLS
-- (db/phase2/68_restaurant_owner_update.sql) rather than the more
-- permissive tenant_isolation pattern review_agent_settings/
-- restaurant_branding use.
create table if not exists restaurant_tax_settings (
  restaurant_id           uuid primary key references restaurants(id) on delete cascade,
  federal_ein             text,
  state_tax_id            text,
  default_sales_tax_rate  numeric,
  liquor_tax_rate         numeric,
  tax_inclusive_pricing   boolean not null default false,
  fiscal_year_start_month int not null default 1 check (fiscal_year_start_month between 1 and 12),
  updated_at              timestamptz not null default now()
);

create table if not exists tax_documents (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  doc_type      text not null check (doc_type in ('w9', 'resale_certificate', 'health_permit', 'other')),
  storage_path  text not null,
  uploaded_at   timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['restaurant_tax_settings', 'tax_documents']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists owner_write on %I;', t);
    execute format(
      'create policy owner_write on %I
         using      (restaurant_id in (select restaurant_id from memberships where user_id = auth.uid() and role = ''owner''))
         with check (restaurant_id in (select restaurant_id from memberships where user_id = auth.uid() and role = ''owner''));', t);
  end loop;
end $$;

-- Private — unlike restaurant-logos, a W-9 or EIN document is
-- genuinely sensitive. Same shape as invoice-uploads
-- (db/phase2/24_invoice_ocr_support.sql): public:false, downloads via
-- a freshly-minted signed URL per click, never a stored public one.
insert into storage.buckets (id, name, public)
values ('tax-documents', 'tax-documents', false)
on conflict (id) do nothing;

-- Named distinctly from storage.objects' existing "owner_write" policy
-- (scoped to restaurant-logos, db/phase2/69_restaurant_profile_fields.sql)
-- so this does NOT drop or replace that one — both policies coexist,
-- each gated to its own bucket_id.
drop policy if exists tax_documents_owner_write on storage.objects;
create policy tax_documents_owner_write on storage.objects
  for all
  using (
    bucket_id = 'tax-documents'
    and (storage.foldername(name))[1]::uuid in (
      select restaurant_id from memberships where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    bucket_id = 'tax-documents'
    and (storage.foldername(name))[1]::uuid in (
      select restaurant_id from memberships where user_id = auth.uid() and role = 'owner'
    )
  );
