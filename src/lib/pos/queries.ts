import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PostgrestError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase/client";
import { useLocationIds, useRestaurantIds } from "@/lib/supabase/scope";
import { type DateRange, addDays, isoDate } from "@/lib/date-range";
import {
  resolveMenuItemRecipeCostCents,
  accumulateMenuItemIngredientUsage,
  accumulateMenuItemIngredientQuantity,
  type IngredientCostInfo,
  type PrepRecipeLineRow,
  type RecipeLineRow,
} from "@/lib/boh/recipeCost";
import { convertQuantityToIngredientUnit } from "@/lib/units";

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
        "menu_item_pos_id, ingredient_id, prep_recipe_id, price_tier_id, quantity, unit, ingredients (unit_cost_cents, unit, container_size_ml, container_size_g)",
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
    price_tier_id: string | null;
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

  // "The" recipe for an item — null price_tier_id, exactly what every
  // existing real row already is. Deliberately excludes tiered rows
  // (a bottle/pint/pitcher each have their own separate recipe now)
  // so this map's meaning is unchanged for the vast majority of items
  // that have no tiers at all.
  const recipeLinesByMenuItem = new Map<string, RecipeLineRow[]>();
  // One recipe PER size tier — keyed "posId::tierId" — for items that
  // sell at more than one real price (see 63_menu_item_price_tiers.sql).
  const recipeLinesByMenuItemAndTier = new Map<string, RecipeLineRow[]>();
  for (const row of recipeLinesData) {
    const line: RecipeLineRow = {
      ingredient_id: row.ingredient_id,
      prep_recipe_id: row.prep_recipe_id,
      quantity: Number(row.quantity),
      unit: row.unit,
    };
    if (row.price_tier_id == null) {
      const list = recipeLinesByMenuItem.get(row.menu_item_pos_id) ?? [];
      list.push(line);
      recipeLinesByMenuItem.set(row.menu_item_pos_id, list);
    } else {
      const key = `${row.menu_item_pos_id}::${row.price_tier_id}`;
      const list = recipeLinesByMenuItemAndTier.get(key) ?? [];
      list.push(line);
      recipeLinesByMenuItemAndTier.set(key, list);
    }
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
    recipeLinesByMenuItemAndTier,
    prepRecipeLinesByPrepId,
    prepRecipeYieldById,
    ingredientById,
    menuItemsUsingPrepRecipe,
    prepRecipesUsingPrepRecipe,
  };
}

// Base cost — the item's single, untiered recipe (recipe_lines rows
// with price_tier_id null). Used as-is for the vast majority of items,
// and as the fallback for a tiered item whose per-tier recipes aren't
// fully built out yet (see resolveItemCostCents).
function resolveBaseCostCents(
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

// Weighted-average cost across a menu item's actually-sold tiers for
// whatever period tierQtyById was built from — e.g. Coors Lt sold as
// 40 bottles + 15 pints + 3 pitchers gets a cost that reflects that mix,
// instead of one flat number based on whichever tier happens to be
// cheapest. Per the "never silently wrong" rule used throughout this
// feature: if ANY tier with sold quantity > 0 lacks its own costed
// recipe, this returns null rather than a partial/misleading blend —
// callers fall back to resolveBaseCostCents in that case.
function resolveBlendedTierCostCents(
  menuItemPosId: string,
  tierQtyById: Map<string, number>,
  ctx: Awaited<ReturnType<typeof fetchRecipeCostContext>>,
): number | null {
  let totalQty = 0;
  let totalCostCents = 0;
  for (const [tierId, qty] of tierQtyById) {
    if (qty <= 0) continue;
    const lines = ctx.recipeLinesByMenuItemAndTier.get(`${menuItemPosId}::${tierId}`);
    if (!lines || lines.length === 0) return null;
    const tierCostCents = resolveMenuItemRecipeCostCents(
      lines,
      ctx.prepRecipeLinesByPrepId,
      ctx.prepRecipeYieldById,
      ctx.ingredientById,
    );
    if (tierCostCents == null) return null;
    totalQty += qty;
    totalCostCents += tierCostCents * qty;
  }
  if (totalQty === 0) return null;
  return Math.round(totalCostCents / totalQty);
}

// Prefers the blended per-tier cost (the accurate figure) whenever the
// item actually sold across tiers in this period AND every one of
// those tiers has its own recipe; otherwise falls back to the item's
// base/untiered recipe — better than showing nothing while a tiered
// item's per-size recipes are still being built out.
function resolveItemCostCents(
  menuItemPosId: string,
  ctx: Awaited<ReturnType<typeof fetchRecipeCostContext>>,
  tierQtyById?: Map<string, number>,
): number | null {
  if (tierQtyById && tierQtyById.size > 0) {
    const blended = resolveBlendedTierCostCents(menuItemPosId, tierQtyById, ctx);
    if (blended != null) return blended;
  }
  return resolveBaseCostCents(menuItemPosId, ctx);
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
  // A "don't show me this on Recipes" preference — see
  // db/phase2/67_menu_item_hidden_from_recipes.sql. Sync never touches
  // this column; only the Recipes page's own item list reads it.
  // Product Mix and everywhere else shows the item exactly as before.
  hiddenFromRecipes: boolean;
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

      const [menuItemsRes, currentRows, prevRows, tierRows, recipeCostCtx] = await Promise.all([
        supabase
          .from("menu_items")
          .select(
            "pos_id, location_id, name, category, category_override, price_cents, price_is_starting_price, cost_cents, hidden_from_recipes",
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
        fetchAllRows((from, to) =>
          supabase
            .from("pmix_sales_by_tier")
            .select("menu_item_pos_id, price_tier_id, quantity_sold")
            .in("location_id", locationIds!)
            .gte("business_date", fromIso)
            .lte("business_date", toIso)
            .range(from, to),
        ),
        fetchRecipeCostContext(locationIds!),
      ]);
      if (menuItemsRes.error) throw menuItemsRes.error;

      const tierQtyByItem = new Map<string, Map<string, number>>();
      for (const r of tierRows) {
        const byTier = tierQtyByItem.get(r.menu_item_pos_id) ?? new Map<string, number>();
        byTier.set(r.price_tier_id, (byTier.get(r.price_tier_id) ?? 0) + Number(r.quantity_sold));
        tierQtyByItem.set(r.menu_item_pos_id, byTier);
      }

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
        const recipeCents = resolveItemCostCents(
          m.pos_id,
          recipeCostCtx,
          tierQtyByItem.get(m.pos_id),
        );
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
          hiddenFromRecipes: m.hidden_from_recipes ?? false,
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

// Toggles one or many menu items' Recipes-page visibility in a single
// request — see RealMenuItem's own hiddenFromRecipes comment.
// Reversible, and scoped to Recipes only: Product Mix keeps showing
// every active item regardless of this flag. A single-row quick-hide
// click is just a one-element posIds array, same call as a bulk hide.
export function useSetMenuItemsHiddenFromRecipes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      locationId,
      posIds,
      hidden,
    }: {
      locationId: string;
      posIds: string[];
      hidden: boolean;
    }) => {
      const { error } = await supabase
        .from("menu_items")
        .update({ hidden_from_recipes: hidden })
        .eq("location_id", locationId)
        .in("pos_id", posIds);
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

      const [salesData, tierRows, recipeCostCtx, invoicesRes] = await Promise.all([
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
            .from("pmix_sales_by_tier")
            .select("menu_item_pos_id, price_tier_id, quantity_sold")
            .in("location_id", locationIds!)
            .gte("business_date", fromIso)
            .lte("business_date", toIso)
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

      const tierQtyByItem = new Map<string, Map<string, number>>();
      for (const r of tierRows) {
        const byTier = tierQtyByItem.get(r.menu_item_pos_id) ?? new Map<string, number>();
        byTier.set(r.price_tier_id, (byTier.get(r.price_tier_id) ?? 0) + Number(r.quantity_sold));
        tierQtyByItem.set(r.menu_item_pos_id, byTier);
      }

      // Resolved once per menu item actually sold this period (recursing
      // through any prep recipes it uses, and blending per-tier costs
      // when the item sold across multiple sizes) — then reused for
      // every sold unit of that item below.
      const soldItemPosIds = new Set(salesData.map((r) => r.menu_item_pos_id));
      const itemCostCentsById = new Map<string, number | null>();
      for (const menuItemPosId of soldItemPosIds) {
        itemCostCentsById.set(
          menuItemPosId,
          resolveItemCostCents(menuItemPosId, recipeCostCtx, tierQtyByItem.get(menuItemPosId)),
        );
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

// Decomposes useFoodCostSummary's one aggregate theoretical-vs-actual
// gap into a per-ingredient breakdown — which specific ingredients
// explain the gap, not just that a gap exists. Theoretical: each sold
// item's recipe walked via accumulateMenuItemIngredientUsage (same
// underlying cost data as useFoodCostSummary, decomposed instead of
// summed) — items with no recipe or an uncostable line are excluded
// per-item, same as useFoodCostSummary's itemsMissingRecipeCount.
// Actual: real approved food/bev invoice_lines summed by their
// matched ingredient_id — lines never matched to an ingredient can't
// contribute to any row, so their total is surfaced separately
// (unmatchedActualSpendCents) rather than silently dropped. Does not
// account for price tiers — see accumulateMenuItemIngredientUsage's
// own comment.
export type IngredientVarianceRow = {
  ingredientId: string;
  ingredientName: string;
  category: string | null;
  theoreticalCostCents: number;
  actualSpendCents: number;
  varianceCents: number;
};

export type FoodCostVariance = {
  rows: IngredientVarianceRow[];
  totalTheoreticalCents: number;
  totalActualCents: number;
  // Approved food/bev invoice spend that couldn't be attributed to any
  // ingredient row above (its invoice_lines.ingredient_id was never
  // matched) — real spend the table below understates without this.
  unmatchedActualSpendCents: number;
  itemsMissingRecipeCount: number;
};

type InvoiceLineActualRow = {
  ingredient_id: string;
  line_total_cents: number | null;
  invoices: { status: string; vendors: { category: string } | null } | null;
};

export function useFoodCostVariance(range: DateRange) {
  const { data: locationIds } = useLocationIds();
  const restaurantId = useRestaurantIds()[0];
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["food-cost-variance", locationIds, restaurantId, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0 && !!restaurantId,
    queryFn: async (): Promise<FoodCostVariance> => {
      const [salesData, recipeCostCtx, ingredientsRes, invoiceLineRows, totalInvoicesRes] =
        await Promise.all([
          fetchAllRows((from, to) =>
            supabase
              .from("pmix_sales")
              .select("menu_item_pos_id, quantity_sold")
              .in("location_id", locationIds!)
              .gte("business_date", fromIso)
              .lte("business_date", toIso)
              .order("business_date", { ascending: true })
              .range(from, to),
          ),
          fetchRecipeCostContext(locationIds!),
          supabase
            .from("ingredients")
            .select("id, name, category")
            .eq("restaurant_id", restaurantId!),
          // Single-level embedded filters (invoices.status/location_id/
          // invoice_date) run server-side, same pattern useFoodCostSummary
          // already relies on; the deeper invoices.vendors.category filter
          // is two levels down from invoice_lines and isn't a pattern
          // proven elsewhere in this codebase, so it's checked client-side
          // below instead of risking an unsupported filter path.
          fetchAllRows((from, to) =>
            supabase
              .from("invoice_lines")
              .select("ingredient_id, line_total_cents, invoices!inner(status, vendors(category))")
              .not("ingredient_id", "is", null)
              .eq("invoices.status", "approved")
              .in("invoices.location_id", locationIds!)
              .gte("invoices.invoice_date", fromIso)
              .lte("invoices.invoice_date", toIso)
              .range(from, to),
          ),
          supabase
            .from("invoices")
            .select("total_cents, vendors!inner(category)")
            .in("location_id", locationIds!)
            .eq("status", "approved")
            .eq("vendors.category", "food_beverage")
            .gte("invoice_date", fromIso)
            .lte("invoice_date", toIso),
        ]);
      if (ingredientsRes.error) throw ingredientsRes.error;
      if (totalInvoicesRes.error) throw totalInvoicesRes.error;

      const qtyByItem = new Map<string, number>();
      for (const row of salesData) {
        qtyByItem.set(
          row.menu_item_pos_id,
          (qtyByItem.get(row.menu_item_pos_id) ?? 0) + Number(row.quantity_sold),
        );
      }

      const theoreticalByIngredient = new Map<string, number>();
      const itemsMissing = new Set<string>();
      for (const [menuItemPosId, qty] of qtyByItem) {
        const lines = recipeCostCtx.recipeLinesByMenuItem.get(menuItemPosId) ?? [];
        if (lines.length === 0) {
          itemsMissing.add(menuItemPosId);
          continue;
        }
        const acc = new Map<string, number>();
        const ok = accumulateMenuItemIngredientUsage(
          lines,
          recipeCostCtx.prepRecipeLinesByPrepId,
          recipeCostCtx.prepRecipeYieldById,
          recipeCostCtx.ingredientById,
          qty,
          acc,
        );
        if (!ok) {
          itemsMissing.add(menuItemPosId);
          continue;
        }
        for (const [ingredientId, cents] of acc) {
          theoreticalByIngredient.set(
            ingredientId,
            (theoreticalByIngredient.get(ingredientId) ?? 0) + cents,
          );
        }
      }

      const actualByIngredient = new Map<string, number>();
      let matchedActualCents = 0;
      for (const row of invoiceLineRows as unknown as InvoiceLineActualRow[]) {
        if (row.invoices?.vendors?.category !== "food_beverage") continue;
        const cents = row.line_total_cents ?? 0;
        actualByIngredient.set(
          row.ingredient_id,
          (actualByIngredient.get(row.ingredient_id) ?? 0) + cents,
        );
        matchedActualCents += cents;
      }

      const ingredientInfoById = new Map(
        (ingredientsRes.data ?? []).map((i) => [i.id, { name: i.name, category: i.category }]),
      );
      const allIngredientIds = new Set([
        ...theoreticalByIngredient.keys(),
        ...actualByIngredient.keys(),
      ]);
      const rows: IngredientVarianceRow[] = Array.from(allIngredientIds)
        .map((id) => {
          const theoreticalCostCents = theoreticalByIngredient.get(id) ?? 0;
          const actualSpendCents = actualByIngredient.get(id) ?? 0;
          const info = ingredientInfoById.get(id);
          return {
            ingredientId: id,
            ingredientName: info?.name ?? "Unknown ingredient",
            category: info?.category ?? null,
            theoreticalCostCents,
            actualSpendCents,
            varianceCents: actualSpendCents - theoreticalCostCents,
          };
        })
        .sort((a, b) => Math.abs(b.varianceCents) - Math.abs(a.varianceCents));

      const totalApprovedFoodBevCents = (totalInvoicesRes.data ?? []).reduce(
        (sum, inv) => sum + (inv.total_cents ?? 0),
        0,
      );

      return {
        rows,
        totalTheoreticalCents: rows.reduce((s, r) => s + r.theoreticalCostCents, 0),
        totalActualCents: matchedActualCents,
        unmatchedActualSpendCents: Math.max(0, totalApprovedFoodBevCents - matchedActualCents),
        itemsMissingRecipeCount: itemsMissing.size,
      };
    },
  });
}

// Reconciles the two most recent Inventory Counts against what should
// have happened in between (purchases minus recipe-driven usage minus
// logged waste) — the "unexplained" leftover is real shrinkage:
// theft, breakage nobody logged, over-pouring, spoilage that missed
// Waste Log. This is the physical-stock counterpart to Cost Variance
// (which reconciles dollars against recipes) — this one reconciles
// real units, so it doesn't need — and deliberately ignores — cost
// data at all except for display; an ingredient with no price yet
// still gets a full quantity reconciliation.
//
// Needs at least 2 saved counts to compute anything (a variance is
// always "since the last count") — with 0 or 1, status is
// "insufficient_counts" and rows is empty; the caller should show a
// clear "save another count" prompt rather than an empty table that
// looks like zero variance.
export type IngredientVarianceDetail = {
  ingredientId: string;
  ingredientName: string;
  category: string | null;
  unit: string;
  startQty: number;
  purchasedQty: number;
  usedQty: number;
  wastedQty: number;
  expectedEndQty: number;
  actualEndQty: number;
  varianceQty: number;
  // Null when the ingredient has no cost set yet — the row still
  // shows real quantity variance, just without a dollar translation.
  varianceCostCents: number | null;
};

export type InventoryVariance = {
  status: "ready" | "insufficient_counts";
  countsAvailable: number;
  previousCountedAt: string | null;
  latestCountedAt: string | null;
  rows: IngredientVarianceDetail[];
  itemsMissingRecipeCount: number;
  // Ingredients counted in both periods but excluded from `rows`
  // because a purchase, waste, or count line for them used a unit
  // that couldn't convert to the ingredient's own unit — better than
  // silently treating an unconvertible amount as zero.
  excludedIngredientCount: number;
};

type IngredientFullInfo = {
  name: string;
  category: string | null;
  unit: string;
  unitCostCents: number | null;
  containerSizeMl: number | null;
  containerSizeG: number | null;
};

// Sums a set of (ingredient_id, quantity, unit) lines into each
// ingredient's own native unit. An ingredient with no info (deleted
// since) or a line whose unit can't convert goes into `unreliable`
// instead of silently contributing 0 or a wrong number.
function sumQtyByIngredient(
  lines: { ingredient_id: string; quantity: number; unit: string }[],
  ingredientInfoById: Map<string, IngredientFullInfo>,
): { qtyByIngredient: Map<string, number>; unreliable: Set<string> } {
  const qtyByIngredient = new Map<string, number>();
  const unreliable = new Set<string>();
  for (const line of lines) {
    const info = ingredientInfoById.get(line.ingredient_id);
    if (!info) {
      unreliable.add(line.ingredient_id);
      continue;
    }
    const converted = convertQuantityToIngredientUnit(
      Number(line.quantity),
      line.unit,
      info.unit,
      info.containerSizeMl,
      info.containerSizeG,
    );
    if (converted == null) {
      unreliable.add(line.ingredient_id);
      continue;
    }
    qtyByIngredient.set(
      line.ingredient_id,
      (qtyByIngredient.get(line.ingredient_id) ?? 0) + converted,
    );
  }
  return { qtyByIngredient, unreliable };
}

export function useInventoryVariance() {
  const { data: locationIds } = useLocationIds();
  const restaurantId = useRestaurantIds()[0];

  return useQuery({
    queryKey: ["inventory-variance", locationIds, restaurantId],
    enabled: !!locationIds && locationIds.length > 0 && !!restaurantId,
    queryFn: async (): Promise<InventoryVariance> => {
      const countsRes = await supabase
        .from("inventory_counts")
        .select("id, counted_at")
        .in("location_id", locationIds!)
        .order("counted_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2);
      if (countsRes.error) throw countsRes.error;
      const counts = countsRes.data ?? [];

      if (counts.length < 2) {
        return {
          status: "insufficient_counts",
          countsAvailable: counts.length,
          previousCountedAt: null,
          latestCountedAt: null,
          rows: [],
          itemsMissingRecipeCount: 0,
          excludedIngredientCount: 0,
        };
      }

      const [latestCount, previousCount] = counts;
      const fromIso = previousCount.counted_at as string;
      const toIso = latestCount.counted_at as string;

      const [
        latestLinesRes,
        previousLinesRes,
        ingredientsRes,
        salesData,
        recipeCostCtx,
        invoiceLineRows,
        wasteLogRes,
      ] = await Promise.all([
        supabase
          .from("inventory_count_lines")
          .select("ingredient_id, quantity, unit")
          .eq("inventory_count_id", latestCount.id),
        supabase
          .from("inventory_count_lines")
          .select("ingredient_id, quantity, unit")
          .eq("inventory_count_id", previousCount.id),
        supabase
          .from("ingredients")
          .select("id, name, category, unit, unit_cost_cents, container_size_ml, container_size_g")
          .eq("restaurant_id", restaurantId!),
        fetchAllRows((from, to) =>
          supabase
            .from("pmix_sales")
            .select("menu_item_pos_id, quantity_sold")
            .in("location_id", locationIds!)
            .gt("business_date", fromIso)
            .lte("business_date", toIso)
            .order("business_date", { ascending: true })
            .range(from, to),
        ),
        fetchRecipeCostContext(locationIds!),
        fetchAllRows((from, to) =>
          supabase
            .from("invoice_lines")
            .select("ingredient_id, quantity, unit, invoices!inner(status, vendors(category))")
            .not("ingredient_id", "is", null)
            .eq("invoices.status", "approved")
            .in("invoices.location_id", locationIds!)
            .gt("invoices.invoice_date", fromIso)
            .lte("invoices.invoice_date", toIso)
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabase
            .from("waste_log")
            .select("ingredient_id, quantity, unit")
            .in("location_id", locationIds!)
            .gt("logged_at", fromIso)
            .lte("logged_at", toIso)
            .range(from, to),
        ),
      ]);
      if (latestLinesRes.error) throw latestLinesRes.error;
      if (previousLinesRes.error) throw previousLinesRes.error;
      if (ingredientsRes.error) throw ingredientsRes.error;

      const ingredientInfoById = new Map<string, IngredientFullInfo>(
        (ingredientsRes.data ?? []).map((i) => [
          i.id,
          {
            name: i.name,
            category: i.category,
            unit: i.unit,
            unitCostCents: i.unit_cost_cents,
            containerSizeMl: i.container_size_ml,
            containerSizeG: i.container_size_g,
          },
        ]),
      );

      const { qtyByIngredient: latestQty, unreliable: latestUnreliable } = sumQtyByIngredient(
        (latestLinesRes.data ?? []).map((r) => ({
          ingredient_id: r.ingredient_id,
          quantity: r.quantity,
          unit: r.unit,
        })),
        ingredientInfoById,
      );
      const { qtyByIngredient: previousQty, unreliable: previousUnreliable } = sumQtyByIngredient(
        (previousLinesRes.data ?? []).map((r) => ({
          ingredient_id: r.ingredient_id,
          quantity: r.quantity,
          unit: r.unit,
        })),
        ingredientInfoById,
      );

      const matchedInvoiceLines = (
        invoiceLineRows as unknown as {
          ingredient_id: string;
          quantity: number | null;
          unit: string | null;
          invoices: { status: string; vendors: { category: string } | null } | null;
        }[]
      ).filter(
        (r) => r.invoices?.vendors?.category === "food_beverage" && r.quantity != null && r.unit,
      );
      const { qtyByIngredient: purchasedQty, unreliable: purchaseUnreliable } = sumQtyByIngredient(
        matchedInvoiceLines.map((r) => ({
          ingredient_id: r.ingredient_id,
          quantity: r.quantity!,
          unit: r.unit!,
        })),
        ingredientInfoById,
      );

      const { qtyByIngredient: wastedQty, unreliable: wasteUnreliable } = sumQtyByIngredient(
        (wasteLogRes ?? []).map((r) => ({
          ingredient_id: r.ingredient_id,
          quantity: r.quantity,
          unit: r.unit,
        })),
        ingredientInfoById,
      );

      // Theoretical usage — same recursive recipe walk Cost Variance
      // uses, decomposed into real quantity instead of dollars, over
      // whatever sold between the two counts.
      const qtyByItem = new Map<string, number>();
      for (const row of salesData) {
        qtyByItem.set(
          row.menu_item_pos_id,
          (qtyByItem.get(row.menu_item_pos_id) ?? 0) + Number(row.quantity_sold),
        );
      }
      const usedQty = new Map<string, number>();
      const itemsMissing = new Set<string>();
      for (const [menuItemPosId, qty] of qtyByItem) {
        const lines = recipeCostCtx.recipeLinesByMenuItem.get(menuItemPosId) ?? [];
        if (lines.length === 0) {
          itemsMissing.add(menuItemPosId);
          continue;
        }
        const acc = new Map<string, number>();
        const ok = accumulateMenuItemIngredientQuantity(
          lines,
          recipeCostCtx.prepRecipeLinesByPrepId,
          recipeCostCtx.prepRecipeYieldById,
          recipeCostCtx.ingredientById,
          qty,
          acc,
        );
        if (!ok) {
          itemsMissing.add(menuItemPosId);
          continue;
        }
        for (const [ingredientId, q] of acc) {
          usedQty.set(ingredientId, (usedQty.get(ingredientId) ?? 0) + q);
        }
      }

      const unreliableIngredients = new Set([
        ...latestUnreliable,
        ...previousUnreliable,
        ...purchaseUnreliable,
        ...wasteUnreliable,
      ]);

      // Only ingredients counted in BOTH periods have a real start and
      // end point — anything added or removed between counts can't be
      // reconciled and is simply not shown, rather than guessed at.
      let excludedIngredientCount = 0;
      const rows: IngredientVarianceDetail[] = [];
      for (const [ingredientId, startQty] of previousQty) {
        const endQty = latestQty.get(ingredientId);
        if (endQty == null) continue;
        if (unreliableIngredients.has(ingredientId)) {
          excludedIngredientCount++;
          continue;
        }
        const info = ingredientInfoById.get(ingredientId);
        if (!info) {
          excludedIngredientCount++;
          continue;
        }
        const purchased = purchasedQty.get(ingredientId) ?? 0;
        const used = usedQty.get(ingredientId) ?? 0;
        const wasted = wastedQty.get(ingredientId) ?? 0;
        const expectedEndQty = startQty + purchased - used - wasted;
        const varianceQty = endQty - expectedEndQty;
        rows.push({
          ingredientId,
          ingredientName: info.name,
          category: info.category,
          unit: info.unit,
          startQty,
          purchasedQty: purchased,
          usedQty: used,
          wastedQty: wasted,
          expectedEndQty,
          actualEndQty: endQty,
          varianceQty,
          varianceCostCents: info.unitCostCents != null ? varianceQty * info.unitCostCents : null,
        });
      }
      rows.sort((a, b) => {
        const av =
          a.varianceCostCents != null ? Math.abs(a.varianceCostCents) : Math.abs(a.varianceQty);
        const bv =
          b.varianceCostCents != null ? Math.abs(b.varianceCostCents) : Math.abs(b.varianceQty);
        return bv - av;
      });

      return {
        status: "ready",
        countsAvailable: counts.length,
        previousCountedAt: previousCount.counted_at as string,
        latestCountedAt: latestCount.counted_at as string,
        rows,
        itemsMissingRecipeCount: itemsMissing.size,
        excludedIngredientCount,
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
