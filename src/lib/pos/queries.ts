import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PostgrestError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase/client";
import { useLocationIds } from "@/lib/supabase/scope";
import { type DateRange, addDays, isoDate } from "@/lib/date-range";

// PostgREST caps an unpaginated read at 1000 rows. pmix_sales and
// pos_raw_events both scale with days-in-range × (menu items or
// orders), so a query that was safely under 1000 rows at a 7-day
// window can silently truncate — without an explicit order, to an
// arbitrary, non-deterministic subset — once the date-range filter
// grows past a week. Page through every matching row instead of
// trusting a single request to return everything.
const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  makeQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await makeQuery(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    all.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

// The Toast sync job pulls fresh orders every ~10 minutes, but without
// an explicit refetchInterval, React Query only refetches on mount or
// window refocus — a dashboard left open just sits frozen even as new
// sales land server-side. 60s keeps Product Mix genuinely live without
// hammering the DB.
const LIVE_REFETCH_INTERVAL_MS = 60_000;

// Real "last sync" signal for the PosSyncStrip — the Railway toast-sync
// cron job runs every 10 minutes and touches pmix_sales on every run
// (even a 0-order run still upserts menu_items/updates rows), so its
// most recent updated_at is an honest proxy for "when did the last
// sync actually happen" without needing a dedicated sync-log table.
export function useLastSyncTime() {
  const { data: locationIds } = useLocationIds();
  return useQuery({
    queryKey: ["last-sync-time", locationIds],
    enabled: !!locationIds && locationIds.length > 0,
    refetchInterval: LIVE_REFETCH_INTERVAL_MS,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("pmix_sales")
        .select("updated_at")
        .in("location_id", locationIds!)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.updated_at ?? null;
    },
  });
}

export type RealMenuItem = {
  id: string;
  locationId: string;
  name: string;
  category: string;
  price: number;
  cost?: number;
  soldWk: number;
  soldPrevWk: number;
  // Real dollars Toast recorded for this item's sales (pmix_sales.net_sales_cents),
  // not price x quantity — diverges from that whenever price changed, or a sale
  // had a discount/comp/modifier surcharge. Use this for revenue, never price*qty.
  revenueWk: number;
  revenuePrevWk: number;
};

// Popularity across the selected range vs. the immediately preceding
// period of equal length, joined against the current menu + cost.
// Cost prefers the real recipe bridge (sum of recipe_lines quantity x
// ingredient cost) when an item has one, falling back to the manual
// per-item override, then undefined ("Unpriced") if neither exists yet.
export function useProductMix(range: DateRange) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["product-mix", locationIds, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0,
    refetchInterval: LIVE_REFETCH_INTERVAL_MS,
    queryFn: async (): Promise<RealMenuItem[]> => {
      const periodDays = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1;
      const prevTo = addDays(range.from, -1);
      const prevFrom = addDays(prevTo, -(periodDays - 1));
      const prevFromIso = isoDate(prevFrom);
      const prevToIso = isoDate(prevTo);

      const [menuItemsRes, currentRows, prevRows, recipeRes] = await Promise.all([
        supabase
          .from("menu_items")
          .select("pos_id, location_id, name, category, price_cents, cost_cents")
          .in("location_id", locationIds!)
          .eq("active", true),
        fetchAllRows((from, to) =>
          supabase
            .from("pmix_sales")
            .select("menu_item_pos_id, quantity_sold, net_sales_cents")
            .in("location_id", locationIds!)
            .gte("business_date", fromIso)
            .lte("business_date", toIso)
            .order("business_date", { ascending: true })
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabase
            .from("pmix_sales")
            .select("menu_item_pos_id, quantity_sold, net_sales_cents")
            .in("location_id", locationIds!)
            .gte("business_date", prevFromIso)
            .lte("business_date", prevToIso)
            .order("business_date", { ascending: true })
            .range(from, to),
        ),
        supabase
          .from("recipe_lines")
          .select("menu_item_pos_id, quantity, ingredients (unit_cost_cents)")
          .in("location_id", locationIds!),
      ]);
      if (menuItemsRes.error) throw menuItemsRes.error;
      if (recipeRes.error) throw recipeRes.error;

      const sumQtyBy = (rows: { menu_item_pos_id: string; quantity_sold: number }[]) => {
        const map = new Map<string, number>();
        for (const r of rows)
          map.set(r.menu_item_pos_id, (map.get(r.menu_item_pos_id) ?? 0) + Number(r.quantity_sold));
        return map;
      };
      const sumRevenueBy = (rows: { menu_item_pos_id: string; net_sales_cents: number }[]) => {
        const map = new Map<string, number>();
        for (const r of rows)
          map.set(
            r.menu_item_pos_id,
            (map.get(r.menu_item_pos_id) ?? 0) + Number(r.net_sales_cents),
          );
        return map;
      };
      const current = sumQtyBy(currentRows);
      const prev = sumQtyBy(prevRows);
      const currentRevenueCents = sumRevenueBy(currentRows);
      const prevRevenueCents = sumRevenueBy(prevRows);

      const recipeCostCents = new Map<string, number>();
      for (const row of (recipeRes.data ?? []) as any[]) {
        const unitCost = row.ingredients?.unit_cost_cents;
        if (unitCost == null) continue; // an ingredient with no cost yet can't total this item
        const cur = recipeCostCents.get(row.menu_item_pos_id) ?? 0;
        recipeCostCents.set(row.menu_item_pos_id, cur + Number(row.quantity) * unitCost);
      }

      return (menuItemsRes.data ?? []).map((m) => {
        const recipeCents = recipeCostCents.get(m.pos_id);
        const costCents = recipeCents ?? m.cost_cents ?? undefined;
        return {
          id: m.pos_id,
          locationId: m.location_id,
          name: m.name,
          category: m.category ?? "Uncategorized",
          price: (m.price_cents ?? 0) / 100,
          cost: costCents != null ? costCents / 100 : undefined,
          soldWk: current.get(m.pos_id) ?? 0,
          soldPrevWk: prev.get(m.pos_id) ?? 0,
          revenueWk: (currentRevenueCents.get(m.pos_id) ?? 0) / 100,
          revenuePrevWk: (prevRevenueCents.get(m.pos_id) ?? 0) / 100,
        };
      });
    },
  });
}

export function useUpdateItemCost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      locationId,
      posId,
      costCents,
    }: {
      locationId: string;
      posId: string;
      costCents: number | null;
    }) => {
      const { error } = await supabase
        .from("menu_items")
        .update({ cost_cents: costCents })
        .eq("location_id", locationId)
        .eq("pos_id", posId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-mix"] }),
  });
}

// Theoretical food cost (what the recipe says it should have cost)
// vs actual spend (from approved invoices) for the period — the
// headline back-of-house metric. Theoretical understates reality
// while recipe_lines are incomplete for the menu, which is why
// hasRecipeData/itemsMissingRecipeCount are surfaced separately
// rather than silently showing a too-good-to-be-true percentage.
export type FoodCostSummary = {
  periodDays: number;
  theoreticalCostCents: number;
  netSalesCents: number;
  theoreticalPct: number | null;
  actualSpendCents: number;
  actualPct: number | null;
  variancePct: number | null;
  varianceCents: number;
  hasRecipeData: boolean;
  itemsMissingRecipeCount: number;
};

export function useFoodCostSummary(range: DateRange) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["food-cost-summary", locationIds, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<FoodCostSummary> => {
      const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1;

      const [salesData, recipeRes, invoicesRes] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase
            .from("pmix_sales")
            .select("menu_item_pos_id, quantity_sold, net_sales_cents")
            .in("location_id", locationIds!)
            .gte("business_date", fromIso)
            .lte("business_date", toIso)
            .order("business_date", { ascending: true })
            .range(from, to),
        ),
        supabase
          .from("recipe_lines")
          .select("menu_item_pos_id, quantity, ingredients (unit_cost_cents)")
          .in("location_id", locationIds!),
        supabase
          .from("invoices")
          .select("total_cents")
          .in("location_id", locationIds!)
          .eq("status", "approved")
          .gte("invoice_date", fromIso)
          .lte("invoice_date", toIso),
      ]);
      if (recipeRes.error) throw recipeRes.error;
      if (invoicesRes.error) throw invoicesRes.error;

      type RecipeRow = {
        menu_item_pos_id: string;
        quantity: number;
        ingredients: { unit_cost_cents: number | null } | null;
      };
      const recipeCostPerUnit = new Map<string, number>();
      for (const row of (recipeRes.data ?? []) as unknown as RecipeRow[]) {
        const unitCost = row.ingredients?.unit_cost_cents;
        if (unitCost == null) continue;
        const cur = recipeCostPerUnit.get(row.menu_item_pos_id) ?? 0;
        recipeCostPerUnit.set(row.menu_item_pos_id, cur + Number(row.quantity) * unitCost);
      }

      let theoreticalCostCents = 0;
      let netSalesCents = 0;
      const itemsMissing = new Set<string>();
      for (const row of salesData) {
        netSalesCents += Number(row.net_sales_cents);
        const perUnit = recipeCostPerUnit.get(row.menu_item_pos_id);
        if (perUnit == null) {
          itemsMissing.add(row.menu_item_pos_id);
          continue;
        }
        theoreticalCostCents += perUnit * Number(row.quantity_sold);
      }

      const approvedInvoices = invoicesRes.data ?? [];
      const actualSpendCents = approvedInvoices.reduce(
        (sum, inv) => sum + (inv.total_cents ?? 0),
        0,
      );
      // Zero approved invoices this period means "we don't know actual
      // spend," not "actual spend is $0" — treating it as a real 0
      // would make every un-invoiced period look like a favorable
      // variance instead of no-data.
      const hasInvoiceData = approvedInvoices.length > 0;

      const hasRecipeData = recipeCostPerUnit.size > 0;
      const theoreticalPct =
        hasRecipeData && netSalesCents > 0 ? (theoreticalCostCents / netSalesCents) * 100 : null;
      const actualPct =
        hasInvoiceData && netSalesCents > 0 ? (actualSpendCents / netSalesCents) * 100 : null;
      const variancePct =
        theoreticalPct != null && actualPct != null ? actualPct - theoreticalPct : null;

      return {
        periodDays: days,
        theoreticalCostCents,
        netSalesCents,
        theoreticalPct,
        actualSpendCents,
        actualPct,
        variancePct,
        varianceCents: actualSpendCents - theoreticalCostCents,
        hasRecipeData,
        itemsMissingRecipeCount: itemsMissing.size,
      };
    },
  });
}

export type DailyRevenue = { day: string; revenue: number; lastWeek: number };

// One point per day across the selected range, each paired with the
// same weekday one week earlier for a like-for-like comparison line.
export function useSalesTrend(range: DateRange) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["sales-trend", locationIds, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0,
    refetchInterval: LIVE_REFETCH_INTERVAL_MS,
    queryFn: async (): Promise<DailyRevenue[]> => {
      const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1;
      // Fetch an extra 7 days before `from` too, so the "same day last
      // week" comparison line has data for the earliest days shown.
      const fetchStart = isoDate(addDays(range.from, -7));
      const data = await fetchAllRows((from, to) =>
        supabase
          .from("pmix_sales")
          .select("business_date, net_sales_cents")
          .in("location_id", locationIds!)
          .gte("business_date", fetchStart)
          .lte("business_date", toIso)
          .order("business_date", { ascending: true })
          .range(from, to),
      );

      const byDate = new Map<string, number>();
      for (const r of data)
        byDate.set(r.business_date, (byDate.get(r.business_date) ?? 0) + Number(r.net_sales_cents));

      const out: DailyRevenue[] = [];
      for (let i = 0; i < days; i++) {
        const d = addDays(range.from, i);
        const key = isoDate(d);
        const lastWeekKey = isoDate(addDays(d, -7));
        out.push({
          // Weekday-only labels ("Mon", "Tue"...) repeat and become
          // ambiguous once the range exceeds a week — switch to a
          // dated label ("Jul 5") beyond 7 days.
          day:
            days <= 7
              ? d.toLocaleDateString("en-US", { weekday: "short" })
              : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          revenue: (byDate.get(key) ?? 0) / 100,
          lastWeek: (byDate.get(lastWeekKey) ?? 0) / 100,
        });
      }
      return out;
    },
  });
}

// Approximates check count via raw order events (one row per Toast
// order) — not a precise "check" count (an order can have >1 check),
// but far more honest than a guessed items-per-check ratio.
export function useOrderCount(range: DateRange) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["order-count", locationIds, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0,
    refetchInterval: LIVE_REFETCH_INTERVAL_MS,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("pos_raw_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "order")
        .in("location_id", locationIds!)
        .gte("business_date", fromIso)
        .lte("business_date", toIso);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export type ChannelMixSlice = { name: string; value: number; amountCents: number };

// Real revenue by Toast revenue center (Bar/Dining Room/Patio/Online
// Ordering, etc.) — sums each real order's check total(s) from the
// raw payload sync already stores, grouped by revenueCenter.guid and
// labeled via pos_revenue_centers (synced from Toast's own config
// API — see sync/src/toast.ts's fetchRevenueCenters). Deliberately
// NOT diningOption (Dine In/Takeout/Delivery) — real data showed that
// field populated on well under 5% of this restaurant's real orders,
// too sparse to be a meaningful breakdown.
export function useChannelMix(range: DateRange) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["channel-mix", locationIds, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<ChannelMixSlice[]> => {
      const [orders, centersRes] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase
            .from("pos_raw_events")
            .select("payload")
            .eq("event_type", "order")
            .in("location_id", locationIds!)
            .gte("business_date", fromIso)
            .lte("business_date", toIso)
            .order("business_date", { ascending: true })
            .range(from, to),
        ),
        supabase
          .from("pos_revenue_centers")
          .select("pos_guid, name")
          .in("location_id", locationIds!),
      ]);
      if (centersRes.error) throw centersRes.error;

      const nameByGuid = new Map(
        (centersRes.data ?? []).map((c) => [c.pos_guid, c.name as string]),
      );

      type RawOrder = {
        deleted?: boolean;
        voided?: boolean;
        revenueCenter?: { guid: string } | null;
        checks?: { deleted?: boolean; voided?: boolean; totalAmount?: number }[];
      };

      const centsByGuid = new Map<string, number>();
      for (const row of orders) {
        const order = row.payload as RawOrder;
        if (order.deleted || order.voided) continue;
        const guid = order.revenueCenter?.guid ?? "unknown";
        let orderCents = 0;
        for (const check of order.checks ?? []) {
          if (check.deleted || check.voided) continue;
          orderCents += Math.round((check.totalAmount ?? 0) * 100);
        }
        centsByGuid.set(guid, (centsByGuid.get(guid) ?? 0) + orderCents);
      }

      const totalCents = Array.from(centsByGuid.values()).reduce((s, c) => s + c, 0);
      if (totalCents === 0) return [];

      return Array.from(centsByGuid.entries())
        .map(([guid, amountCents]) => ({
          name: nameByGuid.get(guid) ?? "Other",
          amountCents,
          value: (amountCents / totalCents) * 100,
        }))
        .sort((a, b) => b.amountCents - a.amountCents);
    },
  });
}

export type TopItem = { name: string; sold: number; revenue: number };

export function useTopItems(range: DateRange, limit = 5) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["top-items", locationIds, fromIso, toIso, limit],
    enabled: !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<TopItem[]> => {
      const data = await fetchAllRows((from, to) =>
        supabase
          .from("pmix_sales")
          .select("name, quantity_sold, net_sales_cents")
          .in("location_id", locationIds!)
          .gte("business_date", fromIso)
          .lte("business_date", toIso)
          .order("business_date", { ascending: true })
          .range(from, to),
      );

      const map = new Map<string, TopItem>();
      for (const r of data) {
        const cur = map.get(r.name) ?? { name: r.name, sold: 0, revenue: 0 };
        cur.sold += Number(r.quantity_sold);
        cur.revenue += Number(r.net_sales_cents) / 100;
        map.set(r.name, cur);
      }
      return Array.from(map.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit);
    },
  });
}

export type OrderModifier = { name: string; priceCents: number; quantity: number };
export type OrderItem = {
  name: string;
  priceCents: number;
  quantity: number;
  modifiers: OrderModifier[];
};
export type RealOrderDetail = {
  guid: string;
  openedAt: string;
  totalCents: number;
  items: OrderItem[];
};

// Real per-order detail (real open timestamp, real items, real
// modifiers — all straight from the raw Toast payload, since
// pmix_sales' daily aggregates don't carry time-of-day or modifier
// data) for the selected range. Powers Product Mix's Dayparts and
// Modifiers & attach tabs.
export function useOrderDetails(range: DateRange) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["order-details", locationIds, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<{ timezone: string; orders: RealOrderDetail[] }> => {
      const [ordersRows, locRes] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase
            .from("pos_raw_events")
            .select("payload")
            .eq("event_type", "order")
            .in("location_id", locationIds!)
            .gte("business_date", fromIso)
            .lte("business_date", toIso)
            .order("business_date", { ascending: true })
            .range(from, to),
        ),
        supabase.from("locations").select("timezone").in("id", locationIds!).limit(1).maybeSingle(),
      ]);
      if (locRes.error) throw locRes.error;
      const timezone = locRes.data?.timezone ?? "America/Los_Angeles";

      type RawModifier = {
        displayName?: string;
        price?: number;
        quantity?: number;
        voided?: boolean;
      };
      type RawSelection = {
        displayName?: string;
        price?: number;
        quantity?: number;
        voided?: boolean;
        modifiers?: RawModifier[];
      };
      type RawCheck = {
        totalAmount?: number;
        deleted?: boolean;
        voided?: boolean;
        selections?: RawSelection[];
      };
      type RawOrder = {
        guid: string;
        openedDate?: string;
        deleted?: boolean;
        voided?: boolean;
        checks?: RawCheck[];
      };

      const orders: RealOrderDetail[] = [];
      for (const row of ordersRows) {
        const o = row.payload as RawOrder;
        if (o.deleted || o.voided || !o.openedDate) continue;
        let totalCents = 0;
        const items: OrderItem[] = [];
        for (const check of o.checks ?? []) {
          if (check.deleted || check.voided) continue;
          totalCents += Math.round((check.totalAmount ?? 0) * 100);
          for (const sel of check.selections ?? []) {
            if (sel.voided) continue;
            items.push({
              name: sel.displayName ?? "Unknown item",
              priceCents: Math.round((sel.price ?? 0) * 100),
              quantity: sel.quantity ?? 1,
              modifiers: (sel.modifiers ?? [])
                .filter((m) => !m.voided)
                .map((m) => ({
                  name: m.displayName ?? "Unknown modifier",
                  priceCents: Math.round((m.price ?? 0) * 100),
                  quantity: m.quantity ?? 1,
                })),
            });
          }
        }
        orders.push({ guid: o.guid, openedAt: o.openedDate, totalCents, items });
      }
      return { timezone, orders };
    },
  });
}

export type ItemTrendSeries = {
  items: string[];
  series: Record<string, string | number>[];
  // Real dollars per top item, summed across the whole selected range
  // (not broken out by bucket like `series` — the donut/share view
  // needs one total per item, not a time series).
  revenueCents: Record<string, number>;
};

// Real velocity per top item across the selected range — daily
// buckets for shorter ranges, weekly buckets once the range is wide
// enough that daily points would be too dense to read.
export function useItemTrend(range: DateRange, topN = 5) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["item-trend", locationIds, fromIso, toIso, topN],
    enabled: !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<ItemTrendSeries> => {
      const rows = await fetchAllRows((from, to) =>
        supabase
          .from("pmix_sales")
          .select("business_date, name, quantity_sold, net_sales_cents")
          .in("location_id", locationIds!)
          .gte("business_date", fromIso)
          .lte("business_date", toIso)
          .order("business_date", { ascending: true })
          .range(from, to),
      );

      const totals = new Map<string, number>();
      for (const r of rows) totals.set(r.name, (totals.get(r.name) ?? 0) + Number(r.quantity_sold));
      const top = Array.from(totals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([name]) => name);
      const topSet = new Set(top);

      // Real net sales dollars (Toast's actual recorded revenue,
      // reflecting discounts/comps — never price × quantity), summed
      // once per top item across the whole range.
      const revenueCents: Record<string, number> = {};
      for (const r of rows) {
        if (!topSet.has(r.name)) continue;
        revenueCents[r.name] = (revenueCents[r.name] ?? 0) + Number(r.net_sales_cents);
      }

      const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1;
      const useWeekly = days > 21;

      // Monday-start week bucket key, in local (UTC, since
      // business_date is a plain date) terms — good enough for
      // grouping, this isn't timezone-sensitive like Dayparts is.
      const weekStart = (d: Date): string => {
        const day = d.getUTCDay();
        const diff = (day + 6) % 7; // days since Monday
        const monday = new Date(d);
        monday.setUTCDate(d.getUTCDate() - diff);
        return isoDate(monday);
      };

      const byBucket = new Map<string, Map<string, number>>();
      for (const r of rows) {
        if (!topSet.has(r.name)) continue;
        const d = new Date(`${r.business_date}T00:00:00Z`);
        const bucketKey = useWeekly ? weekStart(d) : r.business_date;
        const m = byBucket.get(bucketKey) ?? new Map<string, number>();
        m.set(r.name, (m.get(r.name) ?? 0) + Number(r.quantity_sold));
        byBucket.set(bucketKey, m);
      }

      const series = Array.from(byBucket.keys())
        .sort()
        .map((key) => {
          const m = byBucket.get(key)!;
          // Parsed as UTC and must be formatted as UTC too, or a
          // browser/server local timezone behind UTC renders the
          // wrong (previous) calendar day.
          const label = new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });
          const point: Record<string, string | number> = { bucket: label };
          for (const name of top) point[name] = m.get(name) ?? 0;
          return point;
        });

      return { items: top, series, revenueCents };
    },
  });
}
