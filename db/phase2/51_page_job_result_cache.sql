-- A completed Mindee job's result turns out to be effectively
-- one-time/ephemeral — re-fetching an already-successfully-fetched
-- job on a later /check call (waiting on a slower sibling page to
-- finish) silently reverts it to "processing" instead of returning
-- the same result again. Confirmed live: 6 of 7 real page jobs showed
-- "ready" on one poll, then 5 of those flipped back to "processing"
-- on the very next poll after being re-fetched. Each page's result
-- must be saved the first time it's successfully read and never
-- re-requested from Mindee after that.
alter table invoice_page_jobs add column if not exists result jsonb;
