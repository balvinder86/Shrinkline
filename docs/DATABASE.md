# Shrinkline — Database

> Schema reference and migration catalog. The SQL files in `db/` are the source of truth — this doc is the map.
>
> Last verified against `db/`: 2026-10-07 (latest migration: `db/phase2/78_invoice_classify_attempts.sql`).

---

## 1. Conventions

- **Tenant columns:** every business table has `restaurant_id uuid not null references restaurants`; location-scoped tables also have `location_id`.
- **RLS on every table.** Policies use `restaurant_id in (select my_restaurants())` with **both** `using` and `with check`. Owner-only tables (tax docs, branding, billing) check the role too.
- **Writes the client must not make** (e.g. `subscriptions`, `ai_recommendations`, `pos_raw_events`) have select-only policies; only service-role code writes them.
- **Natural keys + upsert** for anything synced (POS orders, menu items, shifts, emails) so re-runs never double-count.
- **Money** is stored in cents (`*_cents` integer) unless the column says otherwise; display code divides by 100.
- **Secrets** never stored in tables — only Vault secret names (see ARCHITECTURE §6).
- **Numbering:** files run in numeric order within each phase folder; phase folders run 0 → 1 → 2 → 3. Note `phase3/30-50` were applied *after* `phase2/47` in real time (numbers overlap with phase2 but live in a separate folder).

## 2. Applying a migration

```bash
supabase db query --linked -f db/phase2/79_my_change.sql
```

Then record it if you track it in `supabase_migrations.schema_migrations` (see OPERATIONS §4). Also **add the file to `.github/workflows/db-isolation.yml`'s Apply step** so CI tests it — this has been skipped since migration 48.

---

## 3. Core tables by domain

| Domain | Tables |
|---|---|
| Tenancy | `restaurants`, `locations`, `memberships`, `platform_admins` |
| POS | `pos_credentials`, `pos_raw_events`, `pmix_sales`, `pmix_sales_by_tier`, `menu_items`, `menu_item_price_tiers`, `pos_revenue_centers`, `labor_shifts` |
| Back-of-house | `vendors`, `ingredients`, `ingredient_stock`, `ingredient_cost_history`, `par_levels`, `recipe_lines`, `prep_recipes`, `prep_recipe_lines`, `recipe_imports`, `vendor_product_pack_info` |
| Invoices | `invoices`, `invoice_lines`, `invoice_page_jobs`, `email_ingestion_credentials`, `processed_email_messages`, `email_ingestion_events` |
| Ordering & counts | `purchase_orders`, `purchase_order_lines`, `inventory_counts`, `inventory_count_lines`, `storage_locations`, `waste_log` |
| AI insights | `ai_recommendation_batches`, `ai_recommendations`, `ai_recommendation_dismissals`, `ai_insights_settings` |
| Reviews / marketing / SEO | `reviews`, `review_agent_credentials`, `review_agent_settings`, `customers`, `search_console_credentials`, `citation_checks`, `competitor_tracked_queries`, `competitor_scans`, `competitor_review_comparisons` |
| Settings | `restaurant_branding`, `restaurant_tax_settings`, `tax_documents`, `notification_preferences`, `notification_digest_log` |
| Billing | `subscriptions`, `onboarding_progress` |

## 4. Key functions (RPCs)

| Function | Purpose |
|---|---|
| `my_restaurants()` | Restaurant IDs the current user belongs to — basis of all RLS. |
| `get_pos_secret()` / `set_pos_secret()` | Vault read/write for per-tenant credentials (service role only). |
| `match_ingredient()` | Fuzzy match an invoice line to an ingredient. |
| `compute_par_levels()` | Par levels from usage history; unit-aware since 60/61. |
| `convert_to_ingredient_unit()` | Unit conversion helper for recipe/count costing. |
| `get_user_id_by_email()` | Team invites (security definer, restricted). |
| `create_restaurant()` | Self-serve brand creation: brand + owner membership + first location + default storage locations. |
| `get_setup_status()` | Setup checklist status derived from real data. |

---

## 5. Migration catalog

### Phase 0 — tenancy
| File | Adds |
|---|---|
| 00_ci_shim | Fake `auth` schema for CI Postgres |
| 01_schema | `restaurants`, `locations`, `memberships`, `my_restaurants()` |
| 02_seed / 03_isolation_tests / ci_rls_guard | CI seed tenants, cross-tenant assertions, "every table has RLS" guard |

### Phase 1 — POS
| File | Adds |
|---|---|
| 10_pos_schema | `pos_credentials`, `pos_raw_events`, `pmix_sales`, `menu_items` |
| 11_vault_read_secret | `get_pos_secret()` |
| 12_menu_item_cost | Cost columns on menu items |
| 13_pos_revenue_centers | `pos_revenue_centers` |
| 14_labor_schema | `labor_shifts` |
| 15_labor_shifts_generic_pos_ref | Vendor-neutral POS ref on shifts (for Square) |
| 15_pmix_price_range | Price range on product mix |
| 16_menu_item_starting_price | Starting price for items with no catalog price |

### Phase 2 — back-of-house and everything after
| File | Adds |
|---|---|
| 20_boh_schema | `vendors`, `ingredients`, `recipe_lines`, `invoices`, `invoice_lines`, `par_levels`, `ingredient_cost_history` |
| 21_vendor_fields | Vendor contact/ordering fields |
| 22_ingredient_category | Ingredient categories |
| 23_ingredient_stock | `ingredient_stock` (on-hand) |
| 24_invoice_ocr_support | `match_ingredient()` |
| 25_invoice_ocr_job | OCR job tracking columns |
| 26_par_level_computation | `compute_par_levels()` |
| 27_email_ingestion | `email_ingestion_credentials`, `processed_email_messages` |
| 28_invoice_discount | Invoice discounts (Savings) |
| 29_purchase_orders | `purchase_orders`, `purchase_order_lines` |
| 30_purchase_order_email | PO email sending fields |
| 31_review_agent | `review_agent_credentials`, `review_agent_settings`, `reviews` |
| 32_review_written_date | Real review post date |
| 33_review_auto_send | Opt-in 5-star auto-send |
| 34_seo_integrations | `search_console_credentials` |
| 35_vault_write_secret | `set_pos_secret()` |
| 36_citations | `citation_checks` |
| 37_competitor_tracking | `competitor_tracked_queries`, `competitor_scans` |
| 38_review_panel_health | Google panel self-contradiction detection |
| 39_customers | `customers` |
| 40_competitor_comparison | `competitor_review_comparisons` |
| 41_get_user_id_by_email | `get_user_id_by_email()` |
| 42_membership_permissions | Granular per-feature permissions |
| 43_vendor_invoicing_senders | Vendor sender emails for auto-match |
| 44_invoice_agent_rules | `email_ingestion_events` (gate/classify audit) |
| 45_vendor_expense_category | Operating-expense categories |
| 46_vendor_category_events | "Events" category |
| 47_prep_recipes | `prep_recipes`, `prep_recipe_lines` |
| — *CI coverage ends here* — | |
| 48_case_bottle_resolution | `vendor_product_pack_info` |
| 49_pack_info_price_drift | Stale-resolution detection |
| 50_multi_invoice_pdf_split | `invoice_page_jobs` |
| 51_page_job_result_cache | Cache Mindee results per page |
| 52_menu_item_category_override | Manual category override |
| 53_recipe_doc_import | `recipe_imports` |
| 54_ai_recommendations | `ai_recommendation_batches`, `ai_recommendations` |
| 55_ai_recommendations_multi_per_tab | Multiple recs per tab per day |
| 56_ai_insights_settings | `ai_insights_settings` (drift threshold) |
| 57_case_pricing_vendor_category_fix | Case pricing limited to F&B vendors |
| 58_approved_invoice_stale_flags | Clear flags on approve |
| 59_ai_recommendation_dismissals | `ai_recommendation_dismissals` |
| 60/61_ingredient_container_size/weight | Volume + weight container sizes; unit-aware par |
| 62_alcohol_container_sizes_backfill | Data backfill (Thrasher's Pub only) |
| 63_menu_item_price_tiers | `menu_item_price_tiers`, `pmix_sales_by_tier` |
| 64_waste_log | `waste_log` |
| 65/66_inventory_counts(+_lines_unit) | `inventory_counts`, `inventory_count_lines` |
| 67_menu_item_hidden_from_recipes | Hide flag |
| 68_restaurant_owner_update | Owners can edit restaurant row |
| 69_restaurant_profile_fields | Logo, legal name, cuisine, etc. |
| 70_create_restaurant | `create_restaurant()` |
| 71_restaurant_branding | `restaurant_branding` |
| 72_tax_compliance | `restaurant_tax_settings`, `tax_documents` + private bucket |
| 73 / 75 tenant_closure_requests | Added then dropped (replaced by real delete) |
| 74_storage_locations | `storage_locations`; `create_restaurant()` seeds defaults |
| 76_ai_recommendations_new_tabs | product_mix / waste / variance tabs |
| 77_notification_preferences | `notification_preferences`, `notification_digest_log` |
| 78_invoice_classify_attempts | `invoices.classify_attempts` (retry cap) |

### Phase 3 — billing
| File | Adds |
|---|---|
| 30_billing_schema | `subscriptions`, `onboarding_progress` *(in CI)* |
| 40_platform_admins | `platform_admins` |
| 50_setup_status | `get_setup_status()` |

---

## 6. Storage buckets

Invoice source files, recipe import docs, inventory import photos, restaurant logos, and `tax-documents` (private, owner-only). All bucket policies live in the single shared `storage.objects` table — check existing policy names before adding or dropping one.
