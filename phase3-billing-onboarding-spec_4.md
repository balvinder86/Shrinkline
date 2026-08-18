# Phase 3 — Billing & Onboarding — Cursor Build Spec

Extends PROJECT_CONTEXT.md and BUILD_PLAN_PHASES_2-4.md. This is the phase that turns the product into a business: after it, you can charge money and onboard a client without hand-holding. All new tables follow the existing `tenant_isolation` RLS pattern (both `using` and `with check`), carry `restaurant_id`, live in `db/phase3/`, and get an Apply step in `.github/workflows/db-isolation.yml` so the CI RLS guard covers them. Secrets in Supabase Vault, referenced by name. Money in integer cents.

**Modules lit up:** Admin (onboarding, memberships, billing management), Settings/Billing.

## The one rule that governs billing

**Stripe is the source of truth; your DB only MIRRORS it.** Never decide "is this subscription active" by calling Stripe on page load or by trusting the client. Read `subscriptions.status` from the mirror table, which is updated ONLY by verified Stripe webhooks. This keeps the app fast and correct and prevents a client from spoofing access.

Billing unit = **per location**. A restaurant with 3 locations = subscription quantity 3. Stripe prorates add/remove automatically.

---

## PART A — Stripe account setup (do first; no account exists yet)

1. Create a Stripe account. You can build ENTIRELY in **test mode** first — no business verification needed until you accept live payments. Do all of Phase 3 in test mode.
2. Get test-mode API keys: publishable key (client) + secret key (server). **Secret key → Vault**, never in code/repo.
3. Create Products & Prices in the Stripe dashboard:
   - One recurring **per-location** price (monthly). Quantity = number of locations.
   - Two tiers via `lookup_key` on prices: `boh` (back-of-house only) and `full` (adds Phase 4 modules).
4. Create a **webhook endpoint** pointing at your Railway receiver (Part C). Copy the **webhook signing secret** → Vault.
5. Note the price IDs / lookup keys — the app references these when creating subscriptions.

---

## PART B — Data model (`db/phase3/30_billing_schema.sql`)

```sql
-- One Stripe Customer per restaurant
alter table restaurants add column if not exists stripe_customer_id text;

-- Mirror of Stripe subscription state, keyed by restaurant
create table if not exists subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  restaurant_id          uuid not null references restaurants(id) on delete cascade,
  stripe_subscription_id text unique,
  status                 text not null,   -- 'trialing','active','past_due','canceled','incomplete', etc. (mirror Stripe values verbatim)
  plan_tier              text not null check (plan_tier in ('boh','full')),
  quantity               int not null default 1,      -- number of locations billed
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now(),
  unique (restaurant_id)
);
-- + enable RLS + tenant_isolation policy

-- Tracks progress through the onboarding wizard (resumable)
create table if not exists onboarding_progress (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  step           text not null,   -- 'restaurant','owner','pos','menu','recipes','par','billing'
  status         text not null default 'pending' check (status in ('pending','done','skipped')),
  completed_at   timestamptz,
  unique (restaurant_id, step)
);
-- + enable RLS + tenant_isolation policy
```

Store Stripe values (`status`) verbatim so you never have to translate and risk drift.

---

## PART C — Stripe webhook receiver (Railway)

An HTTP endpoint on Railway (not the frontend). Steps in order:

1. **Verify the signature FIRST.** Use the webhook signing secret from Vault to verify Stripe's signature header before reading the body. Reject unverified requests with 400. This is the single security-critical line — without it, anyone who finds the URL can forge a "subscription active" event. Do not parse or act on an unverified payload.
2. Handle these event types (ignore others):
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed` (→ mark `past_due`)
3. For each: upsert the `subscriptions` row keyed by `restaurant_id`. Get `restaurant_id` from the subscription's `metadata.restaurant_id` — which you MUST set when creating the subscription (Part D). Update `status`, `plan_tier` (from the price `lookup_key`), `quantity`, `current_period_end`.
4. Runs as **service role** (bypasses RLS) — so set `restaurant_id` explicitly and correctly. Add a unit test asserting the upserted row's `restaurant_id` matches the subscription metadata.
5. Return 200 quickly; do heavy work async if needed (Stripe retries on non-200).

Idempotency: Stripe may deliver an event more than once. Upsert (not insert) on `restaurant_id`, and optionally track processed Stripe event IDs to no-op duplicates.

---

## PART D — Subscription creation flow

When a restaurant subscribes (last onboarding step):

1. Create (or reuse) a Stripe **Customer**; save `restaurants.stripe_customer_id`.
2. Create a **Subscription** for that customer:
   - price = the tier's price ID (`boh` or `full`)
   - quantity = number of the restaurant's locations
   - **`metadata.restaurant_id` = the restaurant's UUID** (critical — the webhook keys off this)
3. Payment method: collect via Stripe Checkout or a Payment Element (client-side; PCI stays with Stripe). Never handle raw card data yourself.
4. The resulting `customer.subscription.created` webhook (Part C) writes the mirror row. Do NOT write `subscriptions` directly from this flow — let the webhook be the single writer, so Stripe stays the source of truth.

When locations are added/removed later: update the Stripe subscription **quantity**; the webhook mirrors the change. Don't edit `subscriptions.quantity` directly.

---

## PART E — Tier gating (one place only)

A single authorization helper, used everywhere — not scattered per module.

```
canAccess(restaurant_id, module) =>
  read subscriptions.status + plan_tier (from mirror)
  if status not in ('trialing','active') -> locked (read-only or upsell screen)
  else module allowed if module in TIER_MODULES[plan_tier]
```

Tier → module map:
- `boh`  → Sales, Product Mix, Invoices, Inventory/Par, Food Cost %
- `full` → all of `boh` + Reviews, Marketing/SEO, Loyalty, Scheduling
- `past_due` / `canceled` → locked or read-only per your policy (recommend: read-only + prompt to update payment)

Enforce on the SERVER (RLS-scoped queries + a gate check), not just by hiding UI — hidden UI isn't security. The gate reads only the mirror table; never calls Stripe inline.

---

## PART F — Self-serve onboarding wizard (the Admin module core)

A guided, RESUMABLE flow. Each step writes to `onboarding_progress` so the user can leave and return. Steps:

1. **Restaurant + first location** — create `restaurants` + `locations` (service-role, since `restaurants` has no user INSERT policy). This is also where a new tenant is born.
2. **Invite owner** — create a `memberships` row (role `owner`); send invite via Supabase Auth.
3. **Connect POS** — OAuth/credential entry; store creds in Vault; insert `pos_credentials` (reuses Phase 1 plumbing). Kick off a first menu sync.
4. **Import menu** — pull `menu_items` from the POS.
5. **Map recipes** — the recipe bridge (can be deferred/skipped, but prompt; AI generation from `ai-recipe-generation-spec.md` makes this fast).
6. **Set par levels** — optional at onboarding.
7. **Connect billing** — Stripe Customer + subscription (Part D), quantity = # locations.

Rules:
- Each step is idempotent and resumable; store progress per step.
- Steps 5–6 may be `skipped` and completed later without blocking go-live.
- Completing step 7 (billing) with an `active`/`trialing` status flips the tenant to live.
- Everything is tenant-scoped; a new restaurant is created service-side, then the owner's membership grants them RLS access to their own data.

---

## Build order

1. Stripe account + test-mode products/prices/webhook endpoint (Part A).
2. Schema `30_billing_schema.sql` + RLS + CI Apply step (Part B).
3. Webhook receiver on Railway with signature verification (Part C).
4. Subscription creation flow with `metadata.restaurant_id` (Part D).
5. Tier-gating helper wired into the server auth layer (Part E).
6. Onboarding wizard UI in the Admin module (Part F).

**Gate:** Phase 3 is done when you can onboard a fresh restaurant end-to-end — including a Stripe subscription in test mode — with NO manual DB edits, and module access correctly reflects the tier.

## Guardrails

- Stripe is the source of truth; the webhook is the ONLY writer of `subscriptions`. The app reads the mirror, never Stripe inline.
- Verify webhook signatures before trusting any payload.
- Set `metadata.restaurant_id` on every subscription; the webhook depends on it.
- Service-role writers (webhook) set `restaurant_id` explicitly; unit-test it.
- Tier gate enforced server-side; hidden UI is not security.
- All secrets (Stripe secret key, webhook signing secret) in Vault, by name.
- Never handle raw card data — Stripe Checkout/Elements only.
- Every new table: restaurant_id + tenant_isolation + CI-guarded.
