import { supabase } from "./supabase.js";
import { computeFoodCostSummary, type FoodCostSummary } from "./foodCost.js";
import { computeInvoiceDrift, type InvoiceDriftResult } from "./invoiceDrift.js";
import { computeProductMixSummary, type ProductMixSummary } from "./productMix.js";
import { computeWasteSummary, type WasteSummary } from "./waste.js";
import { computeVarianceSummary, type VarianceSummary } from "./variance.js";

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
  ingredient_name: string;
  par_quantity: number;
  suggested_par_quantity: number | null;
  avg_daily_usage: number | null;
};

export type TabContext = {
  lowPar: LowParItem[];
  // theoreticalPct/actualPct/variancePct over a trailing 7-day window —
  // same computation as useFoodCostSummary (src/lib/pos/queries.ts),
  // ported to run server-side in foodCost.ts.
  foodCost: FoodCostSummary;
  // Real vendor price-drift signal — see invoiceDrift.ts. Distinct from
  // vendor_product_pack_info.last_unit_cost_cents, which is only an OCR
  // plausibility baseline (ocr/src/server.ts, PRICE_DRIFT_FACTOR = 3x)
  // tuned to catch case/bottle mismatches, not real price increases.
  invoiceDrift: InvoiceDriftResult;
  // Menu velocity + margin signal — see productMix.ts.
  productMix: ProductMixSummary;
  // Ingredient waste trend — see waste.ts.
  waste: WasteSummary;
  // Count-to-count inventory movement — see variance.ts.
  variance: VarianceSummary;
};

// Pulls each tab's already-computed numbers into a compact per-tenant
// context block — no LLM math beyond what foodCost.ts ports, just
// formatting what the dashboard already shows. Tenant identity comes
// from `loc`, never from anything returned by these queries, same as
// every other cross-tenant loop in this codebase.
export async function getTabContext(loc: Location): Promise<TabContext> {
  const [lowParRes, foodCost, invoiceDrift, productMix, waste, variance] = await Promise.all([
    // PostgREST's .lt()/.gt() compare a column against a literal value,
    // not another column — "avg_daily_usage < par_quantity" has to be
    // filtered in JS instead of pushed into the query. (This is the fix
    // for the bug that silently broke every cron run since deploy: the
    // prior version passed "par_quantity" as a string literal, which
    // Postgres rejected trying to parse it as numeric.)
    //
    // Joins ingredients(name) so recommendations can reference "Heineken
    // 24-pack" instead of a raw ingredient_id UUID — the first real
    // batch run surfaced exactly that readability gap.
    supabase
      .from("par_levels")
      .select("par_quantity, suggested_par_quantity, avg_daily_usage, ingredients (name)")
      .eq("location_id", loc.id),
    computeFoodCostSummary(loc.id),
    computeInvoiceDrift(loc.id, loc.restaurant_id),
    computeProductMixSummary(loc.id),
    computeWasteSummary(loc.id),
    computeVarianceSummary(loc.id),
  ]);
  if (lowParRes.error)
    throw new Error(`load par_levels for ${loc.id} failed: ${lowParRes.error.message}`);

  type LowParDbRow = {
    par_quantity: number;
    suggested_par_quantity: number | null;
    avg_daily_usage: number | null;
    ingredients: { name: string } | null;
  };

  const lowPar: LowParItem[] = (lowParRes.data as unknown as LowParDbRow[])
    .filter((row) => row.avg_daily_usage != null && row.avg_daily_usage < row.par_quantity)
    .map((row) => ({
      ingredient_name: row.ingredients?.name ?? "Unknown ingredient",
      par_quantity: row.par_quantity,
      suggested_par_quantity: row.suggested_par_quantity,
      avg_daily_usage: row.avg_daily_usage,
    }));

  return { lowPar, foodCost, invoiceDrift, productMix, waste, variance };
}

// Same par_levels query/filter as getTabContext above, standalone —
// digest.ts needs just this one signal at send time (which runs in a
// separate process invocation from whatever submitTodaysBatch run
// originally computed the full TabContext), not the other 5 expensive
// aggregates that come bundled with it.
export async function getLowParForLocation(locationId: string): Promise<LowParItem[]> {
  const { data, error } = await supabase
    .from("par_levels")
    .select("par_quantity, suggested_par_quantity, avg_daily_usage, ingredients (name)")
    .eq("location_id", locationId);
  if (error) throw new Error(`load par_levels for ${locationId} failed: ${error.message}`);

  type LowParDbRow = {
    par_quantity: number;
    suggested_par_quantity: number | null;
    avg_daily_usage: number | null;
    ingredients: { name: string } | null;
  };

  return (data as unknown as LowParDbRow[])
    .filter((row) => row.avg_daily_usage != null && row.avg_daily_usage < row.par_quantity)
    .map((row) => ({
      ingredient_name: row.ingredients?.name ?? "Unknown ingredient",
      par_quantity: row.par_quantity,
      suggested_par_quantity: row.suggested_par_quantity,
      avg_daily_usage: row.avg_daily_usage,
    }));
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
  const { error } = await supabase.from("ai_recommendations").upsert(
    rows.map((r) => ({ ...r, generated_at: new Date().toISOString() })),
    { onConflict: "location_id,tab,business_date,headline" },
  );
  if (error) throw new Error(`upsert ai_recommendations failed: ${error.message}`);
}
