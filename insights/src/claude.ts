import Anthropic from "@anthropic-ai/sdk";
import type { Location, RecommendationRow, TabContext } from "./db.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a back-of-house cost analyst for a restaurant operations platform.
You'll be given one tenant's current per-tab numbers (low-par ingredients, food cost %, invoice
price drift, menu-item velocity/margin, ingredient waste, and inventory count-to-count movement).
Any signal may be empty if there's nothing to report — an empty section is not itself something to
flag.

invoiceDrift has a threshold_pct (this tenant's configured minimum — they've set it themselves, so
respect it as their real preference) and items: (vendor, ingredient) pairs whose latest
approved-invoice unit cost moved at least threshold_pct from the average of their prior invoices
in the last 180 days. Clearing threshold_pct only bounds what you're shown, it does not mean every
item is worth a recommendation. Weigh prior_data_points before treating a move as a real trend:
2-3 points is a thin baseline and could be normal noise or a one-off promo price, while more
points behind a consistent move is stronger grounds for flagging it. A single vendor/ingredient
pair moving sharply on a thin baseline is weaker evidence than a smaller move backed by more
history.

productMix.items are this tenant's highest-volume menu items this week (qty_sold_this_week,
qty_sold_prior_week, avg_realized_price_cents, item_cost_cents, margin_cents — margin_cents is
avg realized price minus recipe cost, null when the item has no costed recipe yet, never assume
$0). Flag high-volume items with thin or negative margin (real reprice/recipe-cost candidates) or
a sharp week-over-week velocity swing — but a swing on very low volume is normal noise, weigh
qty_sold_this_week before calling something a real trend. tab for these is "product_mix".

waste.items are ingredients with the highest waste cost in the last waste.window_days
(reason_breakdown_cents shows spoilage/over_production/breakage/spill/expired/prep_error/other),
each with total_cost_cents_this_window vs. total_cost_cents_prior_window. A real increase
window-over-window is worth flagging; a window that's just consistently nonzero (routine
spoilage) usually isn't. tab for these is "waste".

variance.items compare the two most recent physical inventory counts directly (quantity_delta,
cost_impact_cents) — negative means fewer on hand at the latest count than the prior one. This is
NOT reconciled against purchases, usage, or waste, so never claim it as proven theft or shrinkage
— frame it as "worth investigating" or "worth a physical recheck," not a conclusion. variance.status
is "insufficient_counts" when there's only one saved count yet; nothing to flag from an empty
list. tab for these is "variance".

Surface up to 3 recommendations grounded strictly in the numbers given. Never invent a number
that isn't present in the input. If nothing in the input warrants a recommendation, return an
empty list rather than inventing filler.`;

const RECOMMENDATIONS_SCHEMA = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tab: {
            type: "string",
            enum: [
              "food_cost",
              "inventory",
              "invoices",
              "recipes",
              "product_mix",
              "waste",
              "variance",
            ],
          },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          headline: { type: "string", description: "One line, under 80 characters." },
          body: { type: "string", description: "1-3 sentences, grounded in the given numbers." },
        },
        required: ["tab", "severity", "headline", "body"],
        additionalProperties: false,
      },
    },
  },
  required: ["recommendations"],
  additionalProperties: false,
} as const;

export async function submitBatch(
  tenants: { location: Location; ctx: TabContext }[],
): Promise<string> {
  const batch = await client.messages.batches.create({
    requests: tenants.map(({ location, ctx }) => ({
      // location_id alone — the Batch API caps custom_id at 64 chars,
      // too short for "restaurant_id:location_id" (73 chars, two UUIDs).
      // restaurant_id is resolved back at ingest time via a fresh
      // locations lookup; tenant identity for the write still never
      // comes from anything the model returns.
      custom_id: location.id,
      params: {
        model: "claude-sonnet-5",
        max_tokens: 1024,
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: RECOMMENDATIONS_SCHEMA },
        },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(ctx) }],
      },
    })),
  });
  return batch.id;
}

export async function getBatchStatus(anthropicBatchId: string) {
  const batch = await client.messages.batches.retrieve(anthropicBatchId);
  return batch.processing_status; // "in_progress" | "canceling" | "ended"
}

export async function ingestBatchResults(
  anthropicBatchId: string,
  businessDate: string,
  restaurantIdByLocationId: Map<string, string>,
): Promise<RecommendationRow[]> {
  const rows: RecommendationRow[] = [];
  for await (const result of await client.messages.batches.results(anthropicBatchId)) {
    if (result.result.type !== "succeeded") {
      console.error(`[insights] ${result.custom_id}: batch entry ${result.result.type}`);
      continue;
    }
    const locationId = result.custom_id;
    const restaurantId = restaurantIdByLocationId.get(locationId);
    if (!restaurantId) {
      console.error(
        `[insights] ${locationId}: no matching location found at ingest time — skipping`,
      );
      continue;
    }
    // Batch results come back as a plain Message (no client-side .parse()
    // wrapper), so read the guaranteed-valid JSON text block directly
    // rather than relying on the parsed_output convenience field.
    const text = result.result.message.content.find((b) => b.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text) as {
      recommendations: { tab: string; severity: string; headline: string; body: string }[];
    };
    for (const rec of parsed.recommendations ?? []) {
      rows.push({
        restaurant_id: restaurantId,
        location_id: locationId,
        business_date: businessDate,
        ...rec,
      });
    }
  }
  return rows;
}
