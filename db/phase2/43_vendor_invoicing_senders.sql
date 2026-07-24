-- ============================================================
-- Phase 2 — Vendor invoicing sender emails
-- Lets a restaurant manually record which inbound email address(es)
-- a vendor's invoices arrive from, so email-ingest can auto-assign
-- vendor_id on pending invoices instead of leaving every
-- email-ingested invoice unassigned for manual review.
-- Stored lowercased/trimmed by the app before write so a plain
-- array-containment lookup (no citext extension) is enough to match.
-- ============================================================
alter table vendors add column if not exists invoicing_sender_emails text[] not null default '{}';
