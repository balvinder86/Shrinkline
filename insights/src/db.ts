import { supabase } from "./supabase.js";
import { computeFoodCostSummary, type FoodCostSummary } from "./foodCost.js";

export type Location = {
  id: string;
  restaurant_id: string;
  name: string;
};

export async function getAllLocations(): Promise<Location[]> {
  const { data, error } = await supabase.from("locations").select("id, restaurant_id, name");
  if (error) throw new Error(`load locations failed: ${error.message}`);
  return data ?? [];
}

export type LowParItem = {
  ingredient_id: string;
  par_quantity: number;
  suggested_par_quantity: number | null;
};

export type TabContext = {
  lowPar: LowParItem[];
  // theoreticalPct/actualPct/variancePct over a trailing 7-day window —
  // same computation as useFoodCostSummary (src/lib/pos/queries.ts),
  // ported to run server-side in foodCost.ts.
  foodCost: FoodCostSummary;
  // TODO: no dashboard metric for genuine vendor price increases exists
  // yet — vendor_product_pack_info.last_unit_cost_cents is only an OCR
  // plausibility baseline (see ocr/src/server.ts, PRICE_DRIFT_FACTOR =
  // 3x), tuned to catch case/bottle mismatches, not real price drift.
  // Left empty rather than repurposing that threshold for something it
  // wasn't built to detect.
  invoiceDrift: [];
};

// Pulls each tab's already-computed numbers into a compact per-tenant
// context block — no LLM math beyond what foodCost.ts ports, just
// formatting what the dashboard already shows. Tenant identity comes
// from `loc`, never from anything returned by these queries, same as
// every other cross-tenant loop in this codebase.
export async function getTabContext(loc: Location): Promise<TabContext> {
  const [lowParRes, foodCost] = await Promise.all([
    supabase
      .from("par_levels")
      .select("ingredient_id, par_quantity, suggested_par_quantity")
      .eq("location_id", loc.id)
      .lt("avg_daily_usage", "par_quantity"), // TODO: replace with the real low-stock predicate once wired to ingredient_stock
    computeFoodCostSummary(loc.id),
  ]);
  if (lowParRes.error) throw new Error(`load par_levels for ${loc.id} failed: ${lowParRes.error.message}`);

  return { lowPar: lowParRes.data ?? [], foodCost, invoiceDrift: [] };
}

export type BatchRecord = {
  id: string;
  business_date: string;
  anthropic_batch_id: string;
  status: "submitted" | "ended" | "ingested";
};

export async function getTodaysBatch(businessDate: string): Promise<BatchRecord | null> {
  const { data, error } = await supabase
    .from("ai_recommendation_batches")
    .select("id, business_date, anthropic_batch_id, status")
    .eq("business_date", businessDate)
    .maybeSingle();
  if (error) throw new Error(`load ai_recommendation_batches failed: ${error.message}`);
  return data;
}

export async function createBatchRecord(
  businessDate: string,
  anthropicBatchId: string,
  tenantCount: number,
) {
  const { error } = await supabase.from("ai_recommendation_batches").insert({
    business_date: businessDate,
    anthropic_batch_id: anthropicBatchId,
    tenant_count: tenantCount,
  });
  if (error) throw new Error(`insert ai_recommendation_batches failed: ${error.message}`);
}

export async function markBatchEnded(id: string) {
  const { error } = await supabase
    .from("ai_recommendation_batches")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`update ai_recommendation_batches (ended) failed: ${error.message}`);
}

export async function markBatchIngested(id: string) {
  const { error } = await supabase
    .from("ai_recommendation_batches")
    .update({ status: "ingested", ingested_at: new Date().toISOString() })
    .eq("id", id);
  if (error)
    throw new Error(`update ai_recommendation_batches (ingested) failed: ${error.message}`);
}

export type RecommendationRow = {
  restaurant_id: string;
  location_id: string;
  tab: string;
  severity: string;
  headline: string;
  body: string;
  business_date: string;
};

export async function upsertRecommendations(rows: RecommendationRow[]) {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("ai_recommendations")
    .upsert(
      rows.map((r) => ({ ...r, generated_at: new Date().toISOString() })),
      { onConflict: "location_id,tab,business_date" },
    );
  if (error) throw new Error(`upsert ai_recommendations failed: ${error.message}`);
}
