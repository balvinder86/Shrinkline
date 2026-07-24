-- ============================================================
-- Invoice email-ingestion agent rules (Phase 2).
-- Two axes on `invoices`: `document_type` (what kind of document
-- this is — a credit memo or statement is never a normal invoice,
-- regardless of anything else) and `flags` (issues on an otherwise-
-- real invoice — unknown sender, totals mismatch, etc — which can
-- co-occur, hence an array rather than a single scalar). Neither
-- blocks approval at the DB level: every financial aggregate already
-- gates on status='approved' only (useVendorSpendSummary,
-- useSavingsSummary), so a flagged/duplicate row sitting in
-- pending_review can't pollute spend totals without a human
-- explicitly approving it — same review gate as everything else.
-- ============================================================
alter table invoices
  add column if not exists flags text[] not null default '{}'
    check (flags <@ array['unknown_sender','sender_auth_failed','not_an_invoice',
                           'totals_mismatch','low_confidence','duplicate']::text[]),
  add column if not exists flag_detail text,
  add column if not exists document_type text
    check (document_type in ('invoice','credit_memo','statement','unclear')),
  add column if not exists sender_auth_status text
    check (sender_auth_status in ('pass','fail','unknown'));

-- ------------------------------------------------------------
-- One row per attachment candidate email-ingest ever sees, whether
-- it became an invoice or was rejected before OCR — the audit trail
-- the agent-rules spec requires ("log every decision"). Separate
-- from processed_email_messages, which stays message-level dedup
-- only; this is attachment-level and includes the reason a
-- candidate was skipped, which processed_email_messages has no
-- column for.
-- ------------------------------------------------------------
create table if not exists email_ingestion_events (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  message_id     text not null,
  filename       text,
  mime_type      text,
  size_bytes     bigint,
  outcome        text not null check (outcome in ('processed','skipped')),
  reason         text not null,
  invoice_id     uuid references invoices(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists email_ingestion_events_restaurant_idx
  on email_ingestion_events(restaurant_id);

do $$
declare t text;
begin
  foreach t in array array['email_ingestion_events']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists tenant_isolation on %I;', t);
    execute format(
      'create policy tenant_isolation on %I
         using      (restaurant_id in (select my_restaurants()))
         with check (restaurant_id in (select my_restaurants()));', t);
  end loop;
end $$;
