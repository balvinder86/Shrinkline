-- ============================================================
-- Allow more than one AI recommendation per tab per day.
--
-- 54_ai_recommendations.sql made (location_id, tab, business_date) the
-- primary key, assuming one recommendation per tab per day. Real batch
-- output broke that assumption immediately: the model can legitimately
-- surface two distinct food_cost warnings in the same run, and
-- Postgres can't upsert two rows targeting the same ON CONFLICT key in
-- one statement ("ON CONFLICT DO UPDATE command cannot affect row a
-- second time"). Move to a surrogate id, and use
-- (location_id, tab, business_date, headline) as the idempotency key
-- instead — still collapses a re-ingested/retried batch's duplicate
-- rows, without capping recommendations-per-tab at one.
-- ============================================================

alter table ai_recommendations drop constraint ai_recommendations_pkey;
alter table ai_recommendations add column if not exists id uuid primary key default gen_random_uuid();

create unique index if not exists ai_recommendations_idempotency_idx
  on ai_recommendations (location_id, tab, business_date, headline);
