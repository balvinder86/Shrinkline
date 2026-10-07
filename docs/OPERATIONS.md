# Shrinkline — Operations Runbook

> How to deploy, switch things on/off, investigate problems, and what has gone wrong before.
>
> Last verified: 2026-10-07.

---

## 1. Environments & URLs

| Thing | Where |
|---|---|
| Tenant app | https://app.shrinkline.ai (fallback `thrasherscornerpub.lovable.app`, still in Auth redirect allow-list) |
| Company portal | https://portal.shrinkline.ai (repo `thrasherscornerpub-572664d9`) |
| Supabase | project `dgyfcosmgbbtcwrqnevg` (dashboard name "Shrinkline") |
| Railway | one project per service: sync, ocr, email-ingest, insights, review-agent, stripe-webhook |
| Stripe | **test mode** |
| Email | Resend, domain `mail.shrinkline.ai` (auth + digest) |

There is no separate staging environment — everything is production.

---

## 2. Deploying

| Component | How |
|---|---|
| Frontend | Push to `main` → Lovable syncs → click **Publish** in Lovable. Confirm with `curl -sI https://app.shrinkline.ai \| grep -i x-deployment-id` (value must change). |
| Railway services | Push to `main` → Railway auto-deploys services whose folder changed (`railway.json` per folder). Check with `railway logs`, not just `railway status`. |
| Edge Functions | `supabase functions deploy <name>` |
| Edge Function secrets | `supabase secrets set KEY=value` |
| DB migrations | `supabase db query --linked -f db/<phase>/<file>.sql` — see §4 |

**Lovable warning:** never force-push or rewrite history on `main` — it breaks the Lovable project history (see `AGENTS.md`). Lovable's bot can also push to `main`; pull before you push.

---

## 3. Kill switches (paused features)

| Feature | Off since | Switch | To turn back on |
|---|---|---|---|
| Nightly AI insights | 2026-09-08 (`06a0e08`) | `insights/src/index.ts:28` `const INSIGHTS_DISABLED = true` | Set to `false` (or delete the guard), push. Resumes for the current business date; no backfill. |
| Nightly digest email | 2026-08-31 (`f190eff`) | `insights/src/digest.ts:119` `const DIGEST_DISABLED = true` | Set to `false`, push. Needs insights on to have content. No backlog sent. |
| Chat assistant | 2026-08-28 (`fbffb4f`) | `src/routes/__root.tsx:241` `{/* <ChatWidget /> */}` **and** `supabase/functions/chat/index.ts:1264` early 503 | Uncomment the widget, remove the early return, deploy the function, Publish in Lovable. |

Rough cost of each when on: insights ~1 Sonnet 5 batch request per location per day (half price); chat is per-message and the most unpredictable.

---

## 4. Database operations

- Apply: `supabase db query --linked -f <file>` (no DB password needed).
- Ad-hoc query: `supabase db query --linked "select …"` — read-only checks only unless you mean it.
- After adding a migration: add it to the Apply step in `.github/workflows/db-isolation.yml`.
- Never `drop policy` on `storage.objects` without listing existing policies first.

Useful health checks:

```sql
-- Is ingestion alive?
select max(created_at) from invoices;
-- Are insights running?
select max(business_date) from ai_recommendations;
-- Is the review scraper alive?
select max(created_at) from reviews;
-- Anything stuck in OCR or retrying?
select id, ocr_status, status, classify_attempts, created_at from invoices
where ocr_status = 'processing' or classify_attempts >= 2 order by created_at;
```

Values on 2026-10-07: last invoice 2026-10-07 ✅, last recommendation 2026-09-09 (paused), last review 2026-08-31 (scraper broken).

---

## 5. Cost incidents (history)

All three were background retry loops paying for a Claude Haiku call on every pass. **Rule that came out of them:** every background sweep that retries must have a bounded attempt counter and a terminal "failed" state.

| Date | Cause | Impact | Fix |
|---|---|---|---|
| 2026-08-25 → 08-30 | One unparseable invoice PDF never got marked failed; the 5-min OCR recheck sweep re-classified it forever. | ~$12-18/day Haiku | `169ebef` — mark permanent parse failures `failed` immediately. |
| 2026-09-08 | Second retry-loop spike on a different invoice. | ~$4.95 | `da2907b` — general cap: `classify_attempts` column (migration 78), `MAX_CLASSIFY_ATTEMPTS = 3` in `ocr/src/db.ts`. |
| 2026-09-25 | `email-ingest` re-ingested a payroll email every 15 min: its linked invoice had been deleted, the dedup insert hit an FK error, so it never counted as processed. | Repeat classify calls | `92109da` — keep the dedup record even when the linked invoice is gone. |

Also cost-driven: chat disabled (08-28), digest disabled (08-31), insights paused (09-08), insights/chat moved Opus 5 → Sonnet 5 with prompt caching (08-26).

**If Anthropic spend jumps:** check the Anthropic console by API key, then `railway logs` for `ocr` and `email-ingest`, then run the stuck-invoice query above.

---

## 6. Gotchas

- **Lovable sync ≠ publish.** Check `x-deployment-id` changes.
- **Railway "Deploy failed" on cron services** (`restartPolicyType: NEVER`) is often just the run-once exit — read the logs.
- **`storage.objects` is shared** across all buckets — policy name collisions are real (near-miss with tax-documents).
- **Copying service-role secrets between Railway services** by script gets blocked by Claude Code's auto-mode safety check — do it in the Railway dashboard.
- **`hsl(var(--x))` breaks colors** — palette is `oklch()`.
- **Prettier on old files** reformats hundreds of lines — use targeted edits, compare lint counts.
- **Tier gate exists twice** (client + server) — change both.
- **Batch API `custom_id` max 64 chars** — that's why it's `location_id` alone.
- **Review scraper relies on a logged-in Google session + CSS selectors** — breaks whenever Google changes the reviews panel.

---

## 7. Review scraper — 2026-10-07 fix and runbook

**What broke:** from 2026-09-01 the scan timed out on the "Read reviews" button; by October every sweep failed at `browserType.launch` (Chromium exiting with `SIGTRAP`). Root cause: `node` ran as PID 1 with no init process, so the helper processes Chromium leaves behind were never cleaned up and built up over weeks until Chromium couldn't start. **Fix `3b913d0`:** `tini` as the container init (Dockerfile `ENTRYPOINT` + `startCommand` in `railway.json`).

**Cost bug found at the same time, fix `36d892c`:** the scan drafted a Claude reply for every unreplied review on Google (up to `max_replies_per_run`) *before* checking whether it was already saved, so the same reviews were re-drafted and thrown away every 15 minutes. Now it checks the DB first, and the cap counts only new drafts. Healthy steady state in the logs: `found N, drafted 0`.

**If it breaks again:**
1. `railway logs` in `review-agent/` — look for `[background-sweep] … failed`.
2. Launch error → container/process problem (check the Dockerfile still uses tini; redeploy to get a clean container).
3. Timeout on a locator → Google changed the panel or the session expired: re-login and refresh the stored cookies, or update selectors in `review-agent/src/browser.ts`.
4. Confirm `select max(created_at) from reviews` moves forward.

## 8. Runbook: go live with Stripe

1. Create live products/prices with the same `lookup_key`s (`boh`, `full`).
2. Set live `STRIPE_SECRET_KEY` in Edge Function secrets and on the `stripe-webhook` Railway service.
3. Add the live webhook endpoint in Stripe → set its `STRIPE_WEBHOOK_SECRET` on Railway.
4. Run one real checkout end-to-end and confirm the `subscriptions` row.

## 9. Runbook: enable Square

1. Create a Square Developer app; redirect URL = the `connect-square-callback` function URL.
2. `supabase secrets set SQUARE_APPLICATION_ID=… SQUARE_APPLICATION_SECRET=… SQUARE_API_HOSTNAME=connect.squareup.com` (sandbox: `connect.squareupsandbox.com`).
3. Set the same `SQUARE_APPLICATION_*` on the `sync` Railway service.
4. Connect from Settings → Integrations and watch the next `sync` run.
