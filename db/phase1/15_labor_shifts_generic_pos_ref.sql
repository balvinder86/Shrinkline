-- labor_shifts.toast_time_entry_ref was Toast-specific naming on a
-- table meant to be provider-agnostic — its siblings (pmix_sales,
-- menu_items, pos_revenue_centers) already use generic naming. Ahead
-- of adding Square as a second POS provider (which also writes labor
-- shifts), rename to match. Values are untouched; Toast's own sync
-- behavior is unaffected — same idempotency key, new column name.
alter table labor_shifts rename column toast_time_entry_ref to pos_time_entry_ref;
alter table labor_shifts rename constraint labor_shifts_location_id_toast_time_entry_ref_key
  to labor_shifts_location_id_pos_time_entry_ref_key;
