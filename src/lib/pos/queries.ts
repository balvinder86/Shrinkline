import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PostgrestError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase/client";
import { useLocationIds } from "@/lib/supabase/scope";
import { type DateRange, addDays, isoDate } from "@/lib/date-range";
import {
  resolveMenuItemRecipeCostCents,
  type IngredientCostInfo,
  type PrepRecipeLineRow,
  type RecipeLineRow,
} from "@/lib/boh/recipeCost";

type IngredientCostJoin = {
  unit_cost_cents: number | null;
  unit: string;
  container_size_ml: number | null;
  container_size_g: number | null;
} | null;

// Shared by useProductMix and useFoodCostSummary — fetches everything
// the recursive cost resolver needs (recipe_lines for these locations'
// menu items, every prep_recipe reachable from them, and every
// ingredient cost referenced anywhere in that graph) and returns it
// pre-shaped as the Maps resolveMenuItemRecipeCostCents expects.
export async function fetchRecipeCostContext(locationIds: string[]) {
  const [recipeLinesRes, prepRecipeLinesRes, prepRecipesRes] = await Promise.all([
    supabase
      .from("recipe_lines")
      .select(
        "menu_item_pos_id, ingredient_id, prep_recipe_id, quantity, unit, ingredients (unit_cost_cents, unit, container_size_ml, container_size_g)",
      )
      .in("location_id", locationIds),
    // prep_recipe_lines has two FKs into prep_recipes (the owning
    // recipe via prep_recipe_id, and the referenced sub-recipe via
    // sub_prep_recipe_id) — PostgREST can't infer which one a bare
    // "prep_recipes(...)" embed means, so the owning relationship is
    // disambiguated explicitly via the column name, aliased as
    // `owner` for the location-scoping filter below.
    supabase
      .from("prep_recipe_lines")
      .select(
        "prep_recipe_id, ingredient_id, sub_prep_recipe_id, quantity, unit, ingredients (unit_cost_cents, unit, container_size_ml, container_size_g), owner:prep_recipes!prep_recipe_id!inner(location_id)",
      )
      .in("owner.location_id", locationIds),
    supabase.from("prep_recipes").select("id, yield_qty").in("location_id", locationIds),
  ]);
  if (recipeLinesRes.error) throw recipeLinesRes.error;
  if (prepRecipeLinesRes.error) throw prepRecipeLinesRes.error;
  if (prepRecipesRes.error) throw prepRecipesRes.error;

  type RecipeLineDbRow = {
    menu_item_pos_id: string;
    ingredient_id: string | null;
    prep_recipe_id: string | null;
    quantity: number;
    unit: string;
    ingredients: IngredientCostJoin;
  };
  type PrepRecipeLineDbRow = {
    prep_recipe_id: string;
    ingredient_id: string | null;
    sub_prep_recipe_id: string | null;
    quantity: number;
    unit: string;
    ingredients: IngredientCostJoin;
  };

  const recipeLinesData = (recipeLinesRes.data ?? []) as unknown as RecipeLineDbRow[];
  const prepRecipeLinesData = (prepRecipeLinesRes.data ?? []) as unknown as PrepRecipeLineDbRow[];

  const ingredientById = new Map<string, IngredientCostInfo | undefined>();
  for (const row of recipeLinesData) {
    if (row.ingredient_id && row.ingredients)
      ingredientById.set(row.ingredient_id, {
        unitCostCents: row.ingredients.unit_cost_cents,
        unit: row.ingredients.unit,
        containerSizeMl: row.ingredients.container_size_ml,
        containerSizeG: row.ingredients.container_size_g,
      });
  }
  for (const row of prepRecipeLinesData) {
    if (row.ingredient_id && row.ingredients)
      ingredientById.set(row.ingredient_id, {
        unitCostCents: row.ingredients.unit_cost_cents,
        unit: row.ingredients.unit,
        containerSizeMl: row.ingredients.container_size_ml,
        containerSizeG: row.ingredients.container_size_g,
      });
  }

  const prepRecipeLinesByPrepId = new Map<string, PrepRecipeLineRow[]>();
  for (const row of prepRecipeLinesData) {
    const list = prepRecipeLinesByPrepId.get(row.prep_recipe_id) ?? [];
    list.push({
      prep_recipe_id: row.prep_recipe_id,
      ingredient_id: row.ingredient_id,
      sub_prep_recipe_id: row.sub_prep_recipe_id,
      quantity: Number(row.quantity),
      unit: row.unit,
    });
    prepRecipeLinesByPrepId.set(row.prep_recipe_id, list);
  }

  const prepRecipeYieldById = new Map(
    (prepRecipesRes.data ?? []).map((r) => [r.id as string, Number(r.yield_qty)]),
  );

  const recipeLinesByMenuItem = new Map<string, RecipeLineRow[]>();
  for (const row of recipeLinesData) {
    const list = recipeLinesByMenuItem.get(row.menu_item_pos_id) ?? [];
    list.push({
      ingredient_id: row.ingredient_id,
      prep_recipe_id: row.prep_recipe_id,
      quantity: Number(row.quantity),
      unit: row.unit,
    });
    recipeLinesByMenuItem.set(row.menu_item_pos_id, list);
  }

  // Reverse indexes — "which menu items / prep recipes actually use
  // this prep recipe" — so the Prep recipes list can show real usage
  // instead of leaving a created-but-unattached prep recipe looking
  // identical to one that's actually rolled into real dishes.
  const menuItemsUsingPrepRecipe = new Map<string, Set<string>>();
  for (const row of recipeLinesData) {
    if (!row.prep_recipe_id) continue;
    const set = menuItemsUsingPrepRecipe.get(row.prep_recipe_id) ?? new Set<string>();
    set.add(row.menu_item_pos_id);
    menuItemsUsingPrepRecipe.set(row.prep_recipe_id, set);
  }
  const prepRecipesUsingPrepRecipe = new Map<string, Set<string>>();
  for (const row of prepRecipeLinesData) {
    if (!row.sub_prep_recipe_id) continue;
    const set = prepRecipesUsingPrepRecipe.get(row.sub_prep_recipe_id) ?? new Set<string>();
    set.add(row.prep_recipe_id);
    prepRecipesUsingPrepRecipe.set(row.sub_prep_recipe_id, set);
  }

  return {
    recipeLinesByMenuItem,
    prepRecipeLinesByPrepId,
    prepRecipeYieldById,
    ingredientById,
    menuItemsUsingPrepRecipe,
    prepRecipesUsingPrepRecipe,
  };
}

function resolveItemCostCents(
  menuItemPosId: string,
  ctx: Awaited<ReturnType<typeof fetchRecipeCostContext>>,
): number | null {
  return resolveMenuItemRecipeCostCents(
    ctx.recipeLinesByMenuItem.get(menuItemPosId) ?? [],
    ctx.prepRecipeLinesByPrepId,
    ctx.prepRecipeYieldById,
    ctx.ingredientById,
  );
}

// PostgREST caps an unpaginated read at 1000 rows. pmix_sales and
// pos_raw_events both scale with days-in-range × (menu items or
// orders), so a query that was safely under 1000 rows at a 7-day
// window can silently truncate — without an explicit order, to an
// arbitrary, non-deterministic subset — once the date-range filter
// grows past a week. Page through every matching row instead of
// trusting a single request to return everything.
const SUPABASE_PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
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
  // Resolved: the manual override when one's been set, otherwise
  // whatever Toast's own sync last wrote. Everything that filters/
  // displays a menu item's category should use this.
  category: string;
  // Toast's own real category, ignoring any manual override — shown
  // in the edit UI so a reset-to-POS-value action has something real
  // to reset to, and so it's clear when a category is manually pinned.
  rawCategory: string;
  categoryOverride: string | null;
  price: number;
  // True when `price` is a single, fixed real Toast catalog price. False
  // when the item has no single price and is instead priced via a Toast
  // "size" modifier group (e.g. well-pour Single/Double) — `price` is
  // then the cheapest of the item's real, currently-configured size
  // prices, a genuine "starting price" rather than a fixed one. Also
  // false (with price 0) when there's no price data at all.
  hasRealPrice: boolean;
  cost?: number;
  // True only when `cost` came from actual recipe_lines rows, false when
  // it's the manual menu_items.cost_cents fallback (or absent). The
  // Recipes page needs this to avoid showing a "Cost" figure for an item
  // that, once opened, turns out to have no recipe at all.
  hasRecipe: boolean;
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

      const [menuItemsRes, currentRows, prevRows, recipeCostCtx] = await Promise.all([
        supabase
          .from("menu_items")
          .select(
            "pos_id, location_id, name, category, category_override, price_cents, price_is_starting_price, cost_cents",
          )
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
        fetchRecipeCostContext(locationIds!),
      ]);
      if (menuItemsRes.error) throw menuItemsRes.error;

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

      return (menuItemsRes.data ?? []).map((m) => {
        const recipeCents = resolveItemCostCents(m.pos_id, recipeCostCtx);
        const costCents = recipeCents ?? m.cost_cents ?? undefined;
        return {
          id: m.pos_id,
          locationId: m.location_id,
          name: m.name,
          category: m.category_override ?? m.category ?? "Uncategorized",
          rawCategory: m.category ?? "Uncategorized",
          categoryOverride: m.category_override,
          price: (m.price_cents ?? 0) / 100,
          hasRealPrice: m.price_cents != null && !m.price_is_starting_price,
          cost: costCents != null ? costCents / 100 : undefined,
          hasRecipe: recipeCents != null,
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

// Writes to category_override, never the raw category column Toast's
// own sync owns — see db/phase2/52_menu_item_category_override.sql
// for why a plain overwrite of menu_items.category would get silently
// reverted by the next real sync. Pass null to clear the override and
// fall back to whatever Toast itself has the item categorized as.
export function useUpdateItemCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      locationId,
      posId,
      category,
    }: {
      locationId: string;
      posId: string;
      category: string | null;
    }) => {
      const { error } = await supabase
        .from("menu_items")
        .update({ category_override: category })
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

      const [salesData, recipeCostCtx, invoicesRes] = await Promise.all([
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
        fetchRecipeCostContext(locationIds!),
        // Inner-joined to vendors and filtered to food_beverage so a
        // utility/maintenance/rent bill can't inflate "actual food
        // spend" — see feedback_thrasherspub_ui_preferences /
        // project_thrasherspub_saas memory on the vendor-category fix.
        supabase
          .from("invoices")
          .select("total_cents, vendors!inner(category)")
          .in("location_id", locationIds!)
          .eq("status", "approved")
          .eq("vendors.category", "food_beverage")
          .gte("invoice_date", fromIso)
          .lte("invoice_date", toIso),
      ]);
      if (invoicesRes.error) throw invoicesRes.error;

      // Resolved once per menu item (recursing through any prep
      // recipes it uses), then reused for every sold unit of that item.
      const itemCostCentsById = new Map<string, number | null>();
      for (const menuItemPosId of recipeCostCtx.recipeLinesByMenuItem.keys()) {
        itemCostCentsById.set(menuItemPosId, resolveItemCostCents(menuItemPosId, recipeCostCtx));
      }

      let theoreticalCostCents = 0;
      let netSalesCents = 0;
      const itemsMissing = new Set<string>();
      for (const row of salesData) {
        netSalesCents += Number(row.net_sales_cents);
        const perUnit = itemCostCentsById.get(row.menu_item_pos_id);
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

      const hasRecipeData = Array.from(itemCostCentsById.values()).some((c) => c != null);
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
