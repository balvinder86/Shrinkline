-- invoice_lines: persist product_code (needed to key the case/bottle
-- memory below) and the pack size this specific line's description
-- text happened to parse to (informational — shown in the resolve UI
-- as a suggested value, not itself trusted for costing once a real
-- vendor_product_pack_info resolution exists).
alter table invoice_lines add column if not exists product_code text;
alter table invoice_lines add column if not exists detected_pack_size numeric;
alter table invoice_lines add column if not exists case_pricing_status text
  check (case_pricing_status in ('auto', 'needs_review'));

-- Per-tenant, per-vendor, per-SKU memory of whether a line item is
-- ordered by the case or by the bottle — resolved once by a human
-- reviewer, then reused automatically for every future invoice from
-- that vendor for that same product_code. Exists because OCR alone
-- can't reliably tell the two apart: a distributor's own printed
-- pack-size text (BPC) is a static fact about the SKU, not about
-- whether THIS specific order was a full case or a single bottle off
-- the shelf, and repeated attempts at getting Mindee to extract which
-- printed column a line's quantity came from proved unreliable across
-- a real multi-page document (see project notes, 2026-07-29 — worked
-- on page 1 of a document, silently reverted on page 2 of the same
-- one, for three separate custom fields in a row).
create table if not exists vendor_product_pack_info (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  vendor_id      uuid not null references vendors(id) on delete cascade,
  product_code   text not null,
  order_unit     text not null check (order_unit in ('case', 'bottle')),
  pack_size      numeric,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, vendor_id, product_code)
);

alter table vendor_product_pack_info enable row level security;
drop policy if exists tenant_isolation on vendor_product_pack_info;
create policy tenant_isolation on vendor_product_pack_info
  using      (restaurant_id in (select my_restaurants()))
  with check (restaurant_id in (select my_restaurants()));

-- invoices.flags' original check constraint (44_invoice_agent_rules.sql)
-- only allowlisted 6 values from that migration's date — widening it
-- here to include the two case/bottle-pricing flags ocr/src/server.ts
-- writes via addInvoiceFlag(), or those writes fail the constraint.
alter table invoices drop constraint if exists invoices_flags_check;
alter table invoices add constraint invoices_flags_check
  check (flags <@ array['unknown_sender','sender_auth_failed','not_an_invoice',
                         'totals_mismatch','low_confidence','duplicate',
                         'case_pricing_adjusted','case_pricing_needs_review']::text[]);
