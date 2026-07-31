-- One uploaded file can turn out to contain multiple separate real
-- invoices (a vendor emailing a week's batch as one PDF attachment,
-- confirmed real on an FSI invoice — see project memory 2026-07-31).
-- Mindee gives no page/location metadata for this custom model, and
-- these documents are often scanned/image-based with no embedded text
-- layer, so detecting invoice boundaries needs each page to go
-- through its own real Mindee job — invoice_number then groups pages
-- back into their real invoices. Tracks those in-flight per-page jobs
-- against the one invoices row created at upload time; that row's own
-- mindee_job_id is set to the sentinel 'multi-page' rather than left
-- null so it still satisfies existing listStuckInvoices/
-- listNeverEnqueuedInvoices "not null" checks without needing to
-- touch those queries.
create table if not exists invoice_page_jobs (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  invoice_id     uuid not null references invoices(id) on delete cascade,
  page_number    int not null,
  mindee_job_id  text not null,
  created_at     timestamptz not null default now(),
  unique (invoice_id, page_number)
);

alter table invoice_page_jobs enable row level security;
drop policy if exists tenant_isolation on invoice_page_jobs;
create policy tenant_isolation on invoice_page_jobs
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));

-- When a multi-page upload splits into more than one real invoice,
-- the first group reuses the original row (created at upload time);
-- every additional group gets a fresh row referencing it here, purely
-- for traceability ("why are there 3 more FSI invoices with the same
-- source_file_url as this one").
alter table invoices add column if not exists split_from_invoice_id uuid references invoices(id) on delete set null;
