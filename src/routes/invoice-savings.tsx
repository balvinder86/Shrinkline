import { createFileRoute } from "@tanstack/react-router";

import { Topbar } from "@/components/dashboard/Topbar";
import { useDateRange } from "@/lib/date-range-context";
import { isoDate } from "@/lib/date-range";
import { Card } from "@/components/ui/card";
import { type DateRange, useSavingsSummary } from "@/lib/boh/queries";

function formatMoney(n: number, opts: { compact?: boolean } = {}) {
  if (opts.compact && n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const Route = createFileRoute("/invoice-savings")({
  head: () => ({
    meta: [
      { title: "Savings · Shrinkline" },
      {
        name: "description",
        content: "Real discounts captured on approved invoices, never projected or AI-estimated.",
      },
    ],
  }),
  component: InvoiceSavingsPage,
});

function InvoiceSavingsPage() {
  const { dateRange: globalDateRange } = useDateRange();
  const dateRange: DateRange = {
    from: isoDate(globalDateRange.from),
    to: isoDate(globalDateRange.to),
  };

  return (
    <>
      <Topbar eyebrow="Accounts payable" title="Savings" />
      <main className="px-6 py-6">
        <SavingsTab dateRange={dateRange} />
      </main>
    </>
  );
}

// Real discounts entered during invoice review, never projected/AI-
// estimated.
function SavingsTab({ dateRange }: { dateRange: DateRange }) {
  const { data } = useSavingsSummary(dateRange);
  const totalDiscountCents = data?.totalDiscountCents ?? 0;
  const invoicesWithDiscountCount = data?.invoicesWithDiscountCount ?? 0;
  const approvedInvoiceCount = data?.approvedInvoiceCount ?? 0;
  const byVendor = data?.byVendor ?? [];
  const invoices = data?.invoices ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Total savings captured
          </div>
          <div className="mt-1 font-display text-3xl">${(totalDiscountCents / 100).toFixed(2)}</div>
          <div className="mt-1 text-xs text-muted-foreground">from approved invoices</div>
        </Card>
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Invoices with a discount logged
          </div>
          <div className="mt-1 font-display text-3xl">
            {invoicesWithDiscountCount}
            <span className="text-lg text-muted-foreground">/{approvedInvoiceCount}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            of approved invoices — discount is entered manually during review
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Avg. savings per logged invoice
          </div>
          <div className="mt-1 font-display text-3xl">
            $
            {(
              (invoicesWithDiscountCount > 0 ? totalDiscountCents / invoicesWithDiscountCount : 0) /
              100
            ).toFixed(2)}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Savings by vendor
          </div>
          <h3 className="mt-1 font-display text-xl">Where the discounts came from</h3>
          <div className="mt-4 space-y-3">
            {byVendor.map((v) => (
              <div key={v.vendorId} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{v.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {v.invoiceCount} invoice{v.invoiceCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="font-display">{formatMoney(v.discountCents / 100)}</div>
              </div>
            ))}
            {byVendor.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No discounts logged yet.
              </p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Recent
          </div>
          <h3 className="mt-1 font-display text-xl">Invoices with a discount</h3>
          <div className="mt-4 space-y-3">
            {invoices.map((i) => (
              <div key={i.id} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{i.vendorName ?? "Unknown vendor"}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.invoiceNumber ?? "—"} · {i.invoiceDate ?? "—"}
                  </div>
                </div>
                <div className="font-display text-emerald-700">
                  −{formatMoney(i.discountCents / 100)}
                </div>
              </div>
            ))}
            {invoices.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No discounts logged yet.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
