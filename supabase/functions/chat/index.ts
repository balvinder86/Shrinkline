// Dashboard chat assistant — lets a restaurant's own owner/manager/
// staff ask natural-language questions about THEIR live data (food
// cost, labor, vendor spend, inventory variance, ingredient price
// trends) via tool use against Supabase. Read-only: the assistant
// answers questions, it never writes anything.
//
//   { restaurant_id, messages: [{role: "user"|"assistant", content}] }
//
// Auth/tenant-scoping mirrors generate-recipe/index.ts: JWT verify →
// membership check → restaurant_id/locationIds resolved server-side
// and never re-derived from anything Claude's tool calls echo back.
// On top of that, each tool is gated by the SAME per-feature
// permission keys the dashboard nav itself uses (src/lib/permissions.ts)
// — a staff member without the "pnl" permission can't get P&L numbers
// out of the chatbot just because the nav link is hidden from them.
//
// The recipe-cost math (get_pnl_summary, get_food_cost_variance,
// get_inventory_variance) reuses ../_shared/recipeCost.ts and
// units.ts — the same functions the dashboard pages themselves use —
// so the assistant's numbers agree with what the owner already sees,
// rather than being a second, potentially-drifting implementation.
// One documented v1 simplification: get_pnl_summary/
// get_food_cost_variance use each item's base/untiered recipe only
// (no price-tier blending) — see resolveMenuItemRecipeCostCents's own
// comment in _shared/recipeCost.ts.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  resolveMenuItemRecipeCostCents,
  accumulateMenuItemIngredientUsage,
  accumulateMenuItemIngredientQuantity,
  type IngredientCostInfo,
  type PrepRecipeLineRow,
  type RecipeLineRow,
} from "../_shared/recipeCost.ts";
import { convertQuantityToIngredientUnit } from "../_shared/units.ts";
import { fetchAllRows } from "../_shared/pagination.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// ------------------------------------------------------------------
// Permissions — same contract as src/lib/permissions.ts's hasAccess:
// owners always have full access; manager/staff need an explicit
// `true` for the key; a missing key means no access, not a default.
// ------------------------------------------------------------------

type Membership = { role: string; permissions: Record<string, boolean> };

function hasAccess(membership: Membership, key: string): boolean {
  if (membership.role === "owner") return true;
  return membership.permissions[key] === true;
}

const PERMISSION_DENIED = (key: string) => ({
  error: `not_permitted`,
  message: `This restaurant's owner hasn't granted you access to "${key}" data. Ask an owner to grant it under Admin, or ask them directly.`,
});

// ------------------------------------------------------------------
// Small shared helpers (mirrors of the same-named helpers in
// src/lib/pos/queries.ts and src/lib/boh/queries.ts)
// ------------------------------------------------------------------

function resolveDateRange(from?: string, to?: string): { fromIso: string; toIso: string } {
  const toDate = to ? new Date(`${to}T00:00:00Z`) : new Date();
  const fromDate = from
    ? new Date(`${from}T00:00:00Z`)
    : new Date(toDate.getTime() - 29 * 86_400_000);
  return { fromIso: fromDate.toISOString().slice(0, 10), toIso: toDate.toISOString().slice(0, 10) };
}

function pctChange(from: number, to: number): number | null {
  if (from <= 0) return null;
  return Math.round(((to - from) / from) * 1000) / 10;
}

type IngredientFullInfo = {
  name: string;
  category: string | null;
  unit: string;
  unitCostCents: number | null;
  containerSizeMl: number | null;
  containerSizeG: number | null;
};

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

// Untiered-only recipe context — v1 simplification, see file header.
async function fetchRecipeCostContext(locationIds: string[]) {
  const [recipeLinesData, prepRecipeLinesRaw, prepRecipesRes] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("recipe_lines")
        .select(
          "id, menu_item_pos_id, ingredient_id, prep_recipe_id, quantity, unit, ingredients (unit_cost_cents, unit, container_size_ml, container_size_g)",
        )
        .in("location_id", locationIds)
        .is("price_tier_id", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("prep_recipe_lines")
        .select(
          "id, prep_recipe_id, ingredient_id, sub_prep_recipe_id, quantity, unit, ingredients (unit_cost_cents, unit, container_size_ml, container_size_g), owner:prep_recipes!prep_recipe_id!inner(location_id)",
        )
        .in("owner.location_id", locationIds)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("prep_recipes").select("id, yield_qty").in("location_id", locationIds),
  ]);
  if (prepRecipesRes.error) throw prepRecipesRes.error;

  type IngredientJoin = {
    unit_cost_cents: number | null;
    unit: string;
    container_size_ml: number | null;
    container_size_g: number | null;
  } | null;
  type RecipeLineDbRow = {
    menu_item_pos_id: string;
    ingredient_id: string | null;
    prep_recipe_id: string | null;
    quantity: number;
    unit: string;
    ingredients: IngredientJoin;
  };
  type PrepRecipeLineDbRow = {
    prep_recipe_id: string;
    ingredient_id: string | null;
    sub_prep_recipe_id: string | null;
    quantity: number;
    unit: string;
    ingredients: IngredientJoin;
  };

  const recipeLines = recipeLinesData as unknown as RecipeLineDbRow[];
  const prepRecipeLinesData = prepRecipeLinesRaw as unknown as PrepRecipeLineDbRow[];

  const ingredientById = new Map<string, IngredientCostInfo | undefined>();
  for (const row of [...recipeLines, ...prepRecipeLinesData]) {
    if (row.ingredient_id && row.ingredients) {
      ingredientById.set(row.ingredient_id, {
        unitCostCents: row.ingredients.unit_cost_cents,
        unit: row.ingredients.unit,
        containerSizeMl: row.ingredients.container_size_ml,
        containerSizeG: row.ingredients.container_size_g,
      });
    }
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
  for (const row of recipeLines) {
    const list = recipeLinesByMenuItem.get(row.menu_item_pos_id) ?? [];
    list.push({
      ingredient_id: row.ingredient_id,
      prep_recipe_id: row.prep_recipe_id,
      quantity: Number(row.quantity),
      unit: row.unit,
    });
    recipeLinesByMenuItem.set(row.menu_item_pos_id, list);
  }

  return { recipeLinesByMenuItem, prepRecipeLinesByPrepId, prepRecipeYieldById, ingredientById };
}

// ------------------------------------------------------------------
// Tools
// ------------------------------------------------------------------

type Ctx = { restaurantId: string; locationIds: string[] };

async function toolGetPnlSummary(input: { from?: string; to?: string }, ctx: Ctx) {
  const { fromIso, toIso } = resolveDateRange(input.from, input.to);

  const [sales, recipeCtx, foodInvoicesRes, laborRows, allInvoicesRes] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("pmix_sales")
        .select("menu_item_pos_id, quantity_sold, net_sales_cents")
        .in("location_id", ctx.locationIds)
        .gte("business_date", fromIso)
        .lte("business_date", toIso)
        .order("business_date", { ascending: true })
        .range(from, to),
    ),
    fetchRecipeCostContext(ctx.locationIds),
    supabase
      .from("invoices")
      .select("total_cents, vendors!inner(category)")
      .in("location_id", ctx.locationIds)
      .eq("status", "approved")
      .eq("vendors.category", "food_beverage")
      .gte("invoice_date", fromIso)
      .lte("invoice_date", toIso),
    fetchAllRows((from, to) =>
      supabase
        .from("labor_shifts")
        .select("regular_hours, overtime_hours, labor_cost_cents, in_at, out_at, wage_cents")
        .in("location_id", ctx.locationIds)
        .gte("business_date", fromIso)
        .lte("business_date", toIso)
        .order("business_date", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("invoices")
      .select("total_cents, vendors!inner(category)")
      .in("location_id", ctx.locationIds)
      .eq("status", "approved")
      .gte("invoice_date", fromIso)
      .lte("invoice_date", toIso),
  ]);
  if (foodInvoicesRes.error) throw foodInvoicesRes.error;
  if (allInvoicesRes.error) throw allInvoicesRes.error;

  let netSalesCents = 0;
  const qtyByItem = new Map<string, number>();
  for (const r of sales) {
    netSalesCents += Number(r.net_sales_cents);
    qtyByItem.set(
      r.menu_item_pos_id,
      (qtyByItem.get(r.menu_item_pos_id) ?? 0) + Number(r.quantity_sold),
    );
  }

  let theoreticalFoodCostCents = 0;
  let itemsMissingRecipeCount = 0;
  for (const [posId, qty] of qtyByItem) {
    const lines = recipeCtx.recipeLinesByMenuItem.get(posId) ?? [];
    const perUnit = resolveMenuItemRecipeCostCents(
      lines,
      recipeCtx.prepRecipeLinesByPrepId,
      recipeCtx.prepRecipeYieldById,
      recipeCtx.ingredientById,
    );
    if (perUnit == null) {
      itemsMissingRecipeCount++;
      continue;
    }
    theoreticalFoodCostCents += perUnit * qty;
  }

  const actualFoodCostCents = (foodInvoicesRes.data ?? []).reduce(
    (s, inv) => s + (inv.total_cents ?? 0),
    0,
  );

  const nowMs = Date.now();
  let laborCostCents = 0;
  for (const r of laborRows) {
    if (r.out_at) {
      laborCostCents += Number(r.labor_cost_cents);
    } else {
      const elapsedHours = Math.max(0, (nowMs - new Date(r.in_at).getTime()) / 3_600_000);
      laborCostCents += Math.round(elapsedHours * Number(r.wage_cents));
    }
  }

  const expenseByCategory = new Map<string, number>();
  for (const inv of (allInvoicesRes.data ?? []) as unknown as {
    total_cents: number | null;
    vendors: { category: string } | null;
  }[]) {
    const cat = inv.vendors?.category ?? "other";
    expenseByCategory.set(cat, (expenseByCategory.get(cat) ?? 0) + (inv.total_cents ?? 0));
  }
  const totalExpensesCents = Array.from(expenseByCategory.values()).reduce((a, b) => a + b, 0);

  return {
    dateRange: { from: fromIso, to: toIso },
    netSalesCents,
    theoreticalFoodCostCents,
    theoreticalFoodCostPct:
      netSalesCents > 0 ? (theoreticalFoodCostCents / netSalesCents) * 100 : null,
    actualFoodCostCents,
    actualFoodCostPct: netSalesCents > 0 ? (actualFoodCostCents / netSalesCents) * 100 : null,
    laborCostCents,
    laborCostPct: netSalesCents > 0 ? (laborCostCents / netSalesCents) * 100 : null,
    expenseByCategory: Object.fromEntries(expenseByCategory),
    netProfitEstimateCents: netSalesCents - totalExpensesCents - laborCostCents,
    itemsMissingRecipeCount,
    caveat:
      "Food cost uses each item's base recipe only (not blended across price tiers like bottle/pint/pitcher) — may differ slightly from the P&L page for heavily-tiered items. netProfitEstimateCents is a rough estimate (sales minus all approved invoice spend minus labor), not a full accounting P&L.",
  };
}

async function toolGetFoodCostVariance(
  input: { from?: string; to?: string; category?: string },
  ctx: Ctx,
) {
  const { fromIso, toIso } = resolveDateRange(input.from, input.to);

  const [sales, recipeCtx, ingredientsRes, invoiceLines] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("pmix_sales")
        .select("menu_item_pos_id, quantity_sold")
        .in("location_id", ctx.locationIds)
        .gte("business_date", fromIso)
        .lte("business_date", toIso)
        .order("business_date", { ascending: true })
        .range(from, to),
    ),
    fetchRecipeCostContext(ctx.locationIds),
    supabase.from("ingredients").select("id, name, category").eq("restaurant_id", ctx.restaurantId),
    fetchAllRows((from, to) =>
      supabase
        .from("invoice_lines")
        .select("id, ingredient_id, line_total_cents, invoices!inner(status, vendors(category))")
        .not("ingredient_id", "is", null)
        .eq("invoices.status", "approved")
        .in("invoices.location_id", ctx.locationIds)
        .gte("invoices.invoice_date", fromIso)
        .lte("invoices.invoice_date", toIso)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);
  if (ingredientsRes.error) throw ingredientsRes.error;

  const qtyByItem = new Map<string, number>();
  for (const r of sales) {
    qtyByItem.set(
      r.menu_item_pos_id,
      (qtyByItem.get(r.menu_item_pos_id) ?? 0) + Number(r.quantity_sold),
    );
  }

  const theoreticalByIngredient = new Map<string, number>();
  let itemsMissingRecipeCount = 0;
  for (const [posId, qty] of qtyByItem) {
    const lines = recipeCtx.recipeLinesByMenuItem.get(posId) ?? [];
    if (lines.length === 0) {
      itemsMissingRecipeCount++;
      continue;
    }
    const acc = new Map<string, number>();
    const ok = accumulateMenuItemIngredientUsage(
      lines,
      recipeCtx.prepRecipeLinesByPrepId,
      recipeCtx.prepRecipeYieldById,
      recipeCtx.ingredientById,
      qty,
      acc,
    );
    if (!ok) {
      itemsMissingRecipeCount++;
      continue;
    }
    for (const [id, cents] of acc) {
      theoreticalByIngredient.set(id, (theoreticalByIngredient.get(id) ?? 0) + cents);
    }
  }

  const actualByIngredient = new Map<string, number>();
  let matchedActualCents = 0;
  for (const row of invoiceLines as unknown as {
    ingredient_id: string;
    line_total_cents: number | null;
    invoices: { status: string; vendors: { category: string } | null } | null;
  }[]) {
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
  const allIds = new Set([...theoreticalByIngredient.keys(), ...actualByIngredient.keys()]);
  let rows = Array.from(allIds).map((id) => {
    const theoreticalCostCents = theoreticalByIngredient.get(id) ?? 0;
    const actualSpendCents = actualByIngredient.get(id) ?? 0;
    const info = ingredientInfoById.get(id);
    return {
      ingredientName: info?.name ?? "Unknown ingredient",
      category: info?.category ?? null,
      theoreticalCostCents,
      actualSpendCents,
      varianceCents: actualSpendCents - theoreticalCostCents,
    };
  });
  if (input.category) rows = rows.filter((r) => r.category === input.category);
  rows.sort((a, b) => Math.abs(b.varianceCents) - Math.abs(a.varianceCents));

  return {
    dateRange: { from: fromIso, to: toIso },
    rows: rows.slice(0, 15),
    totalTheoreticalCents: rows.reduce((s, r) => s + r.theoreticalCostCents, 0),
    totalActualCents: matchedActualCents,
    itemsMissingRecipeCount,
    caveat:
      itemsMissingRecipeCount > 0
        ? `${itemsMissingRecipeCount} sold item(s) had no costed recipe this period, so theoretical cost is understated for whatever they touch.`
        : undefined,
  };
}

async function toolGetInventoryVariance(_input: Record<string, never>, ctx: Ctx) {
  const countsRes = await supabase
    .from("inventory_counts")
    .select("id, counted_at")
    .in("location_id", ctx.locationIds)
    .order("counted_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2);
  if (countsRes.error) throw countsRes.error;
  const counts = countsRes.data ?? [];
  if (counts.length < 2) {
    return {
      status: "insufficient_counts",
      countsAvailable: counts.length,
      message: "Needs at least 2 saved inventory counts to compute variance.",
    };
  }
  const [latestCount, previousCount] = counts;
  const fromIso = previousCount.counted_at as string;
  const toIso = latestCount.counted_at as string;

  const [
    latestLinesRes,
    previousLinesRes,
    ingredientsRes,
    salesRows,
    recipeCtx,
    invoiceLineRows,
    wasteRows,
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
      .eq("restaurant_id", ctx.restaurantId),
    fetchAllRows((from, to) =>
      supabase
        .from("pmix_sales")
        .select("menu_item_pos_id, quantity_sold")
        .in("location_id", ctx.locationIds)
        .gt("business_date", fromIso)
        .lte("business_date", toIso)
        .order("business_date", { ascending: true })
        .range(from, to),
    ),
    fetchRecipeCostContext(ctx.locationIds),
    fetchAllRows((from, to) =>
      supabase
        .from("invoice_lines")
        .select("id, ingredient_id, quantity, unit, invoices!inner(status, vendors(category))")
        .not("ingredient_id", "is", null)
        .eq("invoices.status", "approved")
        .in("invoices.location_id", ctx.locationIds)
        .gt("invoices.invoice_date", fromIso)
        .lte("invoices.invoice_date", toIso)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("waste_log")
        .select("ingredient_id, quantity, unit")
        .in("location_id", ctx.locationIds)
        .gt("logged_at", fromIso)
        .lte("logged_at", toIso)
        .order("id", { ascending: true })
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
    latestLinesRes.data ?? [],
    ingredientInfoById,
  );
  const { qtyByIngredient: previousQty, unreliable: previousUnreliable } = sumQtyByIngredient(
    previousLinesRes.data ?? [],
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
    wasteRows,
    ingredientInfoById,
  );

  const qtyByPosItem = new Map<string, number>();
  for (const r of salesRows) {
    qtyByPosItem.set(
      r.menu_item_pos_id,
      (qtyByPosItem.get(r.menu_item_pos_id) ?? 0) + Number(r.quantity_sold),
    );
  }
  const usedQty = new Map<string, number>();
  let itemsMissingRecipeCount = 0;
  for (const [posId, qty] of qtyByPosItem) {
    const lines = recipeCtx.recipeLinesByMenuItem.get(posId) ?? [];
    if (lines.length === 0) {
      itemsMissingRecipeCount++;
      continue;
    }
    const acc = new Map<string, number>();
    const ok = accumulateMenuItemIngredientQuantity(
      lines,
      recipeCtx.prepRecipeLinesByPrepId,
      recipeCtx.prepRecipeYieldById,
      recipeCtx.ingredientById,
      qty,
      acc,
    );
    if (!ok) {
      itemsMissingRecipeCount++;
      continue;
    }
    for (const [id, q] of acc) usedQty.set(id, (usedQty.get(id) ?? 0) + q);
  }

  const unreliable = new Set([
    ...latestUnreliable,
    ...previousUnreliable,
    ...purchaseUnreliable,
    ...wasteUnreliable,
  ]);
  let excludedIngredientCount = 0;
  const rows: {
    ingredientName: string;
    category: string | null;
    unit: string;
    expectedEndQty: number;
    actualEndQty: number;
    varianceQty: number;
    varianceCostCents: number | null;
  }[] = [];
  for (const [id, startQty] of previousQty) {
    const endQty = latestQty.get(id);
    if (endQty == null) continue;
    if (unreliable.has(id)) {
      excludedIngredientCount++;
      continue;
    }
    const info = ingredientInfoById.get(id);
    if (!info) {
      excludedIngredientCount++;
      continue;
    }
    const purchased = purchasedQty.get(id) ?? 0;
    const used = usedQty.get(id) ?? 0;
    const wasted = wastedQty.get(id) ?? 0;
    const expectedEndQty = startQty + purchased - used - wasted;
    const varianceQty = endQty - expectedEndQty;
    rows.push({
      ingredientName: info.name,
      category: info.category,
      unit: info.unit,
      expectedEndQty,
      actualEndQty: endQty,
      varianceQty,
      varianceCostCents:
        info.unitCostCents != null ? Math.round(varianceQty * info.unitCostCents) : null,
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
    previousCountedAt: fromIso,
    latestCountedAt: toIso,
    rows: rows.slice(0, 20),
    itemsMissingRecipeCount,
    excludedIngredientCount,
    caveat:
      "Negative varianceQty means less was found than expected — real shrinkage. Positive means more than expected (a purchase/waste line may be missing or unconverted).",
  };
}

async function toolGetVendorSpend(input: { from?: string; to?: string }, ctx: Ctx) {
  const { fromIso, toIso } = resolveDateRange(input.from, input.to);
  const [vendorsRes, invoicesRes] = await Promise.all([
    supabase.from("vendors").select("id, name, category").eq("restaurant_id", ctx.restaurantId),
    supabase
      .from("invoices")
      .select("vendor_id, status, total_cents")
      .in("location_id", ctx.locationIds)
      .eq("status", "approved")
      .gte("invoice_date", fromIso)
      .lte("invoice_date", toIso),
  ]);
  if (vendorsRes.error) throw vendorsRes.error;
  if (invoicesRes.error) throw invoicesRes.error;

  const byVendor = new Map<string, { spendCents: number; invoiceCount: number }>();
  for (const inv of invoicesRes.data ?? []) {
    if (!inv.vendor_id) continue;
    const cur = byVendor.get(inv.vendor_id) ?? { spendCents: 0, invoiceCount: 0 };
    cur.spendCents += inv.total_cents ?? 0;
    cur.invoiceCount += 1;
    byVendor.set(inv.vendor_id, cur);
  }

  const rows = (vendorsRes.data ?? [])
    .map((v) => {
      const stats = byVendor.get(v.id) ?? { spendCents: 0, invoiceCount: 0 };
      return {
        vendorName: v.name,
        category: v.category,
        spendCents: stats.spendCents,
        invoiceCount: stats.invoiceCount,
      };
    })
    .filter((r) => r.spendCents > 0)
    .sort((a, b) => b.spendCents - a.spendCents);

  return { dateRange: { from: fromIso, to: toIso }, rows: rows.slice(0, 20) };
}

async function toolGetIngredientPriceTrends(input: { limit?: number }, ctx: Ctx) {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 30);
  type Row = {
    ingredient_id: string;
    unit_cost_cents: number;
    effective_date: string;
    invoice_lines: { invoices: { vendors: { name: string } | null } | null } | null;
  };
  const [historyRows, ingredientsRes] = await Promise.all([
    fetchAllRows<Row>((from, to) =>
      supabase
        .from("ingredient_cost_history")
        .select(
          "ingredient_id, unit_cost_cents, effective_date, invoice_lines(invoices(vendors(name)))",
        )
        .eq("restaurant_id", ctx.restaurantId)
        .order("effective_date", { ascending: true })
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    supabase
      .from("ingredients")
      .select("id, name, category, unit")
      .eq("restaurant_id", ctx.restaurantId),
  ]);
  if (ingredientsRes.error) throw ingredientsRes.error;

  const byIngredient = new Map<string, Row[]>();
  for (const row of historyRows) {
    const list = byIngredient.get(row.ingredient_id) ?? [];
    list.push(row);
    byIngredient.set(row.ingredient_id, list);
  }
  const ingredientInfoById = new Map(
    (ingredientsRes.data ?? []).map((i) => [
      i.id,
      { name: i.name, category: i.category, unit: i.unit },
    ]),
  );

  const rows = [];
  for (const [id, entries] of byIngredient) {
    const info = ingredientInfoById.get(id);
    if (!info) continue;
    const first = entries[0];
    const latest = entries[entries.length - 1];
    const vendors = new Set<string>();
    for (const e of entries) {
      const name = e.invoice_lines?.invoices?.vendors?.name;
      if (name) vendors.add(name);
    }
    rows.push({
      ingredientName: info.name,
      category: info.category,
      unit: info.unit,
      currentCostCents: latest.unit_cost_cents,
      firstCostCents: first.unit_cost_cents,
      changePct: pctChange(first.unit_cost_cents, latest.unit_cost_cents),
      vendorLabel:
        vendors.size === 0 ? "—" : vendors.size === 1 ? Array.from(vendors)[0] : "Multiple vendors",
      latestDate: latest.effective_date,
    });
  }
  rows.sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));

  return { rows: rows.slice(0, limit) };
}

async function toolGetLaborCostSummary(input: { from?: string; to?: string }, ctx: Ctx) {
  const { fromIso, toIso } = resolveDateRange(input.from, input.to);
  const [laborRows, salesRows] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("labor_shifts")
        .select("regular_hours, overtime_hours, labor_cost_cents, in_at, out_at, wage_cents")
        .in("location_id", ctx.locationIds)
        .gte("business_date", fromIso)
        .lte("business_date", toIso)
        .order("business_date", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("pmix_sales")
        .select("net_sales_cents")
        .in("location_id", ctx.locationIds)
        .gte("business_date", fromIso)
        .lte("business_date", toIso)
        .order("business_date", { ascending: true })
        .range(from, to),
    ),
  ]);

  const nowMs = Date.now();
  let laborCostCents = 0;
  let regularHours = 0;
  let overtimeHours = 0;
  let liveShiftCount = 0;
  for (const r of laborRows) {
    if (r.out_at) {
      laborCostCents += Number(r.labor_cost_cents);
      regularHours += Number(r.regular_hours);
      overtimeHours += Number(r.overtime_hours);
    } else {
      const elapsedHours = Math.max(0, (nowMs - new Date(r.in_at).getTime()) / 3_600_000);
      laborCostCents += Math.round(elapsedHours * Number(r.wage_cents));
      regularHours += elapsedHours;
      liveShiftCount++;
    }
  }
  const revenueCents = salesRows.reduce((s, r) => s + Number(r.net_sales_cents), 0);

  return {
    dateRange: { from: fromIso, to: toIso },
    laborCostCents,
    regularHours: Math.round(regularHours * 10) / 10,
    overtimeHours: Math.round(overtimeHours * 10) / 10,
    revenueCents,
    laborCostPct: revenueCents > 0 ? (laborCostCents / revenueCents) * 100 : null,
    liveShiftCount,
  };
}

async function toolSearchIngredient(input: { name: string }, ctx: Ctx) {
  const name = (input.name ?? "").trim();
  if (!name) return { matches: [] };
  const ingredientsRes = await supabase
    .from("ingredients")
    .select("id, name, category, unit, unit_cost_cents, vendor_id")
    .eq("restaurant_id", ctx.restaurantId)
    .ilike("name", `%${name}%`)
    .limit(5);
  if (ingredientsRes.error) throw ingredientsRes.error;
  const ingredients = ingredientsRes.data ?? [];
  if (ingredients.length === 0) return { matches: [] };

  const vendorIds = ingredients.map((i) => i.vendor_id).filter((v): v is string => !!v);
  const vendorsRes = vendorIds.length
    ? await supabase.from("vendors").select("id, name").in("id", vendorIds)
    : { data: [], error: null };
  if (vendorsRes.error) throw vendorsRes.error;
  const vendorNameById = new Map((vendorsRes.data ?? []).map((v) => [v.id, v.name]));

  const historyRes = await supabase
    .from("ingredient_cost_history")
    .select("ingredient_id, unit_cost_cents, effective_date")
    .in(
      "ingredient_id",
      ingredients.map((i) => i.id),
    )
    .order("effective_date", { ascending: false })
    .limit(50);
  if (historyRes.error) throw historyRes.error;
  const historyByIngredient = new Map<string, { unitCostCents: number; effectiveDate: string }[]>();
  for (const h of historyRes.data ?? []) {
    const list = historyByIngredient.get(h.ingredient_id) ?? [];
    if (list.length < 5)
      list.push({ unitCostCents: h.unit_cost_cents, effectiveDate: h.effective_date });
    historyByIngredient.set(h.ingredient_id, list);
  }

  return {
    matches: ingredients.map((i) => ({
      name: i.name,
      category: i.category,
      unit: i.unit,
      currentCostCents: i.unit_cost_cents,
      vendorName: i.vendor_id ? (vendorNameById.get(i.vendor_id) ?? null) : null,
      recentPrices: historyByIngredient.get(i.id) ?? [],
    })),
  };
}

// Real units-sold/revenue per menu item name, straight off pmix_sales
// (Toast's own denormalized item name — no menu_items join needed,
// matching the lean useTopItems precedent in src/lib/pos/queries.ts
// rather than the heavier useProductMix, which additionally resolves
// cost/margin this tool doesn't need). Revenue is Toast's real
// net_sales_cents, never price × quantity (diverges on discounts/
// comps/modifiers).
async function toolGetTopMenuItems(
  input: { from?: string; to?: string; limit?: number; sortBy?: "quantity" | "revenue" },
  ctx: Ctx,
) {
  const { fromIso, toIso } = resolveDateRange(input.from, input.to);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 30);
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("pmix_sales")
      .select("name, quantity_sold, net_sales_cents")
      .in("location_id", ctx.locationIds)
      .gte("business_date", fromIso)
      .lte("business_date", toIso)
      .order("business_date", { ascending: true })
      .range(from, to),
  );

  const byName = new Map<string, { unitsSold: number; revenueCents: number }>();
  for (const r of rows) {
    const cur = byName.get(r.name) ?? { unitsSold: 0, revenueCents: 0 };
    cur.unitsSold += Number(r.quantity_sold);
    cur.revenueCents += Number(r.net_sales_cents);
    byName.set(r.name, cur);
  }

  const items = Array.from(byName.entries()).map(([name, v]) => ({
    name,
    unitsSold: v.unitsSold,
    revenueCents: Math.round(v.revenueCents),
  }));
  const sortBy = input.sortBy ?? "quantity";
  items.sort((a, b) =>
    sortBy === "revenue" ? b.revenueCents - a.revenueCents : b.unitsSold - a.unitsSold,
  );

  return {
    dateRange: { from: fromIso, to: toIso },
    sortedBy: sortBy,
    items: items.slice(0, limit),
  };
}

const RECOMMENDATION_TABS = ["food_cost", "inventory", "invoices", "recipes"] as const;

// Reads the SAME ai_recommendations rows the P&L page's
// AiRecommendationsPanel shows — generated nightly by the insights
// Railway service's Batch API pipeline, not computed here. This tool
// surfaces existing curated recommendations rather than having the
// chat improvise its own from scratch every time.
async function toolGetAiRecommendations(input: { tab?: string }, ctx: Ctx) {
  const tabs = (
    input.tab && (RECOMMENDATION_TABS as readonly string[]).includes(input.tab)
      ? [input.tab]
      : RECOMMENDATION_TABS
  ) as string[];
  const locationId = ctx.locationIds[0];
  const { data, error } = await supabase
    .from("ai_recommendations")
    .select("tab, severity, headline, body, business_date, generated_at")
    .eq("location_id", locationId)
    .in("tab", tabs)
    .order("business_date", { ascending: false });
  if (error) throw error;
  const rows = data ?? [];

  const latestDateByTab = new Map<string, string>();
  for (const r of rows) {
    if (!latestDateByTab.has(r.tab)) latestDateByTab.set(r.tab, r.business_date);
  }
  const latest = rows.filter((r) => r.business_date === latestDateByTab.get(r.tab));

  return {
    recommendations: latest.map((r) => ({
      tab: r.tab,
      severity: r.severity,
      headline: r.headline,
      body: r.body,
      date: r.business_date,
    })),
    note:
      latest.length === 0
        ? "No AI recommendations generated yet for this restaurant — they run nightly, check back tomorrow."
        : undefined,
  };
}

// name -> [implementation, requiredPermission]. Each tool's own input
// type is narrower than `any` — `any` here is deliberate, only to let
// a heterogeneous dispatch table hold functions with different input
// shapes; real validation of what the model actually sent happens
// inside each tool via its own typed parameter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: Record<string, [(input: any, ctx: Ctx) => Promise<unknown>, string]> = {
  get_pnl_summary: [toolGetPnlSummary, "pnl"],
  get_food_cost_variance: [toolGetFoodCostVariance, "pnl"],
  get_inventory_variance: [toolGetInventoryVariance, "inventory"],
  get_vendor_spend: [toolGetVendorSpend, "inventory"],
  get_ingredient_price_trends: [toolGetIngredientPriceTrends, "pnl"],
  get_labor_cost_summary: [toolGetLaborCostSummary, "scheduling"],
  search_ingredient: [toolSearchIngredient, "inventory"],
  get_top_menu_items: [toolGetTopMenuItems, "product_mix"],
  get_ai_recommendations: [toolGetAiRecommendations, "pnl"],
};

// Friendly labels for the "Checking X…" status the client shows while
// a tool call is in flight (streaming has no visible text at that
// point otherwise — tool_use turns are silent from the model itself).
const TOOL_LABELS: Record<string, string> = {
  get_pnl_summary: "your P&L",
  get_food_cost_variance: "cost variance",
  get_inventory_variance: "inventory variance",
  get_vendor_spend: "vendor spend",
  get_ingredient_price_trends: "price trends",
  get_labor_cost_summary: "labor cost",
  search_ingredient: "ingredient data",
  get_top_menu_items: "your top sellers",
  get_ai_recommendations: "recommendations",
};

const TOOL_DEFINITIONS = [
  {
    name: "get_pnl_summary",
    description:
      "Net sales, theoretical vs actual food cost, labor cost, and operating expense breakdown for a date range. Use for big-picture 'how's the restaurant doing' or 'what's my food cost %' questions.",
    input_schema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Start date, YYYY-MM-DD. Defaults to 30 days before today.",
        },
        to: { type: "string", description: "End date, YYYY-MM-DD. Defaults to today." },
      },
    },
  },
  {
    name: "get_food_cost_variance",
    description:
      "Per-ingredient breakdown of the gap between theoretical (recipe-based) and actual (invoice) food cost for a date range. Use for 'why is my food cost up' or 'what's driving variance' questions.",
    input_schema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Start date, YYYY-MM-DD. Defaults to 30 days before today.",
        },
        to: { type: "string", description: "End date, YYYY-MM-DD. Defaults to today." },
        category: {
          type: "string",
          enum: ["Beverages", "Alcohol", "Food", "Dry Goods", "Miscellaneous"],
          description: "Optional filter to one ingredient category.",
        },
      },
    },
  },
  {
    name: "get_inventory_variance",
    description:
      "Reconciles the two most recent physical inventory counts against purchases, recipe usage, and logged waste in between — surfaces real shrinkage (theft, breakage, unlogged loss). Requires at least 2 saved counts; check the status field. No parameters.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_vendor_spend",
    description: "Approved invoice spend and invoice counts per vendor for a date range.",
    input_schema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Start date, YYYY-MM-DD. Defaults to 30 days before today.",
        },
        to: { type: "string", description: "End date, YYYY-MM-DD. Defaults to today." },
      },
    },
  },
  {
    name: "get_ingredient_price_trends",
    description:
      "Every ingredient with recorded cost history, ranked by how much its price has moved since it was first tracked — surfaces vendor price creep. Use for 'any big price increases' questions.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max rows to return, default 10, max 30." },
      },
    },
  },
  {
    name: "get_labor_cost_summary",
    description: "Labor cost $ and % of revenue, hours, and overtime for a date range.",
    input_schema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Start date, YYYY-MM-DD. Defaults to 30 days before today.",
        },
        to: { type: "string", description: "End date, YYYY-MM-DD. Defaults to today." },
      },
    },
  },
  {
    name: "search_ingredient",
    description:
      "Looks up specific ingredient(s) by name (partial match ok) — current cost, unit, category, vendor, and recent price history. Use when the user names one ingredient.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "Ingredient name or partial name." } },
      required: ["name"],
    },
  },
  {
    name: "get_top_menu_items",
    description:
      "Units sold and revenue per menu item for a date range, ranked by popularity or revenue. Use for 'what's my most sold item', 'best sellers', or 'top revenue items' questions.",
    input_schema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Start date, YYYY-MM-DD. Defaults to 30 days before today.",
        },
        to: { type: "string", description: "End date, YYYY-MM-DD. Defaults to today." },
        limit: { type: "number", description: "Max items to return, default 10, max 30." },
        sortBy: {
          type: "string",
          enum: ["quantity", "revenue"],
          description: "Rank by units sold (default) or by revenue.",
        },
      },
    },
  },
  {
    name: "get_ai_recommendations",
    description:
      "The restaurant's existing nightly-generated AI recommendations (the same ones shown on the P&L page's Price Alerts panel) — curated flags on food cost, inventory, invoices, or recipes. Call this FIRST whenever the user broadly asks for suggestions, recommendations, or 'what should I do' before adding your own observations.",
    input_schema: {
      type: "object",
      properties: {
        tab: {
          type: "string",
          enum: ["food_cost", "inventory", "invoices", "recipes"],
          description: "Optional filter to one area. Omit to get all.",
        },
      },
    },
  },
];

const SYSTEM_PROMPT = `You are the in-app data assistant for Thrasher's Pub's restaurant-ops dashboard. You help this restaurant's own owner/manager/staff understand THEIR restaurant's real numbers — food cost, labor, vendor spend, inventory, ingredient price trends, top sellers — by calling tools that query their live data. Never guess or estimate a number yourself; always call a tool to get it.

Rules:
- If the user doesn't specify a date range, the tool defaults to the last 30 days — say that plainly in your answer (e.g. "over the last 30 days").
- If a tool result includes a data-completeness caveat (itemsMissingRecipeCount, excludedIngredientCount, an "insufficient_counts" status, etc.), mention it rather than presenting the number as the complete picture.
- If a tool result has error: "not_permitted", tell the user plainly they don't have access to that data and suggest asking an owner/manager to grant it — don't try another tool to work around it.
- Keep answers short and conversational — a couple of sentences or a short "-" bullet list. No headers, no tables. Plain sentences only — no **bold**, no other markdown emphasis. The one exception is page links, exactly as described below.
- Never narrate what you're about to do ("Let me check that", "I'll pull that up", "One moment") — go straight to calling tools silently and speak once, when you actually have the real answer. Your response streams to the user live, so a "let me look" preamble just reads as filler, not helpfulness.
- You can only answer questions about this restaurant's own operational data. You cannot take actions (log waste, change prices, edit recipes, etc.) — if asked to DO something rather than answer a question, say so.
- All dollar amounts in tool results are in cents — always convert to dollars in your answer.
- When the user asks for suggestions, recommendations, or "what should I do", call get_ai_recommendations FIRST and lead your answer with those (they're the restaurant's real curated flags, generated nightly) — then, if a tool result you already pulled clearly shows something worth acting on (a big variance, a price spike, a shrinkage number), add 1-2 short, concrete, specific-to-this-data suggestions of your own. Never invent generic restaurant advice unconnected to a real number you just pulled.
- When it would genuinely help — the user seems stuck, asks "where do I find X", or a page would let them explore/act on something further than you can in chat (a chart, a full table, editing a recipe, saving a count) — link to the single most relevant page using markdown: [Label](/path). Only use exact paths from AVAILABLE PAGES below; never invent one. Don't link on every message — only when it adds real value.

AVAILABLE PAGES:
- /product-mix — Product Mix: menu engineering (stars/plowhorses/puzzles/dogs), full sales-by-item view
- /recipes — Recipes: ingredients, cost, and margin per dish; edit recipe lines
- /invoices — Invoices: vendor invoices, line-item spend, payment status
- /inventory — Ordering: par levels, smart carts, AI ordering agent
- /inventory-count — Count Inventory: save a physical count
- /vendors — Vendors: contacts, terms, delivery days
- /purchase-orders — Purchase Orders: sent POs and status
- /waste-log — Waste Log: log ingredient waste and its dollar cost
- /inventory-variance — Inventory Variance: full shrinkage table from count reconciliation
- /pnl — P&L: full sales/food cost/labor/prime cost/opex breakdown
- /variance — Cost Variance: full per-ingredient theoretical-vs-actual table, filterable by category
- /labor — Labor Cost: full hours/overtime/cost breakdown, trend chart
- /ingredient-price-trends — Ingredient Price Trends: full price-history table and per-ingredient chart
- /reviews — Reviews: Google reviews and the AI reply agent
- /seo — SEO: local search rankings, Google Business health
- /marketing — Marketing: campaigns across email/SMS/social/loyalty/ads
- /loyalty — Loyalty: program tiers, rewards, referrals
- /scheduling — Scheduling: staff scheduling`;

// ------------------------------------------------------------------
// SSE — a minimal server-sent-events line parser, used to read
// Anthropic's own streaming response. Each event is "event: <type>"
// (optional, defaults to "message") + one or more "data: <json>"
// lines, terminated by a blank line.
// ------------------------------------------------------------------

async function* iterateSSE(
  body: ReadableStream<Uint8Array>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): AsyncGenerator<{ event: string; data: any }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        let eventType = "message";
        const dataLines: string[] = [];
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        try {
          yield { event: eventType, data: JSON.parse(dataLines.join("\n")) };
        } catch {
          // malformed chunk — skip rather than crash the whole stream
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// A single accumulating content block reconstructed from stream
// deltas — shape matches what the non-streaming API would have
// returned in body.content, so it can be pushed straight back into
// anthropicMessages exactly like the old non-streaming loop did.
type StreamBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
  signature?: string;
  data?: string;
  _partialJson?: string;
};

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------

const MAX_TOOL_ITERATIONS = 6;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 4000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      return json({ ok: false, error: "missing Authorization header" }, 401);
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "invalid session" }, 401);
    }

    const { restaurant_id, messages } = await req.json();
    if (!restaurant_id || !Array.isArray(messages) || messages.length === 0) {
      return json(
        { ok: false, error: "restaurant_id and a non-empty messages array are required" },
        400,
      );
    }
    if (messages.length > MAX_MESSAGES) {
      return json({ ok: false, error: `too many messages (max ${MAX_MESSAGES})` }, 400);
    }
    for (const m of messages) {
      if (
        !m ||
        (m.role !== "user" && m.role !== "assistant") ||
        typeof m.content !== "string" ||
        m.content.length === 0 ||
        m.content.length > MAX_MESSAGE_LENGTH
      ) {
        return json({ ok: false, error: "invalid message shape" }, 400);
      }
    }

    const { data: membershipRow } = await supabase
      .from("memberships")
      .select("role, permissions")
      .eq("user_id", userData.user.id)
      .eq("restaurant_id", restaurant_id)
      .maybeSingle();
    if (!membershipRow) {
      return json({ ok: false, error: "not a member of this restaurant" }, 403);
    }
    const membership: Membership = {
      role: membershipRow.role,
      permissions: membershipRow.permissions ?? {},
    };

    const { data: locations } = await supabase
      .from("locations")
      .select("id")
      .eq("restaurant_id", restaurant_id);
    const locationIds = (locations ?? []).map((l: { id: string }) => l.id);
    if (locationIds.length === 0) {
      return json({ ok: false, error: "no locations found for this restaurant" }, 400);
    }
    const ctx: Ctx = { restaurantId: restaurant_id, locationIds };

    // Anthropic's Messages API content blocks (text/thinking/tool_use/
    // tool_result) aren't worth fully typing here — this array is only
    // ever built up and passed straight back to fetch() verbatim.
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anthropicMessages: any[] = messages.map((m: { role: string; content: string }) => ({
      role: m.role,
      content: m.content,
    }));

    // From here on the response is committed to SSE — everything
    // above this point (auth, validation, membership) can still fail
    // with a normal HTTP status; nothing below can, so it's all
    // reported as {type:"error"} events on the stream instead.
    const encoder = new TextEncoder();
    const upstreamController = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        function send(event: Record<string, unknown>) {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // downstream already closed (client navigated away/closed
            // the panel) — nothing left to do.
          }
        }

        try {
          let finalText: string | null = null;

          for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
            const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              signal: upstreamController.signal,
              headers: {
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "claude-opus-5",
                max_tokens: 8192,
                thinking: { type: "adaptive" },
                system: SYSTEM_PROMPT,
                tools: TOOL_DEFINITIONS,
                messages: anthropicMessages,
                stream: true,
              }),
            });
            if (!anthropicRes.ok || !anthropicRes.body) {
              const errBody = await anthropicRes.text().catch(() => "");
              send({ type: "error", error: `Claude API error ${anthropicRes.status}: ${errBody}` });
              controller.close();
              return;
            }

            const blocks = new Map<number, StreamBlock>();
            let stopReason: string | null = null;

            for await (const evt of iterateSSE(anthropicRes.body)) {
              if (evt.event === "content_block_start") {
                const index = evt.data.index as number;
                const block: StreamBlock = { ...evt.data.content_block };
                blocks.set(index, block);
                if (block.type === "tool_use" && block.name) {
                  send({ type: "tool_start", label: TOOL_LABELS[block.name] ?? "your data" });
                }
              } else if (evt.event === "content_block_delta") {
                const block = blocks.get(evt.data.index as number);
                if (!block) continue;
                const delta = evt.data.delta;
                if (delta.type === "text_delta") {
                  block.text = (block.text ?? "") + delta.text;
                  send({ type: "text", text: delta.text as string });
                } else if (delta.type === "input_json_delta") {
                  block._partialJson = (block._partialJson ?? "") + delta.partial_json;
                } else if (delta.type === "thinking_delta") {
                  block.thinking = (block.thinking ?? "") + delta.thinking;
                } else if (delta.type === "signature_delta") {
                  block.signature = (block.signature ?? "") + delta.signature;
                }
              } else if (evt.event === "content_block_stop") {
                const block = blocks.get(evt.data.index as number);
                if (block?.type === "tool_use") {
                  try {
                    block.input = block._partialJson ? JSON.parse(block._partialJson) : {};
                  } catch {
                    block.input = {};
                  }
                  delete block._partialJson;
                }
              } else if (evt.event === "message_delta") {
                stopReason = evt.data.delta?.stop_reason ?? stopReason;
              }
            }

            const content = Array.from(blocks.entries())
              .sort((a, b) => a[0] - b[0])
              .map(([, b]) => b);

            if (stopReason !== "tool_use") {
              finalText = content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("");
              break;
            }

            // Preserve the FULL assistant content array (including any
            // thinking blocks) verbatim — required for extended-thinking
            // + tool-use multi-turn continuity.
            anthropicMessages.push({ role: "assistant", content });

            const toolResults = [];
            for (const block of content) {
              if (block.type !== "tool_use") continue;
              const entry = TOOLS[block.name!];
              let resultPayload: unknown;
              if (!entry) {
                resultPayload = { error: "unknown_tool" };
              } else {
                const [impl, requiredPermission] = entry;
                if (!hasAccess(membership, requiredPermission)) {
                  resultPayload = PERMISSION_DENIED(requiredPermission);
                } else {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    resultPayload = await impl((block.input ?? {}) as any, ctx);
                  } catch (e) {
                    resultPayload = { error: "tool_failed", message: String(e) };
                  }
                }
              }
              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: JSON.stringify(resultPayload),
              });
            }
            anthropicMessages.push({ role: "user", content: toolResults });
          }

          if (finalText == null) {
            send({
              type: "error",
              error: "Ran out of tool-call turns without a final answer — try a narrower question.",
            });
          } else if (!finalText.trim()) {
            send({
              type: "text",
              text: "I wasn't able to put together an answer for that — try rephrasing.",
            });
          }
          send({ type: "done" });
          controller.close();
        } catch (e) {
          send({ type: "error", error: String(e) });
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
      cancel() {
        // Client disconnected (closed the panel, navigated away) —
        // stop paying for tokens it'll never see.
        upstreamController.abort();
      },
    });

    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
