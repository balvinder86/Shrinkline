// Real "menu engineering" signal for the product_mix insights tab —
// same sales+cost data useProductMix (src/lib/pos/queries.ts) shows on
// the Product Mix page, reduced to a compact per-item summary: this
// week's velocity vs last week's, and margin per unit sold (real avg
// realized price from pmix_sales.net_sales_cents, never price*qty —
// same convention RealMenuItem uses — minus recipe cost via the
// already-ported recipeCost.ts walk). Lets the model flag high-volume
// items with thin/negative margin (reprice candidates) and items whose
// sales just fell off a cliff, without ever inventing a number.

import { supabase } from "./supabase.js";
import { fetchAllRows, fetchRecipeCostContext, resolveItemCostCents } from "./foodCost.js";

const WINDOW_DAYS = 7;
const MAX_ITEMS = 15;

export type ProductMixItem = {
  item_name: string;
  category: string | null;
  qty_sold_this_week: number;
  qty_sold_prior_week: number;
  // Real avg $/unit this week (net_sales_cents / quantity_sold) — a
  // true realized price, not the catalog price, so discounts/comps
  // already show through.
  avg_realized_price_cents: number | null;
  item_cost_cents: number | null;
  // avg_realized_price_cents - item_cost_cents; null if either side is
  // unknown (no recipe costed yet) — never assume $0.
  margin_cents: number | null;
};

export type ProductMixSummary = {
  window_days: number;
  items: ProductMixItem[];
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export async function computeProductMixSummary(locationId: string): Promise<ProductMixSummary> {
  const curFrom = isoDaysAgo(WINDOW_DAYS - 1);
  const curTo = isoDaysAgo(0);
  const priorFrom = isoDaysAgo(WINDOW_DAYS * 2 - 1);
  const priorTo = isoDaysAgo(WINDOW_DAYS);

  const [menuItemsRes, curSales, priorSales, recipeCostCtx] = await Promise.all([
    supabase.from("menu_items").select("pos_id, name, category").eq("location_id", locationId),
    fetchAllRows((from, to) =>
      supabase
        .from("pmix_sales")
        .select("menu_item_pos_id, quantity_sold, net_sales_cents")
        .eq("location_id", locationId)
        .gte("business_date", curFrom)
        .lte("business_date", curTo)
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("pmix_sales")
        .select("menu_item_pos_id, quantity_sold")
        .eq("location_id", locationId)
        .gte("business_date", priorFrom)
        .lte("business_date", priorTo)
        .range(from, to),
    ),
    fetchRecipeCostContext(locationId),
  ]);
  if (menuItemsRes.error) {
    throw new Error(`load menu_items for ${locationId} failed: ${menuItemsRes.error.message}`);
  }

  const infoByPosId = new Map(
    (menuItemsRes.data ?? []).map((r) => [
      r.pos_id as string,
      { name: r.name as string, category: r.category as string | null },
    ]),
  );

  const curQtyByItem = new Map<string, number>();
  const curSalesByItem = new Map<string, number>();
  for (const row of curSales) {
    const posId = row.menu_item_pos_id as string;
    curQtyByItem.set(posId, (curQtyByItem.get(posId) ?? 0) + Number(row.quantity_sold));
    curSalesByItem.set(posId, (curSalesByItem.get(posId) ?? 0) + Number(row.net_sales_cents));
  }
  const priorQtyByItem = new Map<string, number>();
  for (const row of priorSales) {
    const posId = row.menu_item_pos_id as string;
    priorQtyByItem.set(posId, (priorQtyByItem.get(posId) ?? 0) + Number(row.quantity_sold));
  }

  const items: ProductMixItem[] = [];
  for (const [posId, qty] of curQtyByItem) {
    if (qty <= 0) continue;
    const info = infoByPosId.get(posId);
    if (!info) continue;
    const netSales = curSalesByItem.get(posId) ?? 0;
    const avgPrice = qty > 0 ? Math.round(netSales / qty) : null;
    const itemCost = resolveItemCostCents(posId, recipeCostCtx);
    items.push({
      item_name: info.name,
      category: info.category,
      qty_sold_this_week: qty,
      qty_sold_prior_week: priorQtyByItem.get(posId) ?? 0,
      avg_realized_price_cents: avgPrice,
      item_cost_cents: itemCost,
      margin_cents: avgPrice != null && itemCost != null ? avgPrice - itemCost : null,
    });
  }

  // Highest-volume items first — margin problems and velocity swings
  // on the menu's actual bestsellers matter far more than the same
  // issue on a rarely-ordered item, and the model is told to weigh
  // volume itself rather than being pre-filtered to only "problem"
  // items the way invoiceDrift's threshold does.
  items.sort((a, b) => b.qty_sold_this_week - a.qty_sold_this_week);

  return { window_days: WINDOW_DAYS, items: items.slice(0, MAX_ITEMS) };
}
