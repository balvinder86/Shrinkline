import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, LineChart as LineChartIcon, TrendingUp } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useIngredientPriceMovers,
  useIngredientPriceHistory,
  type IngredientPriceMover,
} from "@/lib/boh/queries";
import { CATEGORIES, type Category } from "@/lib/boh/ingredient-categories";
import { unitLabel } from "@/lib/units";

export const Route = createFileRoute("/ingredient-price-trends")({
  head: () => ({
    meta: [
      { title: "Ingredient Price Trends · Thrasher's Pub" },
      {
        name: "description",
        content:
          "Every ingredient's cost over time from approved invoices, ranked by how much it's actually moved — catches vendor price creep before it shows up as a P&L surprise.",
      },
    ],
  }),
  component: IngredientPriceTrendsPage,
});

function formatUnitCost(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PctBadge({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-sm font-medium ${
        pct > 0 ? "text-rose-600" : pct < 0 ? "text-emerald-600" : "text-muted-foreground"
      }`}
    >
      {pct > 0 ? (
        <ArrowUpRight className="h-3.5 w-3.5" />
      ) : pct < 0 ? (
        <ArrowDownRight className="h-3.5 w-3.5" />
      ) : null}
      {pct === 0 ? "—" : `${Math.abs(pct).toFixed(1)}%`}
    </span>
  );
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
  icon: typeof TrendingUp;
  tone?: "default" | "warning" | "success";
}) {
  const toneCls =
    tone === "warning"
      ? "bg-amber-50 text-amber-700"
      : tone === "success"
        ? "bg-emerald-50 text-emerald-700"
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

function IngredientDetail({ ingredient }: { ingredient: IngredientPriceMover }) {
  const { data: history = [], isLoading } = useIngredientPriceHistory(ingredient.ingredientId);
  const chartData = history.map((h) => ({
    date: formatDate(h.effectiveDate),
    costCents: h.unitCostCents,
    vendor: h.vendorName,
  }));

  return (
    <>
      <SheetHeader>
        <div className="mb-1 flex items-center gap-2">
          <Badge variant="outline">{ingredient.category ?? "Uncategorized"}</Badge>
        </div>
        <SheetTitle className="font-display text-2xl">{ingredient.name}</SheetTitle>
        <SheetDescription>
          {formatUnitCost(ingredient.currentCostCents)} per {unitLabel(ingredient.unit)} ·{" "}
          {ingredient.vendorLabel}
        </SheetDescription>
      </SheetHeader>
      <div className="mt-6 space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Since first recorded
            </div>
            <div className="mt-1 font-display text-lg">
              <PctBadge pct={ingredient.changePct} />
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {formatUnitCost(ingredient.firstCostCents)} on {formatDate(ingredient.firstDate)}
            </div>
          </Card>
          <Card className="p-3">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Last change
            </div>
            <div className="mt-1 font-display text-lg">
              <PctBadge pct={ingredient.lastMovePct} />
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {ingredient.lastMoveCostCents != null
                ? `from ${formatUnitCost(ingredient.lastMoveCostCents)}`
                : "only one price point"}
            </div>
          </Card>
        </div>

        <div>
          <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
            Price history
          </div>
          {isLoading ? (
            <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : chartData.length < 2 ? (
            <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
              Only one recorded price — approve another invoice for this ingredient to see a trend.
            </div>
          ) : (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    width={48}
                    tickFormatter={(v: number) => formatUnitCost(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--background)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: number, _name: string, item) => {
                      const vendor = (item?.payload as { vendor: string | null } | undefined)
                        ?.vendor;
                      return [`${formatUnitCost(value)}${vendor ? ` · ${vendor}` : ""}`, "Cost"];
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="costCents"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
            Every recorded price
          </div>
          <div className="max-h-[240px] space-y-1 overflow-y-auto">
            {[...history].reverse().map((h, i) => (
              <div
                key={`${h.effectiveDate}-${i}`}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm odd:bg-muted/30"
              >
                <span className="text-muted-foreground">{formatDate(h.effectiveDate)}</span>
                <span className="text-xs text-muted-foreground">{h.vendorName ?? "—"}</span>
                <span className="font-medium tabular-nums">{formatUnitCost(h.unitCostCents)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function IngredientPriceTrendsPage() {
  const { data, isLoading } = useIngredientPriceMovers();
  const [tab, setTab] = useState<Category | "All">("All");
  const [selected, setSelected] = useState<IngredientPriceMover | null>(null);

  const rows = useMemo(() => {
    const all = data ?? [];
    return tab === "All" ? all : all.filter((r) => r.category === tab);
  }, [data, tab]);

  const increaseCount = rows.filter((r) => (r.changePct ?? 0) > 0).length;
  const biggestMover = rows[0] ?? null;

  return (
    <>
      <Topbar eyebrow="Financials" title="Ingredient Price Trends" />
      <main className="space-y-6 px-6 py-6">
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Ingredient Price Trends
          </div>
          <h3 className="mt-1 font-display text-xl">
            What's actually moving, not just what you spend most on
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every ingredient with a recorded cost from an approved invoice, ranked by how much its
            price has moved since it was first tracked — so a big jump on a low-spend item shows up
            here even though it'd never make Invoices' top-8-by-spend list.
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
            label="Ingredients tracked"
            value={isLoading ? "—" : String(rows.length)}
            hint={tab !== "All" ? tab : undefined}
            icon={LineChartIcon}
          />
          <KPI
            label="Price increases"
            value={isLoading ? "—" : String(increaseCount)}
            hint={rows.length > 0 ? `of ${rows.length} tracked` : undefined}
            icon={ArrowUpRight}
            tone={increaseCount > 0 ? "warning" : "default"}
          />
          <KPI
            label="Biggest mover"
            value={isLoading || !biggestMover ? "—" : biggestMover.name}
            hint={
              biggestMover
                ? `${biggestMover.changePct != null ? `${biggestMover.changePct > 0 ? "+" : ""}${biggestMover.changePct.toFixed(1)}%` : "—"} since first recorded`
                : undefined
            }
            icon={TrendingUp}
            tone={biggestMover && (biggestMover.changePct ?? 0) > 0 ? "warning" : "default"}
          />
        </div>

        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            By ingredient
          </div>
          <h3 className="mt-1 font-display text-xl">Biggest movers first</h3>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Ingredient</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Current cost</TableHead>
                  <TableHead className="text-right">Since first</TableHead>
                  <TableHead className="text-right">Last change</TableHead>
                  <TableHead className="text-right">Last updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No priced ingredients{tab !== "All" && ` in ${tab}`} yet — cost history is
                      recorded when an invoice with matched line items is approved.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow
                      key={r.ingredientId}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setSelected(r)}
                    >
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.category ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.vendorLabel}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatUnitCost(r.currentCostCents)}
                      </TableCell>
                      <TableCell className="text-right">
                        <PctBadge pct={r.changePct} />
                      </TableCell>
                      <TableCell className="text-right">
                        <PctBadge pct={r.lastMovePct} />
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatDate(r.latestDate)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </main>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-lg">
          {selected && <IngredientDetail ingredient={selected} />}
        </SheetContent>
      </Sheet>
    </>
  );
}
