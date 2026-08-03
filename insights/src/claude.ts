import Anthropic from "@anthropic-ai/sdk";
import type { Location, RecommendationRow, TabContext } from "./db.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a back-of-house cost analyst for a restaurant operations platform.
You'll be given one tenant's current per-tab numbers (low-par ingredients, food cost %, invoice
price drift — any of these may be empty if that signal isn't wired up yet). Surface up to 3
recommendations grounded strictly in the numbers given. Never invent a number that isn't present
in the input. If nothing in the input warrants a recommendation, return an empty list rather than
inventing filler.`;

const RECOMMENDATIONS_SCHEMA = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tab: { type: "string", enum: ["food_cost", "inventory", "invoices", "recipes"] },
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
      // restaurant_id:location_id — tenant identity for the ingest step
      // comes from this, never from anything the model returns.
      custom_id: `${location.restaurant_id}:${location.id}`,
      params: {
        model: "claude-opus-5",
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
): Promise<RecommendationRow[]> {
  const rows: RecommendationRow[] = [];
  for await (const result of await client.messages.batches.results(anthropicBatchId)) {
    if (result.result.type !== "succeeded") {
      console.error(`[insights] ${result.custom_id}: batch entry ${result.result.type}`);
      continue;
    }
    const [restaurantId, locationId] = result.custom_id.split(":");
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
