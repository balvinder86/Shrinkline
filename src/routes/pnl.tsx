import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Landmark, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { useDateRange } from "@/lib/date-range-context";
import { isoDate, formatDateRange } from "@/lib/date-range";
import { Card } from "@/components/ui/card";
import { useFoodCostSummary } from "@/lib/pos/queries";
import { useLaborCostSummary } from "@/lib/labor/queries";
import { useExpenseCategorySpend } from "@/lib/boh/queries";
import { VENDOR_CATEGORY_LABEL, type VendorCategory } from "@/lib/boh/vendor-categories";

export const Route = createFileRoute("/pnl")({
  head: () => ({
    meta: [
      { title: "P&L · Thrasher's Pub" },
      {
        name: "description",
        content:
          "Operational profit & loss — real sales, food cost (theoretical vs actual), labor, prime cost, and operating expenses for the selected period.",
      },
    ],
  }),
  component: PnlPage,
});

function formatMoney(cents: number, opts: { compact?: boolean } = {}) {
  const n = cents / 100;
  if (opts.compact && Math.abs(n) >= 1000) return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1000).toFixed(1)}k`;
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatPct(pct: number | null) {
  return pct == null ? "—" : `${pct.toFixed(1)}%`;
}

function KPI({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Wallet;
  tone?: "default" | "success" | "warning";
}) {
  const toneCls =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "bg-amber-50 text-amber-700"
        : "bg-primary/10 text-primary";
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className={`grid h-9 w-9 place-items-center rounded-xl ${toneCls}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 font-display text-3xl">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

// One line of the report: label on the left, $ and % of sales on the
// right. `emphasis` bolds + tints a row for the two rollup lines
// (Prime Cost, Controllable Profit) so they read as subtotals, not
// just another line item.
function ReportRow({
  label,
  hint,
  amountCents,
  pct,
  emphasis,
  indent,
  muted,
}: {
  label: string;
  hint?: string;
  amountCents: number | null;
  pct?: number | null;
  emphasis?: boolean;
  indent?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-2.5 ${
        emphasis ? "rounded-lg bg-primary/[0.04] px-3 font-medium" : indent ? "px-3" : ""
      }`}
    >
      <div className={indent ? "pl-4" : ""}>
        <div className={muted ? "text-sm text-muted-foreground" : "text-sm"}>{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-baseline gap-3 tabular-nums">
        <span className={emphasis ? "font-display text-lg" : "text-sm"}>
          {amountCents == null ? "—" : formatMoney(amountCents)}
        </span>
        {pct !== undefined && (
          <span className="w-14 text-right text-xs text-muted-foreground">{formatPct(pct ?? null)}</span>
        )}
      </div>
    </div>
  );
}

function PnlPage() {
  const { dateRange: globalDateRange } = useDateRange();
  const rangeLabel = useMemo(() => formatDateRange(globalDateRange), [globalDateRange]);
  const expenseDateRange = useMemo(
    () => ({ from: isoDate(globalDateRange.from), to: isoDate(globalDateRange.to) }),
    [globalDateRange],
  );

  const { data: foodCost, isLoading: isFoodCostLoading } = useFoodCostSummary(globalDateRange);
  const { data: labor, isLoading: isLaborLoading } = useLaborCostSummary(globalDateRange);
  const { data: opex = [], isLoading: isOpexLoading } = useExpenseCategorySpend(expenseDateRange);

  const isLoading = isFoodCostLoading || isLaborLoading || isOpexLoading;

  const netSalesCents = foodCost?.netSalesCents ?? 0;
  // "No approved invoices this period" means unknown actual COGS, not
  // a real $0 — a Prime Cost built on top of a fabricated $0 would
  // look artificially favorable. Same null-over-fabricated-zero rule
  // useFoodCostSummary itself already follows.
  const hasActualCogs = foodCost?.actualPct != null;
  const actualCogsCents = foodCost?.actualSpendCents ?? 0;
  const laborCents = labor?.laborCostCents ?? 0;

  const nonFoodOpex = useMemo(
    () => opex.filter((c) => c.category !== "food_beverage"),
    [opex],
  );
  const opexTotalCents = useMemo(
    () => nonFoodOpex.reduce((s, c) => s + c.spendCents, 0),
    [nonFoodOpex],
  );

  const canComputeRollups = hasActualCogs && netSalesCents > 0;
  const primeCostCents = canComputeRollups ? actualCogsCents + laborCents : null;
  const primeCostPct = primeCostCents != null ? (primeCostCents / netSalesCents) * 100 : null;
  const controllableProfitCents = canComputeRollups
    ? netSalesCents - actualCogsCents - laborCents - opexTotalCents
    : null;
  const controllableProfitPct =
    controllableProfitCents != null ? (controllableProfitCents / netSalesCents) * 100 : null;

  return (
    <>
      <Topbar eyebrow="Financials" title="P&L" />
      <main className="space-y-6 px-6 py-6">
        {/* KPI row */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <KPI
            label="Sales"
            value={isLoading ? "—" : formatMoney(netSalesCents, { compact: true })}
            hint={rangeLabel}
            icon={Wallet}
          />
          <KPI
            label="Food & Bev COGS"
            value={isLoading ? "—" : formatPct(foodCost?.actualPct ?? null)}
            hint={hasActualCogs ? "actual, of sales" : "no approved invoices yet"}
            icon={TrendingDown}
            tone={
              foodCost?.actualPct != null ? (foodCost.actualPct > 32 ? "warning" : "success") : "default"
            }
          />
          <KPI
            label="Labor"
            value={isLoading ? "—" : formatPct(labor?.laborCostPct ?? null)}
            hint="of sales"
            icon={Wallet}
            tone={labor?.laborCostPct != null ? (labor.laborCostPct > 35 ? "warning" : "success") : "default"}
          />
          <KPI
            label="Prime cost"
            value={isLoading ? "—" : formatPct(primeCostPct)}
            hint={canComputeRollups ? "COGS + labor, of sales" : "not enough data yet"}
            icon={Landmark}
            tone={primeCostPct != null ? (primeCostPct > 60 ? "warning" : "success") : "default"}
          />
          <KPI
            label="Controllable profit"
            value={isLoading ? "—" : formatPct(controllableProfitPct)}
            hint={canComputeRollups ? "of sales" : "not enough data yet"}
            icon={TrendingUp}
            tone={
              controllableProfitPct != null ? (controllableProfitPct >= 0 ? "success" : "warning") : "default"
            }
          />
        </div>

        {/* Report */}
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Operational P&amp;L
              </div>
              <h2 className="mt-1 font-display text-2xl">{rangeLabel}</h2>
            </div>
            <p className="max-w-sm text-right text-xs text-muted-foreground">
              An operational view built from real sales, invoices, and labor — not a reconciled
              accounting ledger.
            </p>
          </div>

          <div className="mt-4 divide-y divide-border">
            <ReportRow label="Sales" amountCents={isLoading ? null : netSalesCents} pct={undefined} />

            <div className="py-1">
              <div className="px-3 pt-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                COGS · Food &amp; Beverage
              </div>
              <ReportRow
                label="Actual"
                hint="from approved invoices"
                amountCents={isLoading ? null : actualCogsCents}
                pct={foodCost?.actualPct ?? null}
                indent
              />
              <ReportRow
                label="Theoretical"
                hint="from recipes × units sold"
                amountCents={isLoading ? null : (foodCost?.theoreticalCostCents ?? 0)}
                pct={foodCost?.theoreticalPct ?? null}
                indent
                muted
              />
              {foodCost?.variancePct != null && (
                <div className="px-3 pb-1 pl-7 text-xs">
                  <span className={foodCost.variancePct <= 0 ? "text-emerald-600" : "text-amber-700"}>
                    {foodCost.variancePct > 0 ? "+" : ""}
                    {foodCost.variancePct.toFixed(1)}% variance
                  </span>{" "}
                  <span className="text-muted-foreground">
                    ({formatMoney(foodCost.varianceCents)} vs. what the recipes say it should have cost)
                  </span>
                </div>
              )}
              {!foodCost?.hasRecipeData && !isLoading && (
                <div className="px-3 pb-1 pl-7 text-xs text-muted-foreground">
                  No recipe data yet — theoretical cost isn't available.
                </div>
              )}
            </div>

            <ReportRow
              label="Labor"
              hint={
                labor && labor.liveShiftCount > 0
                  ? `${labor.liveShiftCount} shift${labor.liveShiftCount === 1 ? "" : "s"} still clocked in, estimated`
                  : "regular + overtime"
              }
              amountCents={isLoading ? null : laborCents}
              pct={labor?.laborCostPct ?? null}
            />

            <ReportRow
              label="Prime cost"
              hint="COGS (actual) + labor"
              amountCents={primeCostCents}
              pct={primeCostPct}
              emphasis
            />

            <div className="py-1">
              <div className="px-3 pt-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Operating expenses
              </div>
              {nonFoodOpex.map((c) => (
                <ReportRow
                  key={c.category}
                  label={VENDOR_CATEGORY_LABEL[c.category as VendorCategory]}
                  amountCents={isLoading ? null : c.spendCents}
                  pct={netSalesCents > 0 ? (c.spendCents / netSalesCents) * 100 : null}
                  indent
                />
              ))}
              <ReportRow
                label="Total operating expenses"
                amountCents={isLoading ? null : opexTotalCents}
                pct={netSalesCents > 0 ? (opexTotalCents / netSalesCents) * 100 : null}
                indent
                muted
              />
            </div>

            <ReportRow
              label="Controllable profit"
              hint="Sales − COGS (actual) − labor − operating expenses"
              amountCents={controllableProfitCents}
              pct={controllableProfitPct}
              emphasis
            />
          </div>
        </Card>
      </main>
    </>
  );
}
