-- Bounded-retry guard for the Sep 8 2026 cost incident: a multi-page
-- invoice stuck between classifyDocument() (a real, billed Haiku call)
-- and the write that would stop the 5-minute background sweep from
-- re-picking it up generated an unbounded stream of re-billed classify
-- calls for ~15 hours before self-resolving, the same failure shape as
-- the Aug 25-30 incident (169ebef) but from a different exception point
-- that fix didn't cover. This counter lets ocr/src/server.ts's
-- handleEnqueue and db.ts's persistResult cap classify attempts per
-- invoice instead of retrying forever on any future exception type.
alter table invoices add column if not exists classify_attempts integer not null default 0;
