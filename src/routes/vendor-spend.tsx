import { createFileRoute } from "@tanstack/react-router";

import { Topbar } from "@/components/dashboard/Topbar";
import { useDateRange } from "@/lib/date-range-context";
import { isoDate } from "@/lib/date-range";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useVendorSpendSummary } from "@/lib/boh/queries";
import { VENDOR_CATEGORY_LABEL, VENDOR_CATEGORY_COLOR } from "@/lib/boh/vendor-categories";

function formatMoney(n: number, opts: { compact?: boolean } = {}) {
  if (opts.compact && n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const Route = createFileRoute("/vendor-spend")({
  head: () => ({
    meta: [
      { title: "Vendor spend · Shrinkline" },
      {
        name: "description",
        content: "Approved spend and invoice counts per vendor.",
      },
    ],
  }),
  component: VendorSpendPage,
});

// Spend breakdown per vendor — distinct from the real Vendors catalog
// page (/vendors, under Stock & Purchasing), which manages contact
// info/pricing terms/categories. This page is invoice-spend context
// only; use /vendors to actually add or edit a vendor.
function VendorSpendPage() {
  const { dateRange: globalDateRange } = useDateRange();
  const dateRange = {
    from: isoDate(globalDateRange.from),
    to: isoDate(globalDateRange.to),
  };
  const { data: vendorSpend = [] } = useVendorSpendSummary(dateRange);

  return (
    <>
      <Topbar eyebrow="Accounts payable" title="Vendor spend" />
      <main className="px-6 py-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vendorSpend.map((v) => (
            <Card key={v.vendorId} className="p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="font-display text-lg">{v.name}</div>
                  {v.contactName && (
                    <div className="truncate text-xs text-muted-foreground">{v.contactName}</div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {v.terms && (
                    <Badge variant="outline" className="text-xs">
                      {v.terms}
                    </Badge>
                  )}
                  <Badge
                    className="text-xs text-white hover:opacity-90"
                    style={{ background: VENDOR_CATEGORY_COLOR[v.category] }}
                  >
                    {VENDOR_CATEGORY_LABEL[v.category]}
                  </Badge>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Approved spend
                  </div>
                  <div className="font-display text-lg">
                    {formatMoney(v.approvedSpendCents / 100, { compact: true })}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Invoices
                  </div>
                  <div className="font-display text-lg">{v.approvedInvoiceCount}</div>
                  {v.pendingInvoiceCount > 0 && (
                    <div className="text-xs text-amber-700">
                      {v.pendingInvoiceCount} pending review
                    </div>
                  )}
                </div>
              </div>

              {(v.email || v.phone) && (
                <>
                  <Separator className="my-4" />
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {v.email && <div>{v.email}</div>}
                    {v.phone && <div>{v.phone}</div>}
                  </div>
                </>
              )}
            </Card>
          ))}
          {vendorSpend.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
              No vendors yet — add one in Inventory &amp; Ordering.
            </p>
          )}
        </div>
      </main>
    </>
  );
}
