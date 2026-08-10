-- Case/bottle resolution (see 48_case_bottle_resolution.sql) only makes
-- sense for a food/beverage distributor's case-packed goods. The OCR
-- pipeline (ocr/src/server.ts) previously ran that logic for every
-- vendor regardless of category, so maintenance (Cintas), utilities,
-- events, and SaaS/POS (Toast) invoices were wrongly getting flagged
-- "Case or bottle? — resolve below". The pipeline now gates on
-- vendors.category = 'food_beverage' before ever setting these; this
-- is one-time cleanup for rows written before that fix shipped.
--
-- Deliberately scoped to invoices with a KNOWN, resolved vendor whose
-- category isn't food_beverage — an invoice with no vendor matched yet
-- is left untouched since we can't tell whether it's food/beverage
-- until it's attributed.

update invoice_lines il
set case_pricing_status = null
from invoices i
join vendors v on v.id = i.vendor_id
where il.invoice_id = i.id
  and v.category <> 'food_beverage'
  and il.case_pricing_status is not null;

update invoices i
set flags = array_remove(array_remove(i.flags, 'case_pricing_needs_review'), 'case_pricing_adjusted')
from vendors v
where i.vendor_id = v.id
  and v.category <> 'food_beverage'
  and (i.flags && array['case_pricing_needs_review', 'case_pricing_adjusted']);
