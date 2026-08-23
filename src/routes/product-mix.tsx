import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useProductMix,
  useOrderCount,
  useLastSyncTime,
  useOrderDetails,
  useItemTrend,
  type RealMenuItem,
} from "@/lib/pos/queries";
import { useRecipeLinesForItem } from "@/lib/boh/queries";
import { convertQuantityToIngredientUnit } from "@/lib/units";
import {
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  Award,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plug,
  RefreshCw,
  Search,
  Star,
  Tag,
  TrendingUp,
  Utensils,
  DollarSign,
  Pencil,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Topbar } from "@/components/dashboard/Topbar";
import { AiRecommendationsPanel } from "@/components/insights/AiRecommendationsPanel";
import { quadrant, QUAD_COLOR, formatItemPrice } from "@/lib/boh/menuEngineering";
import { formatDateRange } from "@/lib/date-range";
import { useDateRange } from "@/lib/date-range-context";
import { useCurrentRestaurant } from "@/lib/restaurant-context";
import { useCurrentLocation } from "@/lib/location-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/product-mix")({
  head: () => ({
    meta: [
      { title: "Product Mix · Shrinkline" },
      {
        name: "description",
        content:
          "Menu engineering for Shrinkline — stars, plowhorses, puzzles & dogs by category and daypart.",
      },
    ],
  }),
  component: ProductMixPage,
});

// ---------- Types ----------
type Category = string;

type MenuItem = RealMenuItem;

const ITEMS_PAGE_SIZE = 50;

const PALETTE = {
  ink: "var(--foreground)",
  terracotta: "#c4654a",
  olive: "#87a878",
  amber: "#d4a574",
  rose: "#c17c74",
  muted: "var(--muted-foreground)",
};

const TREND_COLORS = [PALETTE.terracotta, "#3a2418", PALETTE.amber, PALETTE.olive, PALETTE.rose];

// Real menu setup has two overlapping cocktail categories in Toast
// ("Bar Drinks" and "Bar Drinks(Cocktails)") — the Categories tab
// rolls the smaller one into the other instead of showing a redundant
// tile. Item-level views (All items' filter pills, the items table)
// keep the real distinct category as entered in Toast.
const CATEGORY_ALIASES: Record<string, string> = {
  "Bar Drinks": "Bar Drinks(Cocktails)",
};
function canonicalCategory(category: string): string {
  return CATEGORY_ALIASES[category] ?? category;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function usd(n: number) {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// ---------- Page ----------
function ProductMixPage() {
  const { dateRange } = useDateRange();
  const rangeLabel = formatDateRange(dateRange);
  const rangeDayCount =
    Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000) + 1;
  const [cat, setCat] = useState<Category | "All">("All");
  const [q, setQ] = useState("");
  const [sortOrder, setSortOrder] = useState<"default" | "most-sold" | "least-sold">("default");
  const [selected, setSelected] = useState<MenuItem | null>(null);

  const { data: items = [], isLoading, error } = useProductMix(dateRange);
  const { data: orderCount = 0 } = useOrderCount(dateRange);
  const { data: orderDetails, isLoading: isOrderDetailsLoading } = useOrderDetails(dateRange);
  const { data: itemTrend, isLoading: isTrendLoading } = useItemTrend(dateRange, 5);

  // Same top-N items and per-item colors as the velocity line chart
  // above it — just summed across the whole period instead of broken
  // out by bucket, so "who's biggest" reads at a glance next to "who's
  // moving how".
  const itemTrendShare = useMemo(() => {
    if (!itemTrend) return [];
    const totals = itemTrend.items.map((name) => ({
      name,
      units: itemTrend.series.reduce((sum, point) => sum + (Number(point[name]) || 0), 0),
      revenue: (itemTrend.revenueCents[name] ?? 0) / 100,
    }));
    const totalUnits = totals.reduce((a, t) => a + t.units, 0);
    if (totalUnits === 0) return [];
    return totals
      .filter((t) => t.units > 0)
      .map((t, i) => ({
        name: t.name,
        value: t.units,
        revenue: t.revenue,
        pct: Math.round((t.units / totalUnits) * 100),
        color: TREND_COLORS[i % TREND_COLORS.length],
      }));
  }, [itemTrend]);

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category))).sort(),
    [items],
  );
  const canonicalCategories = useMemo(
    () => Array.from(new Set(items.map((i) => canonicalCategory(i.category)))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const matched = items.filter(
      (i) =>
        (cat === "All" || i.category === cat) &&
        (q === "" || i.name.toLowerCase().includes(q.toLowerCase())),
    );
    if (sortOrder === "most-sold") return [...matched].sort((a, b) => b.soldWk - a.soldWk);
    if (sortOrder === "least-sold") return [...matched].sort((a, b) => a.soldWk - b.soldWk);
    return matched;
  }, [items, cat, q, sortOrder]);

  const [itemsPage, setItemsPage] = useState(1);

  // Any change to what's being filtered should land back on page 1 —
  // otherwise a narrower filter can strand you on a now-empty page.
  useEffect(() => {
    setItemsPage(1);
  }, [cat, q, sortOrder]);

  const itemsTotalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PAGE_SIZE));
  const pagedFiltered = useMemo(
    () => filtered.slice((itemsPage - 1) * ITEMS_PAGE_SIZE, itemsPage * ITEMS_PAGE_SIZE),
    [filtered, itemsPage],
  );

  // Sold/revenue totals for whatever's currently filtered (category
  // pill + search), not just the page in view — so switching a filter
  // shows the real total for that slice, not a per-page fragment.
  const filteredTotals = useMemo(
    () => ({
      units: filtered.reduce((s, i) => s + i.soldWk, 0),
      revenue: filtered.reduce((s, i) => s + i.revenueWk, 0),
    }),
    [filtered],
  );

  const popMedian = useMemo(() => {
    if (items.length === 0) return 0;
    const arr = [...items].sort((a, b) => a.soldWk - b.soldWk);
    return arr[Math.floor(arr.length / 2)].soldWk;
  }, [items]);
  const marginMedian = useMemo(() => {
    const priced = items.filter((i) => i.cost != null);
    if (priced.length === 0) return 0;
    const arr = [...priced].sort((a, b) => a.price - a.cost! - (b.price - b.cost!));
    const mid = arr[Math.floor(arr.length / 2)];
    return mid.price - mid.cost!;
  }, [items]);

  const totals = useMemo(() => {
    const revenue = items.reduce((s, i) => s + i.revenueWk, 0);
    const prevRevenue = items.reduce((s, i) => s + i.revenuePrevWk, 0);
    const cogs = items.reduce((s, i) => s + (i.cost ?? 0) * i.soldWk, 0);
    const units = items.reduce((s, i) => s + i.soldWk, 0);
    const prevUnits = items.reduce((s, i) => s + i.soldPrevWk, 0);
    const stars = items.filter((i) => quadrant(i, popMedian, marginMedian) === "Star").length;
    return {
      revenue,
      revenueDelta: prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null,
      cogs,
      grossMargin: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0,
      units,
      unitsDelta: prevUnits > 0 ? units - prevUnits : null,
      avgCheck: orderCount > 0 ? revenue / orderCount : 0,
      stars,
    };
  }, [items, popMedian, marginMedian, orderCount]);

  // Top real sellers for whatever the global date range is currently
  // set to — no prior-period comparison, just real revenue and units
  // for the selection itself.
  const topMovers = useMemo(() => {
    return [...items]
      .filter((i) => i.soldWk > 0)
      .sort((a, b) => b.revenueWk - a.revenueWk)
      .slice(0, 6);
  }, [items]);

  // Real revenue by time-of-day, bucketed in the restaurant's own
  // local timezone (not UTC) so "Lunch"/"Dinner" etc. line up with
  // when guests actually ordered. "Late night" wraps past midnight —
  // hour 0-11 is treated as a continuation of the prior night rather
  // than a 5th "early morning" bucket, since a pub has ~no real
  // activity in that window.
  const dayparts = useMemo(() => {
    if (!orderDetails) return null;
    const { timezone, orders } = orderDetails;
    const buckets = [
      { name: "Lunch", hours: "11a–3p", test: (h: number) => h >= 11 && h < 15 },
      { name: "Mid Day", hours: "3p–6p", test: (h: number) => h >= 15 && h < 18 },
      { name: "Dinner", hours: "6p–10p", test: (h: number) => h >= 18 && h < 22 },
      { name: "Late night", hours: "10p–close", test: (h: number) => h >= 22 || h < 11 },
    ];
    const fmt = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    });
    const localHour = (iso: string): number => {
      const part = fmt.formatToParts(new Date(iso)).find((p) => p.type === "hour");
      return Number(part?.value ?? "0") % 24;
    };

    const revenueByHour = new Array<number>(24).fill(0);
    const bucketed = buckets.map((b) => ({
      ...b,
      revenueCents: 0,
      itemQty: new Map<string, number>(),
    }));
    for (const o of orders) {
      const h = localHour(o.openedAt);
      revenueByHour[h] += o.totalCents;
      const bucket = bucketed.find((b) => b.test(h));
      if (!bucket) continue;
      bucket.revenueCents += o.totalCents;
      for (const item of o.items) {
        bucket.itemQty.set(item.name, (bucket.itemQty.get(item.name) ?? 0) + item.quantity);
      }
    }
    const totalRevenueCents = bucketed.reduce((s, b) => s + b.revenueCents, 0);
    const tiles = bucketed.map((b) => {
      let topItem = "—";
      let topQty = 0;
      for (const [name, qty] of b.itemQty) {
        if (qty > topQty) {
          topQty = qty;
          topItem = name;
        }
      }
      return {
        name: b.name,
        hours: b.hours,
        revenue: b.revenueCents / 100,
        share: totalRevenueCents > 0 ? (b.revenueCents / totalRevenueCents) * 100 : 0,
        topItem,
      };
    });
    // Chart starts at 11a (real service start) and wraps through
    // close, matching the daypart order above rather than 12a-11p.
    const hourOrder = [...Array(24).keys()].map((i) => (i + 11) % 24);
    const hourlyChart = hourOrder.map((h) => ({
      hr: h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`,
      revenue: revenueByHour[h] / 100,
    }));
    return { tiles, hourlyChart, totalOrders: orders.length };
  }, [orderDetails]);

  return (
    <div className="min-h-screen bg-background">
      <Topbar eyebrow="Menu performance" title="Product Mix" />
      <main className="px-8 py-8 max-w-[1600px] mx-auto space-y-8">
        <AiRecommendationsPanel tab="product_mix" />

        {/* Header */}
        <header>
          <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-2">
            Menu performance
          </p>
          <h1 className="font-serif text-4xl text-foreground">Product Mix</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-xl">
            See which dishes carry the room, which ones drain it, and where the menu wants a nudge.
            Tracked against the prior period's sales.
          </p>
        </header>

        {/* POS sync strip */}
        <PosSyncStrip />

        {isLoading && <div className="text-sm text-muted-foreground">Loading sales data…</div>}
        {error && (
          <div className="text-sm text-[#a8453a]">
            Couldn't load sales data: {(error as Error).message}
          </div>
        )}

        {/* KPI row */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Kpi
            label="Net revenue"
            value={usd(totals.revenue)}
            delta={
              totals.revenueDelta != null
                ? `${totals.revenueDelta >= 0 ? "+" : ""}${totals.revenueDelta.toFixed(1)}%`
                : undefined
            }
            up={totals.revenueDelta != null ? totals.revenueDelta >= 0 : undefined}
            icon={DollarSign}
          />
          <Kpi label="Gross margin" value={`${totals.grossMargin.toFixed(1)}%`} icon={TrendingUp} />
          <Kpi
            label="Items sold"
            value={fmt(totals.units)}
            delta={
              totals.unitsDelta != null
                ? `${totals.unitsDelta >= 0 ? "+" : ""}${fmt(totals.unitsDelta)}`
                : undefined
            }
            up={totals.unitsDelta != null ? totals.unitsDelta >= 0 : undefined}
            icon={Utensils}
          />
          <Kpi label="Avg check" value={`$${totals.avgCheck.toFixed(2)}`} icon={Tag} />
          <Kpi label="Star items" value={`${totals.stars}`} icon={Award} />
        </section>

        {/* Top movers */}
        <section>
          <div className="flex items-end justify-between mb-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                {rangeLabel}
              </p>
              <h3 className="font-serif text-2xl">Top movers</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Best real sellers for the selected period, by revenue
              </p>
            </div>
          </div>
          {topMovers.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No sales in this period yet.
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {topMovers.map((m, idx) => (
                <Card
                  key={m.id}
                  className="p-4 cursor-pointer hover:border-[#c4654a]/40 transition"
                  onClick={() => setSelected(m)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">#{idx + 1}</span>
                        <div className="font-medium truncate">{m.name}</div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {m.category} · {m.soldWk} sold
                      </div>
                    </div>
                    <div className="font-mono font-medium whitespace-nowrap">
                      {usd(m.revenueWk)}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Tabs: detailed views */}
        <Tabs defaultValue="items" className="space-y-4">
          <TabsList className="bg-card border">
            <TabsTrigger value="items">All items</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="dayparts">Dayparts</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
          </TabsList>

          {/* ITEMS */}
          <TabsContent value="items">
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search menu items…"
                    className="pl-9 bg-background"
                  />
                </div>
                <div className="flex flex-wrap gap-1 text-xs">
                  {(["All", ...categories] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setCat(c as Category | "All")}
                      className={`px-3 py-1.5 rounded-full border transition ${
                        cat === c
                          ? "bg-foreground text-background border-foreground"
                          : "bg-card border-border hover:border-foreground/30"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <Select
                  value={sortOrder}
                  onValueChange={(v) => setSortOrder(v as typeof sortOrder)}
                >
                  <SelectTrigger className="h-9 w-[168px] gap-2 bg-background text-xs">
                    <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default order</SelectItem>
                    <SelectItem value="most-sold">Most sold first</SelectItem>
                    <SelectItem value="least-sold">Least sold first</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b">
                      <th className="text-left py-2 px-3 font-medium">Item</th>
                      <th className="text-left py-2 px-3 font-medium">Category</th>
                      <th className="text-right py-2 px-3 font-medium">Price</th>
                      <th className="text-right py-2 px-3 font-medium">Cost</th>
                      <th className="text-right py-2 px-3 font-medium">Margin</th>
                      <th className="text-right py-2 px-3 font-medium">Sold</th>
                      <th className="text-right py-2 px-3 font-medium">WoW</th>
                      <th className="text-right py-2 px-3 font-medium">Revenue</th>
                      <th className="text-left py-2 px-3 font-medium">Quadrant</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedFiltered.map((i) => {
                      const margin = i.cost != null && i.price > 0 ? i.price - i.cost : null;
                      const marginPct = margin != null ? (margin / i.price) * 100 : null;
                      const wow =
                        i.soldPrevWk > 0
                          ? ((i.soldWk - i.soldPrevWk) / i.soldPrevWk) * 100
                          : i.soldWk > 0
                            ? 100
                            : 0;
                      const q = quadrant(i, popMedian, marginMedian);
                      return (
                        <tr
                          key={i.id}
                          className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                          onClick={() => setSelected(i)}
                        >
                          <td className="py-3 px-3">
                            <div className="font-medium">{i.name}</div>
                          </td>
                          <td className="py-3 px-3">
                            <Badge variant="outline" className="font-normal">
                              {i.category}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 text-right font-mono">{formatItemPrice(i)}</td>
                          <td className="py-3 px-3 text-right font-mono text-muted-foreground">
                            {i.cost != null ? `$${i.cost.toFixed(2)}` : "—"}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {margin != null ? (
                              <>
                                <div className="font-mono">${margin.toFixed(2)}</div>
                                <div className="text-xs text-muted-foreground">
                                  {marginPct!.toFixed(0)}%
                                </div>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">Add cost</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono">{i.soldWk}</td>
                          <td className="py-3 px-3 text-right">
                            <span
                              className={`text-xs font-medium ${wow >= 0 ? "text-[#5a7d4a]" : "text-[#a8453a]"}`}
                            >
                              {wow >= 0 ? "+" : ""}
                              {wow.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-mono">
                            ${i.revenueWk.toLocaleString()}
                          </td>
                          <td className="py-3 px-3">
                            <Badge
                              className="font-normal text-xs"
                              style={{
                                background: `${QUAD_COLOR[q]}22`,
                                color: QUAD_COLOR[q],
                                border: `1px solid ${QUAD_COLOR[q]}55`,
                              }}
                            >
                              {q}
                            </Badge>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  {filtered.length === 0
                    ? "0 items"
                    : `Showing ${(itemsPage - 1) * ITEMS_PAGE_SIZE + 1}–${Math.min(itemsPage * ITEMS_PAGE_SIZE, filtered.length)} of ${filtered.length} item${filtered.length === 1 ? "" : "s"}`}
                  {filtered.length > 0 && (
                    <>
                      {" "}
                      · <span className="font-mono">{fmt(filteredTotals.units)}</span> sold ·{" "}
                      <span className="font-mono">{usd(filteredTotals.revenue)}</span> revenue
                    </>
                  )}
                </span>
                {itemsTotalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={itemsPage <= 1}
                      onClick={() => setItemsPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {itemsPage} of {itemsTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={itemsPage >= itemsTotalPages}
                      onClick={() => setItemsPage((p) => Math.min(itemsTotalPages, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* CATEGORIES */}
          <TabsContent value="categories">
            <div className="grid md:grid-cols-2 gap-4">
              {canonicalCategories.map((c) => {
                const list = items.filter((i) => canonicalCategory(i.category) === c);
                const rev = list.reduce((s, i) => s + i.revenueWk, 0);
                const cogs = list.reduce((s, i) => s + (i.cost ?? 0) * i.soldWk, 0);
                const units = list.reduce((s, i) => s + i.soldWk, 0);
                const share = totals.revenue > 0 ? (rev / totals.revenue) * 100 : 0;
                const priced = list.filter((i) => i.cost != null).length;
                const top = [...list].sort((a, b) => b.revenueWk - a.revenueWk).slice(0, 3);
                return (
                  <Card key={c} className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-muted grid place-items-center">
                          <Utensils className="h-5 w-5 text-[#c4654a]" />
                        </div>
                        <div>
                          <div className="font-serif text-lg">{c}</div>
                          <div className="text-xs text-muted-foreground">
                            {list.length} items · {fmt(units)} sold
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-lg">{usd(rev)}</div>
                        <div className="text-xs text-muted-foreground">
                          {share.toFixed(1)}% of rev
                        </div>
                      </div>
                    </div>
                    <Progress value={share} className="h-1.5 mb-4" />
                    <div className="text-xs text-muted-foreground mb-2">Top sellers</div>
                    <div className="space-y-1.5">
                      {top.map((t) => (
                        <div key={t.id} className="flex justify-between text-sm">
                          <span>{t.name}</span>
                          <span className="font-mono text-muted-foreground">{t.soldWk}</span>
                        </div>
                      ))}
                    </div>
                    <Separator className="my-3" />
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-xs text-muted-foreground">Margin</div>
                        <div className="font-mono text-sm">
                          {rev > 0 ? `${(((rev - cogs) / rev) * 100).toFixed(0)}%` : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Avg price</div>
                        <div className="font-mono text-sm">
                          ${(list.reduce((s, i) => s + i.price, 0) / list.length).toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Priced</div>
                        <div className="font-mono text-sm">
                          {priced}/{list.length}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* DAYPARTS */}
          <TabsContent value="dayparts">
            <Card className="p-6">
              {isOrderDetailsLoading ? (
                <div className="text-sm text-muted-foreground">Loading real order timing…</div>
              ) : !dayparts || dayparts.totalOrders === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No real orders in {rangeLabel} yet.
                </div>
              ) : (
                <>
                  <div className="grid lg:grid-cols-4 gap-4 mb-6">
                    {dayparts.tiles.map((d) => (
                      <div key={d.name} className="p-4 rounded-lg border bg-muted/20">
                        <div className="text-xs uppercase tracking-widest text-muted-foreground">
                          {d.hours}
                        </div>
                        <div className="font-serif text-xl mt-1">{d.name}</div>
                        <div className="font-mono text-2xl mt-2">{usd(d.revenue)}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {d.share.toFixed(0)}% of {rangeLabel}
                        </div>
                        <Separator className="my-3" />
                        <div className="text-xs text-muted-foreground">Best seller</div>
                        <div className="text-sm font-medium">{d.topItem}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    Real revenue by hour of day, {rangeLabel} · restaurant local time
                  </p>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dayparts.hourlyChart}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
                        <XAxis dataKey="hr" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                        <Tooltip
                          contentStyle={{
                            background: "var(--background)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          formatter={(v: number) => usd(v)}
                        />
                        <Line
                          type="monotone"
                          dataKey="revenue"
                          name="Revenue"
                          stroke={PALETTE.terracotta}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </Card>
          </TabsContent>

          {/* TRENDS */}
          <TabsContent value="trends">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-6 lg:col-span-2">
                <div className="flex items-end justify-between mb-4">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                      {rangeLabel}
                    </p>
                    <h3 className="font-serif text-2xl">
                      Top {itemTrend?.items.length ?? 5} items velocity
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Real units sold, {rangeDayCount > 21 ? "weekly" : "daily"}
                    </p>
                  </div>
                </div>
                {isTrendLoading ? (
                  <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
                    Loading real sales history…
                  </div>
                ) : !itemTrend || itemTrend.items.length === 0 ? (
                  <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
                    No real sales in {rangeLabel} yet.
                  </div>
                ) : (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={itemTrend.series}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{
                            background: "var(--background)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {itemTrend.items.map((name, i) => (
                          <Line
                            key={name}
                            type="monotone"
                            dataKey={name}
                            stroke={TREND_COLORS[i % TREND_COLORS.length]}
                            strokeWidth={2}
                            dot={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>

              <Card className="p-6">
                <p className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                  {rangeLabel}
                </p>
                <h3 className="font-serif text-2xl">Top items share</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Real units sold, split across the same top items
                </p>
                {isTrendLoading ? (
                  <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                    Loading…
                  </div>
                ) : itemTrendShare.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-center text-sm text-muted-foreground">
                    No real sales in {rangeLabel} yet.
                  </div>
                ) : (
                  <>
                    <div className="mt-2 h-52">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={itemTrendShare}
                            dataKey="value"
                            innerRadius={56}
                            outerRadius={84}
                            paddingAngle={2}
                            isAnimationActive={false}
                          >
                            {itemTrendShare.map((s) => (
                              <Cell key={s.name} fill={s.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(
                              _v: number,
                              _n: string,
                              item: { payload?: { value: number; revenue: number } },
                            ) => [
                              `${usd(item.payload?.revenue ?? 0)} · ${(item.payload?.value ?? 0).toLocaleString()} sold`,
                              "",
                            ]}
                            contentStyle={{
                              background: "var(--background)",
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-3 space-y-2">
                      {itemTrendShare.map((s) => (
                        <div key={s.name} className="flex items-center justify-between text-sm">
                          <span className="inline-flex min-w-0 items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ background: s.color }}
                            />
                            <span className="truncate">{s.name}</span>
                          </span>
                          <span className="ml-3 shrink-0 text-right">
                            <div className="font-medium">{usd(s.revenue)}</div>
                            <div className="text-xs text-muted-foreground">
                              {s.value.toLocaleString()} sold · {s.pct}%
                            </div>
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Item drawer */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline">{selected.category}</Badge>
                </div>
                <SheetTitle className="font-serif text-2xl">{selected.name}</SheetTitle>
                <SheetDescription>
                  {formatItemPrice(selected)} · {selected.soldWk} sold / wk
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">
                      Recipe
                    </div>
                    <Link
                      to="/recipes"
                      search={{ item: selected.id }}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Edit recipe, cost & category →
                    </Link>
                  </div>
                  <RecipeSummary menuItemPosId={selected.id} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Stat
                    label="Margin"
                    value={
                      selected.cost != null
                        ? `$${(selected.price - selected.cost).toFixed(2)}`
                        : "—"
                    }
                  />
                  <Stat
                    label="Margin %"
                    value={
                      selected.cost != null && selected.price > 0
                        ? `${(((selected.price - selected.cost) / selected.price) * 100).toFixed(0)}%`
                        : "—"
                    }
                  />
                  <Stat label="Revenue / wk" value={usd(selected.revenueWk)} />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                    Quadrant
                  </div>
                  <div
                    className="p-3 rounded-md border text-sm"
                    style={{
                      background: `${QUAD_COLOR[quadrant(selected, popMedian, marginMedian)]}11`,
                      borderColor: `${QUAD_COLOR[quadrant(selected, popMedian, marginMedian)]}55`,
                    }}
                  >
                    {selected.cost != null ? (
                      <>
                        <strong>{quadrant(selected, popMedian, marginMedian)}</strong> — popularity{" "}
                        {selected.soldWk >= popMedian ? "above" : "below"} median, margin{" "}
                        {selected.price - selected.cost >= marginMedian ? "above" : "below"} median.
                      </>
                    ) : (
                      <>
                        Add a cost on the{" "}
                        <Link to="/recipes" search={{ item: selected.id }} className="underline">
                          Recipes page
                        </Link>{" "}
                        to classify this item.
                      </>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                    Trend note
                  </div>
                  <div className="p-3 rounded-md bg-[#fbf5ee] border border-[#e8d5b9] text-sm">
                    {selected.soldPrevWk === 0
                      ? "No prior-period sales to compare yet."
                      : selected.soldWk > selected.soldPrevWk
                        ? `Demand growing ${(((selected.soldWk - selected.soldPrevWk) / selected.soldPrevWk) * 100).toFixed(0)}%. Consider +$1 price test or feature on QR menu.`
                        : `Slipping ${(((selected.soldPrevWk - selected.soldWk) / selected.soldPrevWk) * 100).toFixed(0)}%. Try repositioning on menu or pairing with a fast attach item.`}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Kpi({
  label,
  value,
  delta,
  up,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta?: string;
  up?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className="font-serif text-2xl mt-1">{value}</div>
        </div>
        <div className="h-8 w-8 rounded-md bg-muted grid place-items-center text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {delta && (
        <div
          className={`mt-2 inline-flex items-center gap-1 text-xs ${up ? "text-[#5a7d4a]" : "text-[#a8453a]"}`}
        >
          {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {delta}
        </div>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-md border bg-muted/20">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-mono text-base mt-0.5">{value}</div>
    </div>
  );
}

// The recipe bridge — maps this menu item to the ingredients it
// consumes. Once at least one line exists, useProductMix (pos/queries.ts)
// computes this item's cost from these lines instead of the manual
// override below.
// Read-only — editing now lives on the dedicated /recipes page (see
// the "Edit recipe →" link above this component), so this drawer
// isn't a second, divergent place to add/remove recipe lines. A line
// can be a raw ingredient or a prep recipe (e.g. a house sauce).
function RecipeSummary({ menuItemPosId }: { menuItemPosId: string }) {
  const { data: lines = [], isLoading } = useRecipeLinesForItem(menuItemPosId);

  const totalCents = useMemo(() => {
    if (lines.length === 0) return null;
    let sum = 0;
    for (const l of lines) {
      if (l.ingredientId != null) {
        if (l.ingredientCostCents == null || l.ingredientUnit == null) return null;
        const converted = convertQuantityToIngredientUnit(
          l.quantity,
          l.unit,
          l.ingredientUnit,
          l.ingredientContainerSizeMl,
          l.ingredientContainerSizeG,
        );
        if (converted == null) return null;
        sum += converted * l.ingredientCostCents;
      } else {
        if (l.prepRecipeCostPerYieldUnitCents == null) return null;
        sum += l.quantity * l.prepRecipeCostPerYieldUnitCents;
      }
    }
    return Math.round(sum);
  }, [lines]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (lines.length === 0)
    return (
      <p className="text-sm text-muted-foreground">No recipe yet — add one on the Recipes page.</p>
    );

  return (
    <div className="rounded-md border divide-y">
      {lines.map((l) => {
        const isPrep = l.prepRecipeId != null;
        const name = isPrep ? l.prepRecipeName : l.ingredientName;
        const unitCostCents = isPrep ? l.prepRecipeCostPerYieldUnitCents : l.ingredientCostCents;
        const lineTotalCents =
          unitCostCents == null
            ? null
            : isPrep
              ? l.quantity * unitCostCents
              : l.ingredientUnit == null
                ? null
                : (() => {
                    const converted = convertQuantityToIngredientUnit(
                      l.quantity,
                      l.unit,
                      l.ingredientUnit,
                      l.ingredientContainerSizeMl,
                      l.ingredientContainerSizeG,
                    );
                    return converted == null ? null : converted * unitCostCents;
                  })();
        return (
          <div key={l.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <div>
                {name}
                {isPrep && (
                  <span className="ml-1.5 text-xs text-muted-foreground">(prep recipe)</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {l.quantity} {l.unit}
                {lineTotalCents != null && ` · $${(lineTotalCents / 100).toFixed(2)}`}
              </div>
            </div>
          </div>
        );
      })}
      {totalCents != null && (
        <div className="flex justify-between px-3 py-2 text-sm font-medium">
          <span>Recipe cost</span>
          <span>${(totalCents / 100).toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

// The real Toast sync job (Railway cron) runs every 10 minutes. A gap
// under ~2x that is normal jitter; anything longer is worth flagging
// rather than claiming "Connected" when the last real sync was a while
// ago.
const SYNC_HEALTHY_THRESHOLD_MIN = 20;

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------- POS sync strip ----------
function PosSyncStrip() {
  const { data: lastSyncAt } = useLastSyncTime();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { currentRestaurant } = useCurrentRestaurant();
  const { currentLocation } = useCurrentLocation();

  const minutesAgo = lastSyncAt ? (Date.now() - new Date(lastSyncAt).getTime()) / 60_000 : null;
  const healthy = minutesAgo != null && minutesAgo <= SYNC_HEALTHY_THRESHOLD_MIN;

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["product-mix"] }),
      queryClient.invalidateQueries({ queryKey: ["sales-trend"] }),
      queryClient.invalidateQueries({ queryKey: ["order-count"] }),
      queryClient.invalidateQueries({ queryKey: ["last-sync-time"] }),
    ]);
    setRefreshing(false);
  };

  return (
    <Card className="p-4 border-[#e6dfd2] bg-[#fbf7f0]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-md bg-[#ff4f00]/10 text-[#ff4f00] grid place-items-center">
            <Plug className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Toast POS</span>
              {lastSyncAt == null ? (
                <Badge variant="outline" className="gap-1 border-stone-300 text-stone-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-stone-400" /> No sync data yet
                </Badge>
              ) : healthy ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-[#87a878]/40 text-[#5a7d4a] bg-[#87a878]/10"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#5a7d4a]" /> Connected
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-300 text-amber-800 bg-amber-50"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Sync delayed
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-3 mt-0.5">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Last sync {lastSyncAt ? timeAgo(lastSyncAt) : "never"}
              </span>
              <span>· Syncs every 10 min</span>
              <span>
                · {currentRestaurant?.name ?? "…"} — {currentLocation?.name ?? "…"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
