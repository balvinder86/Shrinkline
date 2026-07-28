-- ============================================================
-- Real "starting price" for items with no fixed Toast catalog
-- price (well-pour liquor: single/double, rail vs. call, etc.) —
-- price_cents on menu_items is null for these, but real per-sale
-- prices exist in the synced order data. Track the cheapest real
-- unit price ever observed per (location, day, item) so the app
-- can fall back to it instead of showing $0.00.
-- ============================================================

alter table pmix_sales add column if not exists min_unit_price_cents bigint;
