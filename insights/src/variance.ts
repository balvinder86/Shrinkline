// Real, but intentionally simpler than the frontend's full reconciled
// variance table (useInventoryVariance, src/lib/pos/queries.ts) — that
// computation walks purchases/waste/theoretical-usage through a
// recursive prep-recipe quantity accumulation with unit conversion,
// which isn't worth re-deriving in a second codebase just for this
// signal. This instead compares the two most recent saved inventory
// counts (db/phase2/65_inventory_counts.sql) directly: same-ingredient
// quantity/value delta between them, ranked by $ impact. Real and
// grounded ("Vodka dropped 8 bottles between counts, ~$180"), just not
// broken down into how much of that is purchases vs. usage vs. waste —
// the system prompt tells the model not to overclaim shrinkage/theft
// from this alone.

import { supabase } from "./supabase.js";

const MAX_ITEMS = 10;

export type VarianceItem = {
  ingredient_name: string;
  unit: string;
  // Negative = fewer on hand at the latest count than the prior one.
  quantity_delta: number;
  cost_impact_cents: number | null;
};

export type VarianceSummary = {
  status: "ready" | "insufficient_counts";
  previous_counted_at: string | null;
  latest_counted_at: string | null;
  total_value_delta_cents: number | null;
  items: VarianceItem[];
};

export async function computeVarianceSummary(locationId: string): Promise<VarianceSummary> {
  const { data: counts, error: countsErr } = await supabase
    .from("inventory_counts")
    .select("id, counted_at, total_value_cents")
    .eq("location_id", locationId)
    .order("counted_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2);
  if (countsErr) {
    throw new Error(`load inventory_counts for ${locationId} failed: ${countsErr.message}`);
  }
  if (!counts || counts.length < 2) {
    return {
      status: "insufficient_counts",
      previous_counted_at: null,
      latest_counted_at: null,
      total_value_delta_cents: null,
      items: [],
    };
  }
  const [latest, previous] = counts;

  const [latestLinesRes, previousLinesRes] = await Promise.all([
    supabase
      .from("inventory_count_lines")
      .select("ingredient_id, quantity, value_cents, ingredients (name, unit)")
      .eq("inventory_count_id", latest.id),
    supabase
      .from("inventory_count_lines")
      .select("ingredient_id, quantity, value_cents")
      .eq("inventory_count_id", previous.id),
  ]);
  if (latestLinesRes.error) {
    throw new Error(`load inventory_count_lines (latest) failed: ${latestLinesRes.error.message}`);
  }
  if (previousLinesRes.error) {
    throw new Error(
      `load inventory_count_lines (previous) failed: ${previousLinesRes.error.message}`,
    );
  }

  type LatestRow = {
    ingredient_id: string;
    quantity: number;
    value_cents: number | null;
    ingredients: { name: string; unit: string } | null;
  };
  type PriorRow = { ingredient_id: string; quantity: number; value_cents: number | null };

  const priorByIngredient = new Map(
    (previousLinesRes.data as unknown as PriorRow[]).map((r) => [r.ingredient_id, r]),
  );

  const items: VarianceItem[] = [];
  for (const row of latestLinesRes.data as unknown as LatestRow[]) {
    // Only ingredients counted in BOTH periods have a real start and
    // end point — same principle the frontend's own version uses.
    const prior = priorByIngredient.get(row.ingredient_id);
    if (!prior) continue;
    const delta = Math.round((Number(row.quantity) - Number(prior.quantity)) * 100) / 100;
    if (delta === 0) continue;
    const costImpact =
      row.value_cents != null && prior.value_cents != null
        ? row.value_cents - prior.value_cents
        : null;
    items.push({
      ingredient_name: row.ingredients?.name ?? "Unknown ingredient",
      unit: row.ingredients?.unit ?? "",
      quantity_delta: delta,
      cost_impact_cents: costImpact,
    });
  }
  items.sort((a, b) => Math.abs(b.cost_impact_cents ?? 0) - Math.abs(a.cost_impact_cents ?? 0));

  return {
    status: "ready",
    previous_counted_at: previous.counted_at as string,
    latest_counted_at: latest.counted_at as string,
    total_value_delta_cents:
      latest.total_value_cents != null && previous.total_value_cents != null
        ? (latest.total_value_cents as number) - (previous.total_value_cents as number)
        : null,
    items: items.slice(0, MAX_ITEMS),
  };
}
