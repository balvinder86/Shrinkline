import { getBatchStatus, ingestBatchResults, submitBatch } from "./claude.js";
import { sendDigestEmails } from "./digest.js";
import {
  createBatchRecord,
  getAllLocations,
  getTabContext,
  getTodaysBatch,
  markBatchEnded,
  markBatchIngested,
  upsertRecommendations,
  type Location,
  type TabContext,
} from "./db.js";

function todaysBusinessDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// TEMPORARILY DISABLED 2026-09-08 — nightly AI recommendations batch
// submission paused to cut Anthropic API cost. Hard-stops before any
// tenant context is built or a batch submitted, so no
// ai_recommendation_batches row gets written either — re-enabling just
// resumes normal submissions on the next cron tick, no backlog
// catch-up for the paused days. Existing in-flight batches (already
// submitted before this was flipped on) still get polled/ingested
// normally by pollExistingBatch — only new submissions are blocked.
// Re-enable by deleting this block.
const INSIGHTS_DISABLED = true;

async function submitTodaysBatch(businessDate: string) {
  if (INSIGHTS_DISABLED) {
    console.log(`[insights] ${businessDate}: batch submission is disabled — skipping`);
    return;
  }

  const locations = await getAllLocations();

  const tenants: { location: Location; ctx: TabContext }[] = [];
  for (const location of locations) {
    try {
      tenants.push({ location, ctx: await getTabContext(location) });
    } catch (e) {
      // One tenant's context failure shouldn't block the rest of the batch.
      console.error(`[insights] ${location.id}: context build failed (non-fatal): ${e}`);
    }
  }

  if (tenants.length === 0) {
    console.log("[insights] no tenants with usable context — nothing to submit");
    return;
  }

  const anthropicBatchId = await submitBatch(tenants);
  await createBatchRecord(businessDate, anthropicBatchId, tenants.length);
  console.log(
    `[insights] submitted batch ${anthropicBatchId} for ${tenants.length} tenant(s), business_date ${businessDate}`,
  );
}

async function pollExistingBatch(
  id: string,
  anthropicBatchId: string,
  businessDate: string,
  status: "submitted" | "ended" | "ingested",
) {
  if (status === "ingested") {
    console.log(`[insights] ${businessDate}: already ingested — nothing to do`);
    return;
  }

  if (status === "submitted") {
    const processingStatus = await getBatchStatus(anthropicBatchId);
    if (processingStatus !== "ended") {
      console.log(`[insights] ${businessDate}: batch still ${processingStatus}`);
      return;
    }
    await markBatchEnded(id);
  }

  // custom_id in batch results is location_id alone (64-char Batch API
  // limit) — resolve restaurant_id back via a fresh locations lookup.
  const locations = await getAllLocations();
  const restaurantIdByLocationId = new Map(locations.map((l) => [l.id, l.restaurant_id]));

  const rows = await ingestBatchResults(anthropicBatchId, businessDate, restaurantIdByLocationId);
  await upsertRecommendations(rows);
  await markBatchIngested(id);
  console.log(`[insights] ${businessDate}: ingested ${rows.length} recommendation(s)`);

  // Digest goes out per restaurant, not per location/row — every
  // restaurant with at least one location gets a chance at a digest,
  // even one with zero recommendations today (still worth reporting
  // low-par/reviews). sendDigestEmails itself no-ops cleanly if
  // already sent for this business_date.
  const restaurantIds = new Set(locations.map((l) => l.restaurant_id));
  for (const restaurantId of restaurantIds) {
    try {
      await sendDigestEmails(restaurantId, businessDate);
    } catch (e) {
      console.error(`[insights] ${restaurantId}: digest send failed (non-fatal): ${e}`);
    }
  }
}

async function main() {
  const businessDate = todaysBusinessDate();
  const existing = await getTodaysBatch(businessDate);

  if (!existing) {
    await submitTodaysBatch(businessDate);
    return;
  }

  await pollExistingBatch(existing.id, existing.anthropic_batch_id, businessDate, existing.status);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[insights] fatal:", e);
    process.exit(1);
  },
);
