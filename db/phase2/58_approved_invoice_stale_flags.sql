-- unknown_sender/totals_mismatch exist to prompt a human to check the
-- vendor and the numbers before approving — the app now clears them
-- automatically at approve time (src/lib/boh/queries.ts,
-- useApproveInvoice), since approving already implies that check
-- happened. This is one-time cleanup for invoices approved before
-- that change shipped. Not scoped to any one restaurant — applies
-- across every tenant.

update invoices
set flags = array_remove(array_remove(flags, 'unknown_sender'), 'totals_mismatch')
where status = 'approved'
  and flags && array['unknown_sender', 'totals_mismatch'];
