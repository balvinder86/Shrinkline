# Shrinkline — Requirements & Implementation Status

> Living document. This is the current source of truth for "what is this product, what was it supposed to do, and what's actually built." `PROJECT_CONTEXT.md` and `BUILD_PLAN_PHASES_2-4.md` (repo root) are the original Phase 0-4 requirements spec, written before Phase 2 started — keep them for the *original intent and design rationale* per module, but treat their status/roadmap sections as historical. `phase3-billing-onboarding-spec_4.md` (repo root) is the detailed Phase 3 spec, also historical.
>
> **Last verified against `git log`, live code, and the live database: 2026-10-07.** Re-check `git log --oneline -20` before trusting any status here if it's been more than a couple of weeks.
>
> Companion docs in this folder: [ARCHITECTURE.md](ARCHITECTURE.md) (how the system fits together), [DATABASE.md](DATABASE.md) (schema + migration catalog), [OPERATIONS.md](OPERATIONS.md) (deploys, kill switches, cost incidents, runbooks), [CHANGELOG.md](CHANGELOG.md) (dated build history).

---

## 0. Current state at a glance (2026-10-07)

**The product is in cost-saving maintenance mode.** No feature work has shipped since 2026-08-31; the only commits since then are cost/stability fixes. Every Anthropic-spending background feature except invoice OCR classification and on-demand AI buttons is switched off.

| | State |
|---|---|
| Tenants (live DB) | 3 restaurants, 3 locations, 1 Stripe subscription (Thrasher's Pub, test mode), 2 POS credential rows |
| Toast POS sync | ✅ Running every 10 min |
| Invoice ingestion (Gmail → OCR) | ✅ Running — newest invoice row 2026-10-07 |
| Nightly AI recommendations | ⏸ **Paused since 2026-09-08** (`INSIGHTS_DISABLED = true`). Last recommendations generated for business date 2026-09-09. |
| Nightly digest email | ⏸ **Disabled since 2026-08-31** (`DIGEST_DISABLED = true`) |
| AI chat assistant | ⏸ **Disabled since 2026-08-28** (widget commented out + function returns 503) |
| Review scraper / AI replies | 🔴 **Broken since 2026-09-01** — newest review row 2026-08-31. User deferred fix. |
| Square POS | 💤 Code complete, inert — no Square Developer credentials set |
| Billing | ✅ Live in Stripe test mode |

How to turn each paused feature back on: [OPERATIONS.md §3 Kill switches](OPERATIONS.md#3-kill-switches-paused-features).

---

## 1. What this is

Shrinkline (`shrinkline.ai`) is a multi-tenant restaurant operations SaaS. It started as a single-restaurant tool for Thrasher's Pub (a real bar/restaurant the founder owns and operates) and is being generalized into a product sold to other restaurants — the same relationship as Toast (the company) to an individual restaurant running Toast. Thrasher's Pub remains the first live tenant and design partner.

**Business wedge:** back-of-house cost control — invoice processing, inventory/par levels, recipe-based food cost %, and AI-driven recommendations on top of that data. This is the gap the main UI competitor (Owner.com) doesn't cover.

**Naming:** renamed from "thrasherspub" to "Shrinkline" on 2026-08-20. Current repo `balvinder86/Shrinkline`, tenant app `app.shrinkline.ai`, company portal `portal.shrinkline.ai`. Supabase project ref `dgyfcosmgbbtcwrqnevg` is permanent (display name "Shrinkline").

**Related repos:**

| Repo | What it is |
|---|---|
| `balvinder86/Shrinkline` | **This repo.** Tenant app frontend + all Railway services + SQL + Edge Functions. |
| `balvinder86/thrasherscornerpub-572664d9` | **Company portal** (`portal.shrinkline.ai`) — a separate Lovable app (remix of the tenant app, adds `/company`), same Supabase project. Last change 2026-08-26. |
| `balvinder86/thrasherscornerpub`, `…-4ec729e1` | Old Lovable project copies from before the rename. Inactive. |
| `balvinder86/thrashers-review-agent` (local `~/dev/restaurant-review-agent`) | Original standalone Google-review auto-reply agent. Superseded by `review-agent/` in this repo; last change 2026-08-31 (security patch). |
| `balvinder86/Business-Operations-Agent` (local `~/dev/ops-dashboard`) | Pre-Shrinkline Next.js + SQLite ops dashboard prototype. Inactive since 2026-06-22. |

---

## 2. Architecture (non-negotiable design decisions)

Full detail in [ARCHITECTURE.md](ARCHITECTURE.md). The short list:

1. **Shared-database multi-tenancy with Row-Level Security.** Every business table carries `restaurant_id`; RLS via `my_restaurants()`. Every tenant-scoped policy needs both `using` and `with check`.
2. **Multi-brand / multi-location.** A `restaurants` row (= brand) owns many `locations` (the billable unit).
3. **Vendor-neutral POS adapter pattern** — Toast and Square implemented; business logic only sees normalized types.
4. **Raw + normalized storage** for POS data (`pos_raw_events` alongside normalized rows).
5. **Idempotent syncs** — natural keys, upsert in place.
6. **Service-role writes derive `restaurant_id`/`location_id` from the credential row, never from the vendor payload** — RLS does not protect the service-role path.
7. **Real Supabase Auth**, gating the whole app at `__root.tsx`.
8. **Three secret stores, never mixed:** Supabase Vault (per-tenant creds), Railway env vars (service-wide), Edge Function secrets (function-wide). See [ARCHITECTURE.md §6](ARCHITECTURE.md#6-secrets).
9. **SQL files under `db/` are the schema source of truth** — applied with `supabase db query --linked -f <file>`, never improvised by Lovable.
10. **CI isolation guard** (`.github/workflows/db-isolation.yml`) runs tenant-isolation tests on every push — but only applies migrations through `db/phase2/47` (see §10).

---

## 3. Stack & where things live

| Layer | Tech | Notes |
|---|---|---|
| Frontend | TanStack Start + React 19 + Vite + Tailwind + shadcn/ui, built in Lovable | `bun`. Deploys via Lovable GitHub sync + Publish (not Railway). |
| Data tier | Supabase (`dgyfcosmgbbtcwrqnevg`) | Postgres, Auth, Vault, Storage, 27 Edge Functions. |
| Background services | Railway, 6 services | `sync`, `ocr`, `email-ingest`, `insights`, `review-agent`, `stripe-webhook` — see [ARCHITECTURE.md §4](ARCHITECTURE.md#4-background-services-railway). |
| AI | Anthropic Claude | Sonnet 5 (insights, chat), Haiku 4.5 (invoice classification), Sonnet 4.5 (on-demand Edge Function features, review replies, recipe import). Mindee for invoice OCR. |
| Billing | Stripe Billing, test mode | Per-location recurring subscriptions, two tiers. |
| Email | Resend | Auth emails via SMTP on `mail.shrinkline.ai`; digest via HTTP API. Vendor PO emails sent via the tenant's connected Gmail. |
| CI | GitHub Actions | `db-isolation.yml` only. |

Repo layout: see [ARCHITECTURE.md §2](ARCHITECTURE.md#2-repo-layout).

---

## 4. Phase history (original roadmap vs. actual)

- **Phase 0 (tenancy/RLS foundations)** — ✅ complete.
- **Phase 1 (Toast POS + real auth, Sales/Product Mix)** — ✅ complete since 2026-07-03. Extended 2026-08-24 with a Square adapter (not in the original plan).
- **Phase 2 (back-of-house wedge)** — ✅ complete and well past original scope: invoice OCR + email ingestion, inventory/par, recipes, food cost %, inventory counts, storage locations, waste log, purchase orders, price trends, AI insights layer.
- **Phase 3 (Stripe billing/onboarding)** — ✅ done 2026-08-20 (Parts A-F).
- **Phase 4 (upsell: reviews, marketing, loyalty, scheduling)** — **mixed.** Reviews and Marketing/SEO are real (Reviews currently broken, see §10). Loyalty, Scheduling and Segments are 100% mock UI.
- **Post-Phase 3 polish (2026-08-20 → 08-31)** — Settings enhancement (branding, integrations dialogs, tax & compliance, brand/location delete, notifications), storage locations, AI-native rollout (new insights tabs), Square adapter, nightly digest.
- **Cost-control period (2026-08-28 → now)** — chat, digest and nightly insights switched off; three runaway-retry cost incidents fixed (see [OPERATIONS.md §5](OPERATIONS.md#5-cost-incidents-history)). No feature work.

Dated detail: [CHANGELOG.md](CHANGELOG.md).

---

## 5. POS integration

| Vendor | Status | Notes |
|---|---|---|
| **Toast** | ✅ Live (Thrasher's Pub). `sync/` cron every 10 min: orders, product mix, menu items, labor shifts, revenue centers. | Client-credentials auth (Client ID/Secret + restaurant GUID). Self-serve connect from Settings → Integrations via `connect-toast` (verifies against Toast before saving). |
| **Square** | 💤 Built, full parity (orders/sales, menu items, labor shifts) — `f3080a4`, 2026-08-24. **Inert until `SQUARE_APPLICATION_ID`/`SQUARE_APPLICATION_SECRET`/`SQUARE_API_HOSTNAME` are set.** | Self-serve OAuth (`connect-square-start` / `connect-square-callback`). Gaps by design: no revenue centers; all hours stored as regular (no OT split). |
| SkyTab | Not started. | |

---

## 6. Module-by-module status

"Real" = live backend data driving the UI. "Mock" = UI only, hardcoded data. "Placeholder" = UI with an explicit not-built-yet note.

| Module | Route(s) | Status | Notes |
|---|---|---|---|
| **Dashboard** | `/` | ✅ Real | Pulls inventory, invoices, customers, reviews, Search Console. |
| **Sales / Product Mix** | `/product-mix` | ✅ Real | Toast + Square via `pmix_sales`, `menu_items`, price tiers. Menu-engineering view. "Trend note" is real data, not model output. |
| **Invoices** | `/invoices`, `/invoice-line-items`, `/invoice-savings`, `/vendor-spend`, `/log-expense` | ✅ Real | Gmail ingestion + upload → Mindee OCR → Haiku classify → draft → human review → approve. Multi-invoice PDF split, case/bottle pricing, payroll auto-exclusion, per-invoice classify cap (3). |
| **Vendors** | `/vendors` | ✅ Real | Invoicing-sender emails, expense categories, order emails for POs. |
| **Inventory & Ordering** | `/inventory`, `/inventory-count`, `/purchase-orders`, `/waste-log` | ✅ Real | Par levels (`compute_par_levels`), stock, physical counts grouped by storage location, POs emailed via Gmail, waste log, bulk import from photo/doc (AI). |
| **Recipes** | `/recipes` | ✅ Real | Menu item → ingredients bridge, prep recipes, doc import (Word/PDF), AI recipe drafting, quick-match, per-size price tiers. |
| **P&L / Food Cost %** | `/pnl`, `/variance` | ✅ Real | Theoretical (recipes × sales) vs actual (invoice spend). |
| **Inventory Variance** | `/inventory-variance` | ✅ Real | Purchases/waste/theoretical usage reconciliation. |
| **Ingredient Price Trends** | `/ingredient-price-trends` | ✅ Real | $ and % drift from invoice history. |
| **Labor** | `/labor` | ✅ Real data | Toast/Square shifts via `src/lib/labor/queries.ts`. No AI layer. |
| **AI Recommendations panel** | on Invoices, P&L, Inventory, Recipes, Product Mix, Waste Log, Inventory Variance | ⏸ Real, **paused** | Panel shows the last batch (2026-09-09) until re-enabled. See §7. |
| **AI Chat Assistant** | global widget | ⏸ Built, **disabled** | See §0. |
| **Reviews** | `/reviews` | 🔴 Real, **broken** | Claude-drafted replies, review insights, competitor comparison. Scraper failing since 2026-09-01. |
| **Marketing / SEO** | `/marketing`, `/seo` | ✅ Real | SEO suggestions, content briefs, schema check, PageSpeed, Search Console, citations, competitor tracking, customers list. |
| **Loyalty** | `/loyalty` | 🔴 Mock | No schema, no queries. |
| **Scheduling** | `/scheduling` | 🔴 Mock | Hardcoded forecast/roster. |
| **Segments** | `/segments` | 🔴 Mock | No data imports; not in the sidebar nav (orphan route). |
| **Admin** | `/admin` | ✅ Real | Team & access (`manage-team`) + Setup checklist (`get_setup_status`). |
| **Settings** | `/settings` | ✅ Mostly real | See §9. |
| **Brands overview** | — | Removed | `/brands` page was built then removed (`1fbf988`); the sidebar `BrandLocationSwitcher` and Settings "Your brands" card remain. |

---

## 7. AI features

### 7a. Nightly insights pipeline — ⏸ paused

Railway service `insights/`, cron `*/15 * * * *`. One Anthropic **Batch API** request per location per business date (50% cheaper, cost decoupled from usage): submit if none for today, else poll/ingest.

- **Signals (one module each):** `foodCost.ts`, low-par detection, `invoiceDrift.ts` (per-tenant threshold in `ai_insights_settings`), `productMix.ts`, `waste.ts` (30-day trend), `variance.ts` (raw count-to-count delta; model told never to call it proof of shrinkage).
- **Model:** `claude-sonnet-5` with prompt caching, JSON-schema output, `custom_id` = `location_id`.
- **Output:** `ai_recommendation_batches`, `ai_recommendations` (multiple per tab), `ai_recommendation_dismissals`.
- **Digest email** (`digest.ts`) runs on the same tick after ingest, permission-filtered per recipient, logged in `notification_digest_log`. Disabled separately.
- **Paused** by `INSIGHTS_DISABLED = true` in `insights/src/index.ts` (`06a0e08`, 2026-09-08). Turning it back on resumes from the current day; it doesn't backfill missed days.

### 7b. On-demand AI (live, gated by tier)

Edge Functions that call Claude only when a user clicks something: `generate-recipe`, `inventory-bulk-import`, `seo-ai-suggestions`, `content-brief`, `analyze-review-insights`, `analyze-competitor-comparison`. Railway `ocr` also does recipe doc import. Full-tier-only ones are wrapped by server-side `tierGate` (fails closed, 402).

### 7c. Background AI that is still running

- **Invoice classification** (`ocr/src/classify.ts`, Haiku 4.5) — every OCR'd invoice. Bounded by `MAX_CLASSIFY_ATTEMPTS = 3` (`classify_attempts` column, migration 78). This is the source of all three past cost incidents.

---

## 8. Billing & onboarding (Phase 3 — done)

Stripe Billing, two tiers by price `lookup_key`: `boh` (back-of-house) and `full` (adds Reviews/Marketing/Loyalty/Scheduling). `subscriptions` mirrors Stripe (tenant read-only; only the webhook writes).

- **Webhook** (`stripe-webhook/`, Railway): signature-verified; subscription created/updated/deleted + `invoice.payment_failed`.
- **Checkout / change plan:** `create-checkout-session`, `update-subscription-plan`.
- **Quantity sync:** `sync-subscription-quantity` is called on both location **create and delete** (`src/lib/settings/queries.ts`) — the earlier "removal not synced" gap is closed.
- **Tier gating:** client `src/lib/billing/tierGate.ts` + server `supabase/functions/_shared/tierGate.ts` (kept in sync by hand). No subscription row = unrestricted, by design.
- **Company portal** (`portal.shrinkline.ai`, separate repo): `company-portal` Edge Function actions `list_tenants`, `create_tenant`, `get_tenant`, `get_platform_summary`, `update_tenant`, `delete_tenant`, `resend_invite`, `change_tenant_plan`, `cancel_tenant_subscription`. Access via `platform_admins`.
- **Setup checklist:** `/admin` → Setup, from `get_setup_status()` (derived from real data).

---

## 9. Settings — sub-page status

| Sub-page | Status |
|---|---|
| Restaurant profile, Locations, Security | ✅ Real |
| Billing & plan | ✅ Real (payment method / invoice history still placeholder — needs Stripe Customer Portal) |
| Integrations | ✅ Toast, Square, Gmail, Google Search Console real. Others (QuickBooks, Mailchimp, Twilio, …) have "how to connect" info dialogs only. Email-PO vendors work today via `send-purchase-order-email`. |
| Branding | ✅ Real (stored values; no live re-theming) |
| Notifications | ✅ Real preferences; actual digest send disabled (§7a). 4 events, email only. |
| Tax & compliance | ✅ Real — fields + document storage, owner-only RLS, private bucket. |
| API & webhooks | 🔴 Placeholder — no public API exists. |
| Brand / location delete | ✅ Real, self-serve, guarded. |

---

## 10. Known open items (as of 2026-10-07)

**Broken / paused**
1. **Review scraper broken** since 2026-09-01 (Playwright selector timeout on Google's reviews panel). No new reviews since 2026-08-31. Deferred by the user.
2. **Nightly AI insights paused** since 2026-09-08. Recommendation panels show stale data from 2026-09-09; consider hiding them or showing a "paused" note while this is off.
3. **Digest email disabled** since 2026-08-31.
4. **Chat assistant disabled** since 2026-08-28.

**Not yet live**
5. **Square** — waiting on Square Developer app credentials.
6. **Stripe** — still test mode; go-live needs live keys, live prices, live webhook endpoint.
7. **Stripe Customer Portal** not integrated (Settings → Billing placeholder).
8. **API & webhooks** — nothing to build against yet.

**Tech / data debt**
9. **CI isolation guard only applies migrations up to `db/phase2/47`** — 48-78 and `db/phase3/40`, `50` are untested in CI. Every new tenant table since then (inventory counts, waste log, tax docs, notification prefs, storage locations…) isn't covered by the isolation test.
10. **Coors Lt recipe cost** at Thrasher's Pub is wrong ($6336) — skews food cost % and product-mix insights. Not fixed.
11. **Tier gate duplicated** in client and server — must be edited in both places.
12. **Mock modules** (Loyalty, Scheduling, Segments) still ship in the UI; Segments is reachable only by URL.
13. **`docs/` was never committed** before this update.

---

## 11. Operational gotchas

Moved to [OPERATIONS.md §6](OPERATIONS.md#6-gotchas). The big ones: Lovable sync ≠ publish (check `x-deployment-id`); Railway "Deploy failed" on run-once cron services is often fine (check logs); never drop policies on `storage.objects` blindly; never wrap the oklch palette vars in `hsl()`; any retry sweep must have a bounded attempt counter.

---

## 12. Where to go for more detail

- [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), [OPERATIONS.md](OPERATIONS.md), [CHANGELOG.md](CHANGELOG.md) — this folder.
- `PROJECT_CONTEXT.md` — original architecture rationale, Toast API specifics.
- `BUILD_PLAN_PHASES_2-4.md` — original Phase 2-4 spec (formulas, tier-gating design).
- `phase3-billing-onboarding-spec_4.md` — Phase 3 spec.
- `db/` — actual schema history, in order.
