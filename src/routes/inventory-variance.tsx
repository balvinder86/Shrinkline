import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, PackageSearch, Scale, TrendingDown, TrendingUp } from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInventoryVariance, type IngredientVarianceDetail } from "@/lib/pos/queries";
import { CATEGORIES, type Category } from "@/lib/boh/ingredient-categories";
import { unitLabel } from "@/lib/units";

export const Route = createFileRoute("/inventory-variance")({
  head: () => ({
    meta: [
      { title: "Inventory Variance · Shrinkline" },
      {
        name: "description",
        content:
          "Physical counts reconciled against purchases, recipe usage, and logged waste — the unexplained leftover is real shrinkage.",
      },
    ],
  }),
  component: InventoryVariancePage,
});

function formatMoney(cents: number, opts: { compact?: boolean } = {}) {
  const n = cents / 100;
  if (opts.compact && Math.abs(n) >= 1000) {
    return `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1000).toFixed(1)}k`;
  }
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatQty(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
  icon: typeof Scale;
  tone?: "default" | "success" | "warning";
}) {
  const toneCls =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "bg-amber-50 text-amber-700"
        : "bg-primary/10 text-primary";
  return (
    <Card className="p-5 border-stone-200 bg-white">
      <div className="flex items-start justify-between">
        <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">{label}</div>
        <div className={`grid h-9 w-9 place-items-center rounded-xl ${toneCls}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 font-serif text-3xl text-ink">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-stone-500">{hint}</div>}
    </Card>
  );
}

function varianceRowValue(r: IngredientVarianceDetail) {
  return r.varianceCostCents != null ? Math.abs(r.varianceCostCents) : Math.abs(r.varianceQty);
}

function InventoryVariancePage() {
  const { data, isLoading } = useInventoryVariance();
  const [tab, setTab] = useState<Category | "All">("All");

  const rows = useMemo(() => {
    const allRows = data?.rows ?? [];
    const sorted = [...allRows].sort((a, b) => varianceRowValue(b) - varianceRowValue(a));
    return tab === "All" ? sorted : sorted.filter((r) => r.category === tab);
  }, [data, tab]);

  const totalVarianceCents = rows.reduce((s, r) => s + (r.varianceCostCents ?? 0), 0);
  const shrinkCount = rows.filter((r) => r.varianceQty < 0).length;
  const rowsWithCost = rows.filter((r) => r.varianceCostCents != null).length;

  return (
    <div className="min-h-screen bg-cream">
      <Topbar eyebrow="Stock & purchasing" title="Inventory Variance" />

      <main className="px-8 py-8 max-w-[1500px] mx-auto space-y-8">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-terracotta font-semibold">
            Stock & purchasing
          </p>
          <p className="font-serif text-3xl text-ink mt-1">Inventory Variance</p>
          <p className="text-sm text-stone-600 mt-1 max-w-2xl">
            What should be on the shelf — starting count, plus purchases, minus recipe usage, minus
            logged waste — compared to what your last count actually found. What's left over is real
            shrinkage: theft, breakage nobody logged, over-pouring, or spoilage that missed Waste
            Log.
          </p>
        </div>

        {!isLoading && data?.status === "insufficient_counts" && (
          <Card className="border-stone-200 p-8 text-center">
            <PackageSearch className="mx-auto h-8 w-8 text-stone-400" />
            <p className="mt-3 font-serif text-xl text-ink">Need a second count to compare</p>
            <p className="mt-1 max-w-md mx-auto text-sm text-stone-600">
              {data.countsAvailable === 0
                ? "No inventory counts saved yet. Save two dated counts and this page will reconcile what happened between them."
                : "Only one inventory count saved so far. Save one more and this page will reconcile what happened in between."}
            </p>
            <Button asChild className="mt-4">
              <Link to="/inventory-count">Go to Inventory Count</Link>
            </Button>
          </Card>
        )}

        {(isLoading || data?.status === "ready") && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <KPI
                label="Unexplained variance"
                value={isLoading ? "—" : formatMoney(totalVarianceCents, { compact: true })}
                hint={
                  data?.previousCountedAt && data.latestCountedAt
                    ? `${formatDate(data.previousCountedAt)} → ${formatDate(data.latestCountedAt)}`
                    : undefined
                }
                icon={totalVarianceCents < 0 ? TrendingDown : TrendingUp}
                tone={
                  totalVarianceCents < 0
                    ? "warning"
                    : totalVarianceCents > 0
                      ? "success"
                      : "default"
                }
              />
              <KPI
                label="Ingredients short"
                value={isLoading ? "—" : String(shrinkCount)}
                hint={
                  isLoading
                    ? undefined
                    : `of ${rows.length} reconciled${tab !== "All" ? ` in ${tab}` : ""}`
                }
                icon={Scale}
                tone={shrinkCount > 0 ? "warning" : "default"}
              />
              <KPI
                label="Priced rows"
                value={isLoading ? "—" : `${rowsWithCost}/${rows.length}`}
                hint="Rows with a dollar figure — the rest still show quantity variance"
                icon={PackageSearch}
              />
            </div>

            {!isLoading &&
              data &&
              (data.itemsMissingRecipeCount > 0 || data.excludedIngredientCount > 0) && (
                <Card className="border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <div className="space-y-1 text-sm text-amber-900">
                      {data.itemsMissingRecipeCount > 0 && (
                        <p>
                          {data.itemsMissingRecipeCount} sold item
                          {data.itemsMissingRecipeCount === 1 ? "" : "s"} have no costed recipe this
                          period — their ingredient usage isn't reflected below, so expected usage
                          is understated for whatever they touch.
                        </p>
                      )}
                      {data.excludedIngredientCount > 0 && (
                        <p>
                          {data.excludedIngredientCount} ingredient
                          {data.excludedIngredientCount === 1 ? "" : "s"} counted in both periods
                          couldn't be reconciled — a purchase, waste, or count line used a unit that
                          can't convert to that ingredient's own unit — so they're left out rather
                          than shown with a guessed number.
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              )}

            <Card className="border-stone-200 overflow-hidden">
              <div className="p-5 pb-0 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-serif text-2xl text-ink">By ingredient</p>
                  <p className="text-sm text-stone-600">Biggest unexplained gaps first.</p>
                </div>
                <div className="max-w-full overflow-x-auto">
                  <Tabs value={tab} onValueChange={(v) => setTab(v as Category | "All")}>
                    <TabsList className="bg-cream border border-stone-200">
                      <TabsTrigger value="All">All</TabsTrigger>
                      {CATEGORIES.map((c) => (
                        <TabsTrigger key={c} value={c}>
                          {c}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              <div className="overflow-x-auto mt-4">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-stone-50/60">
                      <TableHead>Ingredient</TableHead>
                      <TableHead className="text-right">Start</TableHead>
                      <TableHead className="text-right">+ Purchased</TableHead>
                      <TableHead className="text-right">− Used</TableHead>
                      <TableHead className="text-right">− Wasted</TableHead>
                      <TableHead className="text-right">Expected</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-stone-500">
                          Loading…
                        </TableCell>
                      </TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-sm text-stone-500">
                          No ingredients counted in both periods{tab !== "All" && ` in ${tab}`}.
                        </TableCell>
                      </TableRow>
                    ) : (
                      rows.map((r) => (
                        <TableRow key={r.ingredientId} className="hover:bg-stone-50/50">
                          <TableCell>
                            <p className="font-medium text-ink">{r.ingredientName}</p>
                            <p className="text-xs text-stone-500">
                              {r.category ?? "—"} · {unitLabel(r.unit)}
                            </p>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatQty(r.startQty)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatQty(r.purchasedQty)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatQty(r.usedQty)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatQty(r.wastedQty)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-stone-600">
                            {formatQty(r.expectedEndQty)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {formatQty(r.actualEndQty)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-medium tabular-nums ${
                              r.varianceQty < 0
                                ? "text-terracotta"
                                : r.varianceQty > 0
                                  ? "text-emerald-700"
                                  : "text-stone-500"
                            }`}
                          >
                            {r.varianceQty >= 0 ? "+" : ""}
                            {formatQty(r.varianceQty)} {unitLabel(r.unit)}
                            {r.varianceCostCents != null && (
                              <div className="text-xs font-normal">
                                {r.varianceCostCents >= 0 ? "+" : ""}
                                {formatMoney(r.varianceCostCents)}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
