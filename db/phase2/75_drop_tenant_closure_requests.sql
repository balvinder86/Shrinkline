-- Superseded by real self-serve brand delete
-- (supabase/functions/delete-restaurant/index.ts) — the closure-
-- request queue this table backed (db/phase2/73_tenant_closure_requests.sql)
-- was scoped as "platform operator acts on it from the company
-- portal," but nothing was ever built to act on a request, so it just
-- sat unused. Dropping rather than leaving unused schema behind.
drop table if exists tenant_closure_requests;
