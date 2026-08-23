// Server-side port of useFoodCostSummary (src/lib/pos/queries.ts) — same
// theoretical-vs-actual food cost % computation, minus the React Query
// wrapper, running against a single location for a trailing window
// instead of a user-picked date range.

import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "./supabase.js";
import {
  resolveMenuItemRecipeCostCents,
  type PrepRecipeLineRow,
  type RecipeLineRow,
} from "./recipeCost.js";

const FOOD_COST_WINDOW_DAYS = 7;

type IngredientCostJoin = { unit_cost_cents: number | null } | null;

// PostgREST caps an unpaginated read at 1000 rows — ported alongside
// fetchRecipeCostContext/useFoodCostSummary since both rely on it.
// Exported so productMix.ts (same per-item recipe-cost need) can reuse
// this and fetchRecipeCostContext/resolveItemCostCents below rather
// than a second copy.
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

export async function fetchRecipeCostContext(locationId: string) {
  const [recipeLinesRes, prepRecipeLinesRes, prepRecipesRes] = await Promise.all([
    supabase
      .from("recipe_lines")
      .select(
        "menu_item_pos_id, ingredient_id, prep_recipe_id, quantity, ingredients (unit_cost_cents)",
      )
      .eq("location_id", locationId),
    supabase
      .from("prep_recipe_lines")
      .select(
        "prep_recipe_id, ingredient_id, sub_prep_recipe_id, quantity, ingredients (unit_cost_cents), owner:prep_recipes!prep_recipe_id!inner(location_id)",
      )
      .eq("owner.location_id", locationId),
    supabase.from("prep_recipes").select("id, yield_qty").eq("location_id", locationId),
  ]);
  if (recipeLinesRes.error) throw recipeLinesRes.error;
  if (prepRecipeLinesRes.error) throw prepRecipeLinesRes.error;
  if (prepRecipesRes.error) throw prepRecipesRes.error;

  type RecipeLineDbRow = {
    menu_item_pos_id: string;
    ingredient_id: string | null;
    prep_recipe_id: string | null;
    quantity: number;
    ingredients: IngredientCostJoin;
  };
  type PrepRecipeLineDbRow = {
    prep_recipe_id: string;
    ingredient_id: string | null;
    sub_prep_recipe_id: string | null;
    quantity: number;
    ingredients: IngredientCostJoin;
  };

  const recipeLinesData = (recipeLinesRes.data ?? []) as unknown as RecipeLineDbRow[];
  const prepRecipeLinesData = (prepRecipeLinesRes.data ?? []) as unknown as PrepRecipeLineDbRow[];

  const ingredientCostById = new Map<string, number | null>();
  for (const row of recipeLinesData) {
    if (row.ingredient_id)
      ingredientCostById.set(row.ingredient_id, row.ingredients?.unit_cost_cents ?? null);
  }
  for (const row of prepRecipeLinesData) {
    if (row.ingredient_id)
      ingredientCostById.set(row.ingredient_id, row.ingredients?.unit_cost_cents ?? null);
  }

  const prepRecipeLinesByPrepId = new Map<string, PrepRecipeLineRow[]>();
  for (const row of prepRecipeLinesData) {
    const list = prepRecipeLinesByPrepId.get(row.prep_recipe_id) ?? [];
    list.push({
      prep_recipe_id: row.prep_recipe_id,
      ingredient_id: row.ingredient_id,
      sub_prep_recipe_id: row.sub_prep_recipe_id,
      quantity: Number(row.quantity),
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
    });
    recipeLinesByMenuItem.set(row.menu_item_pos_id, list);
  }

  return {
    recipeLinesByMenuItem,
    prepRecipeLinesByPrepId,
    prepRecipeYieldById,
    ingredientCostById,
  };
}

export function resolveItemCostCents(
  menuItemPosId: string,
  ctx: Awaited<ReturnType<typeof fetchRecipeCostContext>>,
): number | null {
  return resolveMenuItemRecipeCostCents(
    ctx.recipeLinesByMenuItem.get(menuItemPosId) ?? [],
    ctx.prepRecipeLinesByPrepId,
    ctx.prepRecipeYieldById,
    ctx.ingredientCostById,
  );
}

export type FoodCostSummary = {
  theoreticalPct: number | null;
  actualPct: number | null;
  variancePct: number | null;
  hasRecipeData: boolean;
};

export async function computeFoodCostSummary(locationId: string): Promise<FoodCostSummary> {
  const to = new Date();
  const from = new Date(to.getTime() - (FOOD_COST_WINDOW_DAYS - 1) * 86_400_000);
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);

  const [salesData, recipeCostCtx, invoicesRes] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("pmix_sales")
        .select("menu_item_pos_id, quantity_sold, net_sales_cents")
        .eq("location_id", locationId)
        .gte("business_date", fromIso)
        .lte("business_date", toIso)
        .order("business_date", { ascending: true })
        .range(from, to),
    ),
    fetchRecipeCostContext(locationId),
    // Same food_beverage-only filter as useFoodCostSummary — a
    // utility/rent bill can't inflate "actual food spend" here either.
    supabase
      .from("invoices")
      .select("total_cents, vendors!inner(category)")
      .eq("location_id", locationId)
      .eq("status", "approved")
      .eq("vendors.category", "food_beverage")
      .gte("invoice_date", fromIso)
      .lte("invoice_date", toIso),
  ]);
  if (invoicesRes.error) throw invoicesRes.error;

  const itemCostCentsById = new Map<string, number | null>();
  for (const menuItemPosId of recipeCostCtx.recipeLinesByMenuItem.keys()) {
    itemCostCentsById.set(menuItemPosId, resolveItemCostCents(menuItemPosId, recipeCostCtx));
  }

  let theoreticalCostCents = 0;
  let netSalesCents = 0;
  for (const row of salesData) {
    netSalesCents += Number(row.net_sales_cents);
    const perUnit = itemCostCentsById.get(row.menu_item_pos_id);
    if (perUnit == null) continue;
    theoreticalCostCents += perUnit * Number(row.quantity_sold);
  }

  const approvedInvoices = invoicesRes.data ?? [];
  const actualSpendCents = approvedInvoices.reduce((sum, inv) => sum + (inv.total_cents ?? 0), 0);
  const hasInvoiceData = approvedInvoices.length > 0;
  const hasRecipeData = Array.from(itemCostCentsById.values()).some((c) => c != null);

  const theoreticalPct =
    hasRecipeData && netSalesCents > 0 ? (theoreticalCostCents / netSalesCents) * 100 : null;
  const actualPct =
    hasInvoiceData && netSalesCents > 0 ? (actualSpendCents / netSalesCents) * 100 : null;
  const variancePct =
    theoreticalPct != null && actualPct != null ? actualPct - theoreticalPct : null;

  return { theoreticalPct, actualPct, variancePct, hasRecipeData };
}
