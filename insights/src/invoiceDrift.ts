// Genuine vendor price-drift detection — distinct from
// vendor_product_pack_info.last_unit_cost_cents, which is only an
// OCR-ingestion plausibility baseline (ocr/src/server.ts,
// PRICE_DRIFT_FACTOR = 3x) tuned to catch case/bottle unit mismatches,
// not a real "this vendor raised prices" signal. No dashboard metric
// for this exists yet (confirmed by reading the frontend, not
// assumed) — this is new logic.

import { supabase } from "./supabase.js";

const LOOKBACK_DAYS = 180;
// Per-tenant default when no ai_insights_settings row exists yet — see
// db/phase2/56_ai_insights_settings.sql. Below this, a move is likely
// normal week-to-week noise, not worth spending context on — the model
// still judges whether an included item is actually recommendation-
// worthy. Deliberately far below the OCR check's 3x factor, which
// exists to catch unit mismatches, not flag a real price increase.
const DEFAULT_THRESHOLD_PCT = 10;
const MAX_ITEMS = 10;

async function getThresholdPct(restaurantId: string): Promise<number> {
  const { data, error } = await supabase
    .from("ai_insights_settings")
    .select("invoice_drift_threshold_pct")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (error) throw new Error(`load ai_insights_settings for ${restaurantId} failed: ${error.message}`);
  return data?.invoice_drift_threshold_pct ?? DEFAULT_THRESHOLD_PCT;
}

type InvoiceLineDbRow = {
  unit_cost_cents: number | null;
  ingredient_id: string | null;
  ingredients: { name: string } | null;
  invoices: {
    vendor_id: string;
    invoice_date: string;
    vendors: { name: string } | null;
  };
};

export type PriceDriftItem = {
  ingredient_name: string;
  vendor_name: string;
  current_unit_cost_cents: number;
  prior_avg_unit_cost_cents: number;
  pct_change: number;
  prior_data_points: number;
};

export type InvoiceDriftResult = {
  // Included in what's sent to the model so its recommendation text can
  // reference the tenant's actual configured threshold, since it's no
  // longer a fixed value baked into the system prompt.
  threshold_pct: number;
  items: PriceDriftItem[];
};

export async function computeInvoiceDrift(
  locationId: string,
  restaurantId: string,
): Promise<InvoiceDriftResult> {
  const thresholdPct = await getThresholdPct(restaurantId);
  const windowStart = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("invoice_lines")
    .select(
      "unit_cost_cents, ingredient_id, ingredients (name), invoices!inner (vendor_id, invoice_date, status, location_id, vendors (name))",
    )
    .eq("invoices.location_id", locationId)
    .eq("invoices.status", "approved")
    .not("ingredient_id", "is", null)
    .not("unit_cost_cents", "is", null)
    .gte("invoices.invoice_date", windowStart);
  if (error) throw new Error(`load invoice_lines for ${locationId} failed: ${error.message}`);

  const rows = data as unknown as InvoiceLineDbRow[];

  // Group by (vendor, ingredient) — comparing across vendors would
  // conflate "switched suppliers" with "this vendor raised prices."
  const groups = new Map<
    string,
    { ingredientName: string; vendorName: string; points: { date: string; cents: number }[] }
  >();
  for (const row of rows) {
    if (row.unit_cost_cents == null || !row.ingredient_id) continue;
    const key = `${row.invoices.vendor_id}:${row.ingredient_id}`;
    const group = groups.get(key) ?? {
      ingredientName: row.ingredients?.name ?? "Unknown ingredient",
      vendorName: row.invoices.vendors?.name ?? "Unknown vendor",
      points: [],
    };
    group.points.push({ date: row.invoices.invoice_date, cents: row.unit_cost_cents });
    groups.set(key, group);
  }

  const drifts: PriceDriftItem[] = [];
  for (const { ingredientName, vendorName, points } of groups.values()) {
    // Need at least one prior data point to compare the latest against.
    if (points.length < 2) continue;
    points.sort((a, b) => a.date.localeCompare(b.date));

    const current = points[points.length - 1].cents;
    const priorPoints = points.slice(0, -1);
    const priorAvg = priorPoints.reduce((sum, p) => sum + p.cents, 0) / priorPoints.length;
    if (priorAvg <= 0) continue;

    const pctChange = ((current - priorAvg) / priorAvg) * 100;
    if (Math.abs(pctChange) < thresholdPct) continue;

    drifts.push({
      ingredient_name: ingredientName,
      vendor_name: vendorName,
      current_unit_cost_cents: current,
      prior_avg_unit_cost_cents: Math.round(priorAvg),
      pct_change: Math.round(pctChange * 10) / 10,
      prior_data_points: priorPoints.length,
    });
  }

  // Cap the payload rather than silently sending an unbounded list for
  // a tenant with a lot of invoice history — largest moves first.
  const items = drifts
    .sort((a, b) => Math.abs(b.pct_change) - Math.abs(a.pct_change))
    .slice(0, MAX_ITEMS);

  return { threshold_pct: thresholdPct, items };
}
