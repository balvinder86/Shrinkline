import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, DollarSign, TrendingDown, TrendingUp } from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { useDateRange } from "@/lib/date-range-context";
import { formatDateRange } from "@/lib/date-range";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFoodCostVariance } from "@/lib/pos/queries";
import { CATEGORIES, type Category } from "@/lib/boh/ingredient-categories";

export const Route = createFileRoute("/variance")({
  head: () => ({
    meta: [
      { title: "Cost Variance · Thrasher's Pub" },
      {
        name: "description",
        content:
          "Which specific ingredients explain the gap between theoretical and actual food cost — not just the one aggregate number on P&L.",
      },
    ],
  }),
  component: VariancePage,
});

function formatMoney(cents: number, opts: { compact?: boolean } = {}) {
  const n = cents / 100;
  if (opts.compact && Math.abs(n) >= 1000) {
    return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1000).toFixed(1)}k`;
  }
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
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
  icon: typeof DollarSign;
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

function VariancePage() {
  const { dateRange: globalDateRange } = useDateRange();
  const rangeLabel = useMemo(() => formatDateRange(globalDateRange), [globalDateRange]);

  const { data, isLoading } = useFoodCostVariance(globalDateRange);

  const [tab, setTab] = useState<Category | "All">("All");
  const rows = useMemo(() => {
    const allRows = data?.rows ?? [];
    return tab === "All" ? allRows : allRows.filter((r) => r.category === tab);
  }, [data, tab]);

  // KPIs always reflect whatever category is selected, not the grand
  // total — re-summed from the same rows the table below shows, so the
  // two never disagree.
  const totalTheoreticalCents = rows.reduce((s, r) => s + r.theoreticalCostCents, 0);
  const totalActualCents = rows.reduce((s, r) => s + r.actualSpendCents, 0);
  const varianceCents = totalActualCents - totalTheoreticalCents;
  const variancePct =
    totalTheoreticalCents > 0 ? (varianceCents / totalTheoreticalCents) * 100 : null;

  return (
    <>
      <Topbar eyebrow="Financials" title="Cost Variance" />
      <main className="space-y-6 px-6 py-6">
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Cost Variance
          </div>
          <h3 className="mt-1 font-display text-xl">Which ingredients explain the P&L gap</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            P&L shows one aggregate theoretical-vs-actual number for food & beverage COGS. This
            breaks that gap down by ingredient — theoretical usage cost (from recipes × units sold)
            against real approved-invoice spend matched to that ingredient — so you can see exactly
            what's driving it, not just that it exists.
          </p>
          <div className="mt-4 max-w-full overflow-x-auto">
            <Tabs value={tab} onValueChange={(v) => setTab(v as Category | "All")}>
              <TabsList>
                <TabsTrigger value="All">All</TabsTrigger>
                {CATEGORIES.map((c) => (
                  <TabsTrigger key={c} value={c}>
                    {c}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          <KPI
            label="Theoretical cost"
            value={isLoading ? "—" : formatMoney(totalTheoreticalCents, { compact: true })}
            hint={tab === "All" ? rangeLabel : `${rangeLabel} · ${tab}`}
            icon={DollarSign}
          />
          <KPI
            label="Actual cost (matched)"
            value={isLoading ? "—" : formatMoney(totalActualCents, { compact: true })}
            hint={tab === "All" ? rangeLabel : `${rangeLabel} · ${tab}`}
            icon={DollarSign}
          />
          <KPI
            label="Variance"
            value={isLoading ? "—" : formatMoney(varianceCents, { compact: true })}
            hint={
              variancePct != null
                ? `${variancePct >= 0 ? "+" : ""}${variancePct.toFixed(1)}% vs theoretical`
                : "No theoretical cost to compare"
            }
            icon={varianceCents >= 0 ? TrendingUp : TrendingDown}
            tone={varianceCents > 0 ? "warning" : varianceCents < 0 ? "success" : "default"}
          />
        </div>

        {!isLoading &&
          data &&
          (data.unmatchedActualSpendCents > 0 || data.itemsMissingRecipeCount > 0) && (
            <Card className="border-amber-200 bg-amber-50/60 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div className="space-y-1 text-sm text-amber-900">
                  {data.itemsMissingRecipeCount > 0 && (
                    <p>
                      {data.itemsMissingRecipeCount} sold item
                      {data.itemsMissingRecipeCount === 1 ? "" : "s"} have no costed recipe this
                      period — their ingredient usage isn't reflected in theoretical cost below, so
                      it's understated.
                    </p>
                  )}
                  {data.unmatchedActualSpendCents > 0 && (
                    <p>
                      {formatMoney(data.unmatchedActualSpendCents)} in approved food & beverage
                      invoice spend isn't matched to any ingredient yet (unreviewed or unmatched
                      invoice lines) — real spend the table below doesn't include.
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}

        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            By ingredient
          </div>
          <h3 className="mt-1 font-display text-xl">
            Biggest gaps first, {rangeLabel}
            {tab !== "All" && ` · ${tab}`}
          </h3>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Ingredient</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Theoretical</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No theoretical usage or matched invoice spend found for {rangeLabel}
                      {tab !== "All" && ` in ${tab}`}.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.ingredientId}>
                      <TableCell className="font-medium">{r.ingredientName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.category ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.theoreticalCostCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.actualSpendCents)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${
                          r.varianceCents > 0
                            ? "text-amber-700"
                            : r.varianceCents < 0
                              ? "text-emerald-700"
                              : ""
                        }`}
                      >
                        {r.varianceCents >= 0 ? "+" : ""}
                        {formatMoney(r.varianceCents)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </main>
    </>
  );
}
