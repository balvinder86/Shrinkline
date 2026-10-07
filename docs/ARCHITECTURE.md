# Shrinkline — Architecture

> How the pieces fit together. For *what's built and its status*, see [PROJECT_STATUS.md](PROJECT_STATUS.md). For the schema, see [DATABASE.md](DATABASE.md). For deploys/runbooks, see [OPERATIONS.md](OPERATIONS.md).
>
> Last verified against code: 2026-10-07.

---

## 1. System overview

```
                    ┌───────────────────────────┐        ┌───────────────────────────┐
  Restaurant staff ─▶  Tenant app (Lovable)      │        │  Company portal (Lovable) │◀─ Shrinkline staff
                    │  app.shrinkline.ai         │        │  portal.shrinkline.ai     │   (platform_admins)
                    │  TanStack Start / React 19 │        │  separate repo            │
                    └────────────┬──────────────┘        └────────────┬──────────────┘
                                 │ supabase-js (anon key + user JWT; RLS-scoped)
                                 ▼                                     ▼
          ┌──────────────────────────────────────────────────────────────────────────┐
          │ Supabase  (project dgyfcosmgbbtcwrqnevg)                                  │
          │  • Postgres + RLS (my_restaurants())   • Auth (Resend SMTP)               │
          │  • Vault (per-tenant secrets)          • Storage (invoices, tax docs, …)  │
          │  • 27 Edge Functions (Deno) — OAuth, billing, on-demand AI, proxies       │
          └───────▲─────────────────▲──────────────────▲───────────────────▲─────────┘
                  │ service role    │                  │                   │
   ┌──────────────┴──┐ ┌────────────┴───┐ ┌────────────┴────┐ ┌────────────┴────────┐
   │ sync (cron 10m) │ │ email-ingest   │ │ ocr (HTTP)      │ │ insights (cron 15m) │
   │ Toast / Square  │ │ (cron 15m)     │─▶ Mindee + Haiku  │ │ Batch API + digest  │
   └─────────────────┘ │ Gmail API      │ └─────────────────┘ │ ⏸ paused            │
                       └────────────────┘                     └─────────────────────┘
   ┌─────────────────────┐ ┌─────────────────────┐
   │ review-agent (HTTP) │ │ stripe-webhook (HTTP)│◀── Stripe
   │ Playwright + Claude │ │ mirrors subscriptions│
   └─────────────────────┘ └─────────────────────┘
```

External services: Toast API, Square API, Gmail API, Google Search Console, Google PageSpeed, Google Business Profile, Mindee, Anthropic, Stripe, Resend.

---

## 2. Repo layout

```
src/
  routes/            # one file per page (TanStack file routes) — see PROJECT_STATUS §6
  components/
    AppSidebar.tsx, BrandLocationSwitcher.tsx
    chat/            # ChatWidget (currently commented out in __root.tsx)
    dashboard/       # Topbar, shared page chrome
    insights/        # AI recommendations panel
    ui/              # shadcn/ui primitives
  lib/
    supabase/        # client.ts, auth-context.tsx, scope.ts
    restaurant-context.tsx, location-context.tsx   # selected brand / location
    date-range-context.tsx                          # global date filter
    permissions.ts, nav-items.ts, units.ts, timezones.ts
    <domain>/queries.ts   # React Query hooks per domain:
                          # admin billing boh chat insights integrations labor
                          # marketing notifications pos restaurants reviews seo settings setup
    billing/tierGate.ts   # client-side tier gate (mirror of server one)
    boh/                  # recipeCost, menuEngineering, beverageMatch, categories, units
    i18n/                 # English/Spanish app chrome
db/
  phase0/  phase1/  phase2/  phase3/   # ordered SQL migrations — see DATABASE.md
supabase/functions/
  _shared/           # tierGate, oauth-state, pagination, recipeCost, units, page-meta
  <27 functions>     # see §5
sync/ ocr/ email-ingest/ insights/ review-agent/ stripe-webhook/   # Railway services, §4
seo/                 # SEO helper scripts
.github/workflows/db-isolation.yml
```

---

## 3. Multi-tenancy model

- **Hierarchy:** `restaurants` (brand, tenant root) → `locations` (billable unit) → everything else carries `restaurant_id` and usually `location_id`.
- **Membership:** `memberships(user_id, restaurant_id, role, permissions)`. Roles: `owner` / `manager` / `staff`, plus granular per-feature permissions (migration 42) checked by `src/lib/permissions.ts`.
- **RLS:** every tenant table has policies `using (restaurant_id in (select my_restaurants()))` **and** a matching `with check`. Client code never filters by `restaurant_id` manually for security — only for UX scoping.
- **UI scoping:** `RestaurantProvider` picks the active brand; `LocationProvider` picks location(s); hooks call `useLocationIds()`.
- **Service-role writers** (Railway, some Edge Functions) bypass RLS. Rule: tenant IDs come from the credential/job row being processed, never from external payloads.
- **Platform admins:** `platform_admins` table gates the company portal; the `company-portal` function checks it before using the service role.
- **Self-serve creation:** `create_restaurant()` (security definer) atomically creates brand + owner membership + first location + default storage locations.

---

## 4. Background services (Railway)

Each lives in its own folder with a `railway.json`, deployed by Railway GitHub auto-deploy from `main`.

| Service | Type | Schedule | What it does | Key env |
|---|---|---|---|---|
| `sync` | cron, run-once | `*/10 * * * *` | For every `pos_credentials` row: pull orders, menu items, labor, revenue centers via `toast.ts` / `square.ts`; store raw in `pos_raw_events` and upsert normalized rows. | `SUPABASE_*`, `SQUARE_APPLICATION_*` |
| `email-ingest` | cron, run-once | `*/15 * * * *` | For every Gmail connection: list labelled messages, apply sender/attachment gates, dedupe via `processed_email_messages`, upload attachments, hand off to `ocr`. | `GMAIL_CLIENT_*`, `OCR_SERVICE_URL/TOKEN` |
| `ocr` | HTTP server | always on + internal recheck sweep | Classify document (Haiku) → Mindee OCR → split multi-invoice PDFs (`invoice_page_jobs`) → match ingredients, resolve case/bottle pricing → draft invoice. Also recipe doc import. Attempts capped by `classify_attempts`. | `MINDEE_*`, `ANTHROPIC_API_KEY`, `OCR_SERVICE_TOKEN` |
| `insights` | cron, run-once | `*/15 * * * *` | Per location per business date: build signals, submit one Batch API request, then poll/ingest into `ai_recommendations`; then send digest. **Both halves currently disabled.** | `ANTHROPIC_API_KEY`, `RESEND_API_KEY` |
| `review-agent` | HTTP server | called by Edge Function | Playwright scrape of Google reviews panel (logged-in cookies), Claude-drafted replies, competitor scans, backlinks, GBP insights. **Scraper broken since 2026-09-01.** | `ANTHROPIC_API_KEY`, `REVIEW_AGENT_SERVICE_TOKEN` |
| `stripe-webhook` | HTTP server | Stripe pushes | Verify signature, upsert `subscriptions`. | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |

All services use `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

**Proxy pattern:** `invoice-ocr`, `recipe-doc-import` and `review-agent` Edge Functions are thin authenticated proxies — they verify the user's JWT/membership, then forward to the Railway service with a shared service token. Heavy/long-running work never runs in Deno.

---

## 5. Edge Functions

| Group | Functions |
|---|---|
| POS / integrations OAuth | `connect-toast`, `connect-square-start`, `connect-square-callback`, `connect-gmail-start`, `connect-gmail-callback`, `search-console-oauth-start`, `search-console-oauth-callback` |
| Billing | `create-checkout-session`, `update-subscription-plan`, `sync-subscription-quantity` |
| Tenant admin | `manage-team`, `delete-restaurant`, `company-portal` |
| Proxies to Railway | `invoice-ocr`, `recipe-doc-import`, `review-agent` |
| On-demand AI (Claude) | `generate-recipe`, `inventory-bulk-import`, `seo-ai-suggestions`, `content-brief`, `analyze-review-insights`, `analyze-competitor-comparison`, `chat` (⏸ 503) |
| SEO (non-AI) | `search-console-data`, `pagespeed-audit`, `schema-check` |
| Email | `send-purchase-order-email` (via the tenant's Gmail) |

OAuth flows sign their `state` with `_shared/oauth-state.ts` (`OAUTH_STATE_SECRET`) and redirect back to `APP_BASE_URL`.

---

## 6. Secrets

| Store | Used for | How to set |
|---|---|---|
| **Supabase Vault** | Per-tenant credentials: Toast/Square client secrets & tokens, Gmail refresh tokens, Search Console tokens. The DB row holds only the secret's *name*. | `set_pos_secret()` / `get_pos_secret()` RPCs (service role) |
| **Railway env vars** | Service-wide keys for each Railway service (§4 table). | Railway dashboard / CLI per service |
| **Edge Function secrets** | `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `GOOGLE_WEB_CLIENT_ID/SECRET`, `GMAIL_CLIENT_ID/SECRET`, `OAUTH_STATE_SECRET`, `APP_BASE_URL`, `PAGESPEED_API_KEY`, `SQUARE_*`, `OCR_SERVICE_URL/TOKEN`, `REVIEW_AGENT_SERVICE_URL/TOKEN` | `supabase secrets set` |

Never put a per-tenant credential in an env var, and never put an app-wide key in Vault.

---

## 7. Key data flows

**Invoice:** Gmail label → `email-ingest` → Storage + `invoices(ocr_status='processing')` → `ocr` classify (skip payroll/non-invoice) → Mindee → page split → `invoice_lines` + ingredient match + case/bottle resolution → `ocr_status='ready'`, `status='pending_review'` → human approves in `/invoices` → updates `ingredient_cost_history`, `ingredient_stock`, vendor spend.

**Food cost:** `pmix_sales` (POS) × `recipe_lines` / `prep_recipe_lines` × latest ingredient unit cost = theoretical cost; compared with approved invoice spend in `/pnl` and `/variance`.

**Par levels:** `compute_par_levels()` from usage history and container sizes → `par_levels` → reorder suggestions → `purchase_orders` → emailed to vendor.

**Billing:** Settings → `create-checkout-session` → Stripe Checkout → webhook → `subscriptions` → `tierGate` (client + server) reads tier.

**Tenant onboarding:** company portal `create_tenant` (or self-serve `create_restaurant`) → invite email → owner sets password → Setup checklist walks through Toast/Square → menu → recipes → par → billing.

---

## 8. Frontend conventions

- `bun` only; Lovable owns the build. Push to `main` → Lovable syncs → **Publish** in Lovable to go live.
- Data access only through hooks in `src/lib/<domain>/queries.ts` (React Query); pages don't call `supabase.from` directly.
- Colors are `oklch()` CSS vars — use Tailwind tokens (`text-ink`, `bg-terracotta`) or bare `var(--x)`; never `hsl(var(--x))`.
- Mobile-first checks at 390px width; tables scroll inside their own container.
- Honest UI rule: no fake "AI" text or mock numbers on real pages — either real data, or an explicit placeholder.
