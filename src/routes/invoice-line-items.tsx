import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Topbar } from "@/components/dashboard/Topbar";
import { useDateRange } from "@/lib/date-range-context";
import { isoDate } from "@/lib/date-range";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCategorySpend, useTopLineItems } from "@/lib/boh/queries";

function formatMoney(n: number, opts: { compact?: boolean } = {}) {
  if (opts.compact && n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const Route = createFileRoute("/invoice-line-items")({
  head: () => ({
    meta: [
      { title: "Line items · Shrinkline" },
      {
        name: "description",
        content: "Real spend and price trends from matched invoice line items.",
      },
    ],
  }),
  component: InvoiceLineItemsPage,
});

// No time window applied to useTopLineItems (see that hook) — real
// invoice volume is still too low for "last 30 days"/"MTD" to be
// meaningful rather than just hiding real spend. "Savings" per item is
// dropped — discounts are only tracked at the invoice level.
function InvoiceLineItemsPage() {
  const { dateRange: globalDateRange } = useDateRange();
  const dateRange = {
    from: isoDate(globalDateRange.from),
    to: isoDate(globalDateRange.to),
  };

  const { data: topLineItems = [] } = useTopLineItems(dateRange);
  const { data: categorySpend = [] } = useCategorySpend(dateRange);

  return (
    <>
      <Topbar eyebrow="Accounts payable" title="Line items" />
      <main className="px-6 py-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Top line items
              </div>
              <h3 className="mt-1 font-display text-xl">Where you're spending the most</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                All approved invoices — matched line items only
              </p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Δ price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topLineItems.map((i) => (
                    <TableRow key={i.ingredientId}>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {i.vendorLabel}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(i.spendCents / 100)}
                      </TableCell>
                      <TableCell className="text-right">
                        {i.priceChangePct == null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                              i.priceChangePct > 0
                                ? "text-rose-600"
                                : i.priceChangePct < 0
                                  ? "text-emerald-600"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {i.priceChangePct > 0 ? (
                              <ArrowUpRight className="h-3 w-3" />
                            ) : i.priceChangePct < 0 ? (
                              <ArrowDownRight className="h-3 w-3" />
                            ) : null}
                            {i.priceChangePct === 0 ? "—" : `${Math.abs(i.priceChangePct)}%`}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {topLineItems.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        No matched line items on approved invoices yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card className="p-5">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Category spend
            </div>
            <h3 className="mt-1 font-display text-xl">By category</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">All approved invoices</p>
            {categorySpend.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No matched line items yet.
              </p>
            ) : (
              <div className="mt-3 h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={categorySpend.map((c) => ({
                      name: c.category,
                      value: c.spendCents / 100,
                    }))}
                    layout="vertical"
                    margin={{ left: 10, right: 10 }}
                  >
                    <CartesianGrid
                      stroke="var(--border)"
                      strokeDasharray="3 3"
                      horizontal={false}
                    />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      width={100}
                    />
                    <Tooltip formatter={(v: number) => formatMoney(v)} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="var(--primary)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>
      </main>
    </>
  );
}
