import { getBatchStatus, ingestBatchResults, submitBatch } from "./claude.js";
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

async function submitTodaysBatch(businessDate: string) {
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
