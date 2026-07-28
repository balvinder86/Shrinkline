-- ============================================================
-- Supersedes 15_pmix_price_range.sql's approach. Deriving a
-- "starting price" from historical sales turned out to be
-- contaminated by tax-exclusive-vs-inclusive and other real-world
-- transaction noise unrelated to the actual listed menu price.
--
-- The real fix reads Toast's own current menu configuration
-- instead: items with pricingStrategy "SIZE_PRICE" (well-pour
-- liquor priced by Single/Double via a "Size" modifier group, no
-- fixed base price) get resolved at sync time to the cheapest of
-- their real, currently-configured size prices, written straight
-- into menu_items.price_cents. This flag marks that the price is a
-- resolved starting price (multiple real sizes exist), not a single
-- fixed price, so the UI can label it accordingly.
-- ============================================================

alter table pmix_sales drop column if exists min_unit_price_cents;

alter table menu_items add column if not exists price_is_starting_price boolean not null default false;
