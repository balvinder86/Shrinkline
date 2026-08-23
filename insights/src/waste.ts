// Real waste signal for the "waste" insights tab — aggregates
// waste_log (db/phase2/64_waste_log.sql) by ingredient over a trailing
// window vs. the prior window of equal length, so a genuine upward
// trend (not just "some spoilage happened, as it always does") is what
// gets surfaced. cost_cents is resolved and stored at log time, so no
// unit conversion or live repricing is needed here.

import { supabase } from "./supabase.js";

const WINDOW_DAYS = 30;
const MAX_ITEMS = 10;

export type WasteItem = {
  ingredient_name: string;
  // reason -> total cost_cents in the current window, e.g.
  // {"spoilage": 4200, "over_production": 1100}.
  reason_breakdown_cents: Record<string, number>;
  total_cost_cents_this_window: number;
  total_cost_cents_prior_window: number;
  event_count_this_window: number;
};

export type WasteSummary = {
  window_days: number;
  items: WasteItem[];
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export async function computeWasteSummary(locationId: string): Promise<WasteSummary> {
  const priorFrom = isoDaysAgo(WINDOW_DAYS * 2 - 1);
  const curFrom = isoDaysAgo(WINDOW_DAYS - 1);
  const curTo = isoDaysAgo(0);

  const { data, error } = await supabase
    .from("waste_log")
    .select("ingredient_id, cost_cents, reason, logged_at, ingredients (name)")
    .eq("location_id", locationId)
    .gte("logged_at", priorFrom)
    .lte("logged_at", curTo);
  if (error) throw new Error(`load waste_log for ${locationId} failed: ${error.message}`);

  type Row = {
    ingredient_id: string;
    cost_cents: number | null;
    reason: string;
    logged_at: string;
    ingredients: { name: string } | null;
  };

  type Accum = {
    name: string;
    curCents: number;
    priorCents: number;
    reasons: Record<string, number>;
    count: number;
  };
  const byIngredient = new Map<string, Accum>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const cost = row.cost_cents ?? 0;
    const entry = byIngredient.get(row.ingredient_id) ?? {
      name: row.ingredients?.name ?? "Unknown ingredient",
      curCents: 0,
      priorCents: 0,
      reasons: {},
      count: 0,
    };
    if (row.logged_at >= curFrom) {
      entry.curCents += cost;
      entry.count += 1;
      entry.reasons[row.reason] = (entry.reasons[row.reason] ?? 0) + cost;
    } else {
      entry.priorCents += cost;
    }
    byIngredient.set(row.ingredient_id, entry);
  }

  const items: WasteItem[] = Array.from(byIngredient.values())
    .filter((e) => e.curCents > 0)
    .sort((a, b) => b.curCents - a.curCents)
    .slice(0, MAX_ITEMS)
    .map((e) => ({
      ingredient_name: e.name,
      reason_breakdown_cents: e.reasons,
      total_cost_cents_this_window: e.curCents,
      total_cost_cents_prior_window: e.priorCents,
      event_count_this_window: e.count,
    }));

  return { window_days: WINDOW_DAYS, items };
}
