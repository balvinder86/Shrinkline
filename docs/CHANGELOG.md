# Shrinkline — Build History

> Dated summary of what was built, from `git log` on `main` (Lovable bot sync commits omitted). Newest first. For current status see [PROJECT_STATUS.md](PROJECT_STATUS.md).

## 2026-09 → 2026-10 — Cost control (no feature work)
- **10-07** Review scraper fixed: run under `tini` so Chromium can launch again — `3b913d0`; skip already-saved reviews before drafting with Claude — `36d892c`
- **10-07** Project docs added — `9d2ab47`
- **09-25** email-ingest keeps its dedup record when the linked invoice was deleted (stops a 15-min re-ingest loop) — `92109da`
- **09-08** Cap Haiku classify attempts per invoice at 3 (`classify_attempts`) — `da2907b`
- **09-08** Pause nightly AI insights batch submission — `06a0e08`

## 2026-08-24 → 08-31 — Square, notifications, portal actions, first cost cuts
- **08-31** Disable nightly digest emails for all tenants — `f190eff`
- **08-30** Fix infinite-retry cost bug on unparseable PDFs — `169ebef`
- **08-28** Disable chat assistant (cost) — `fbffb4f`
- **08-27** Insights: raise batch max_tokens, harden ingest
- **08-26** Chat + insights moved Opus 5 → Sonnet 5; prompt caching on chat
- **08-26** Notifications settings + nightly digest email
- **08-26** Auth SMTP moved to verified `mail.shrinkline.ai`
- **08-25** Company portal: `resend_invite`, `update_tenant`, `delete_tenant`, paginated/searchable `list_tenants`, `change_tenant_plan`, `cancel_tenant_subscription`
- **08-24** **Square POS integration**, full parity with Toast — `f3080a4`
- **08-24** Fix set-password hanging on used/expired links

## 2026-08-20 → 08-23 — Rename to Shrinkline, Settings, storage locations, AI-native rollout
- **08-22** Insights pipeline gains product_mix, waste, variance tabs — `738dee9`
- **08-22** Price Trends shows $ delta + AI recs; real brand delete; "Yesterday" date preset; new login/set-password design; last-counted date
- **08-22** Inventory Count: storage locations + bulk assign
- **08-21** Location delete; Invoices sub-pages (Line items, Savings, Vendor spend, Log expense); portal `get_tenant` / `get_platform_summary` / tax status
- **08-20** Tax & compliance, Branding, Integrations info dialogs made real
- **08-20** Phase 3 Part F (2): tenant Setup checklist; `/brands` page removed
- **08-20** **Renamed to Shrinkline**; Auth pointed at `app.shrinkline.ai`

## 2026-08-15 → 08-19 — Phase 3 billing, multi-location, chat
- **08-19** Company portal (Part F1); server + client tier gating (Part E); Change plan flow
- **08-18** Stripe subscription creation + quantity sync (Part D)
- **08-17** Billing schema + Stripe webhook (Parts B+C)
- **08-17** Real locations, location switcher, brand switcher, self-serve brand creation, location-scoped invoices/POs/counts
- **08-17** Settings rebuilt: Restaurant profile, Locations, Security
- **08-17** Live-data **chat assistant** (streaming, tools, page links)
- **08-17** Hide menu items from Recipes
- **08-16** Cost Variance, Inventory Variance, Ingredient Price Trends; Purchase Orders page
- **08-15** Inventory Count, Waste Log, Vendors page; classify before Mindee

## 2026-08-01 → 08-14 — AI insights, onboarding, invoice accuracy
- **08-14** Payroll docs excluded from invoices; per-size price tiers
- **08-12/13** Real measure units in recipes; volume + weight container sizes
- **08-10** Case/bottle resolution scoped to F&B; Price Alerts panel; dismissable alerts
- **08-06** Manual expense entry; view-original-file on invoice review
- **08-04** **Self-serve Toast connect + Gmail OAuth** (multi-tenant onboarding); per-tenant price-drift threshold; oklch color fix
- **08-03** Invoice price-drift detection; AI panel on Food Cost/Inventory/Invoices/Recipes
- **08-02** **Insights service** — scheduled Batch API recommendations
- **08-01** Bulk recipe import from Word/PDF

## 2026-07-20 → 07-31 — Recipes, P&L, labor, Admin
- **07-31** Prep recipe editing; multi-invoice PDF split
- **07-29** Case-vs-bottle pricing resolution
- **07-28** **Recipes page** with prep recipes; AI recipe generation; Railway IaC for services
- **07-27** **P&L page**; Reviews/SEO on global calendar
- **07-26** Restaurant switcher
- **07-25** **Labor Cost page** (Toast time entries); operating-expense categories
- **07-24** Invoice email-ingestion agent rules; camera capture; English/Spanish; mobile fixes
- **07-23** Global date-range picker and search; Product Mix tabs made real; fake UI removed from Home
- **07-21/22** **Admin tab** (team, granular permissions); Home KPIs made real

## 2026-07-09 → 07-14 — Reviews & SEO made real
- **07-14** Competitor review comparison + organic ranking
- **07-13** Customer database; SEO keyword drawer
- **07-12** Bulk inventory import from photo
- **07-09/10** **SEO page**: Search Console, PageSpeed, schema, content briefs, GBP insights, citations, competitor tracking, backlinks
- **07-09** **Review agent ported in**: Claude replies, insights, auto-send; PO emails via Gmail

## 2026-07-02 → 07-08 — Phase 1 & Phase 2 core
- **07-08** OCR stuck-job recheck
- **07-07** Real-time Product Mix; vendor PO emails
- **07-05/06** **Gmail invoice ingestion**; real Invoices dashboard; real purchase orders
- **07-04** Invoice OCR → Railway; review UI; par levels; food cost % (Phase 2 steps 4-6)
- **07-03** Phase 2 schema, vendors, ingredients, recipe bridge; real Supabase Auth; Toast sync (Phase 1 complete)
- **07-02** Toast connection diagnostic + Vault read RPC
