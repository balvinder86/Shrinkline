// Invoice OCR service — runs on Railway instead of a Supabase Edge
// Function. The identical enqueue/poll logic against Mindee's V2
// Extraction API worked reliably from curl and plain Node scripts,
// but consistently failed to register jobs for lookup when run from
// inside a Supabase Edge Function (ruled out the model, quota, and
// file content as causes) — moved here since Railway is already
// proven for outbound calls to a third-party API (the Toast sync job).
//
// Not a public-facing service: the frontend calls Supabase's
// invoice-ocr Edge Function (which still verifies the user's session
// JWT, same as before), and that function proxies to this one using
// a shared secret. This service should never be hit directly by a
// browser.

import { createServer } from "node:http";
import {
  getInvoice,
  downloadInvoiceFile,
  setEnqueued,
  setFailed,
  persistResult,
  insertInvoiceLine,
  addInvoiceFlag,
  getVendorProductPackInfo,
  updateVendorProductPackInfoPrice,
  listStuckInvoices,
  listNeverEnqueuedInvoices,
  mimeTypeFromPath,
} from "./db.js";
import { enqueue, checkJob } from "./mindee.js";

// Distributor invoices routinely print line items at CASE level
// (quantity = number of cases, unit_price/total_price = case price)
// with the real per-bottle/per-can pack size named separately — but a
// product's pack size (e.g. "BPC: 12") is a static fact about the SKU,
// printed the same way whether THIS order was for a whole case or a
// single bottle off the shelf. It's therefore only a SUGGESTED value
// for the case/bottle resolution flow below (getVendorProductPackInfo
// / handleCheck) — never applied automatically on its own, since doing
// that blindly is exactly what under/over-costed real lines earlier in
// this project (see project memory, 2026-07-29).
//
// Recognizes the industry-standard pack-size notations distributors
// print in a line's own description text: a labeled count ("BPC:
// 12"), a nested pack ("4/6/12 OZ" = 4 packs of 6 = 24), or a flat
// pack ("24/12 OZ" = 24). Validated against real Southern Glazer's
// (wine/spirits) and Columbia Distributing (beer) invoices — see
// project memory for the specific test data. Confirmed NOT to apply to
// weight-based food distributors (Sysco, Pacific Seafood print case
// weight, not a bottle-style pack count) — those invoices simply won't
// match any pattern here.
//
// Returns null when no known pattern is found.
export function parsePackSize(description: string | null): number | null {
  if (!description) return null;
  const text = description.replace(/\n/g, " ");

  let m = text.match(/\bBPC[:\s]+(\d+)\b/i);
  if (m) return Number(m[1]);

  // Nested pack — "4/6/12 OZ" (4 outer packs of 6 inner units, 12oz
  // each). Checked before the flat pattern below since a 3-number
  // match would otherwise also satisfy the 2-number one.
  m = text.match(/\b(\d+)\s*\/\s*(\d+)\s*\/\s*[\d.]+\s*(OZ|ML|L|GAL|CT)\b/i);
  if (m) return Number(m[1]) * Number(m[2]);

  // Flat pack — "24/12 OZ" (24 units, 12oz each) or "1/24/12 OZ" (1
  // case of 24) falling through from the nested check above.
  m = text.match(/\b(\d+)\s*\/\s*[\d.]+\s*(OZ|ML|L|GAL|CT)\b/i);
  if (m) return Number(m[1]);

  m = text.match(/\bCASE\s+OF\s+(\d+)\b/i);
  if (m) return Number(m[1]);

  m = text.match(/\b(\d+)\s*(?:CT|PK|PACK)\b/i);
  if (m) return Number(m[1]);

  return null;
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const SERVICE_TOKEN = process.env.OCR_SERVICE_TOKEN;
if (!SERVICE_TOKEN) throw new Error("OCR_SERVICE_TOKEN must be set");

// How far a remembered case/bottle resolution's implied price can
// drift from its last known price before it's treated as suspicious
// rather than trusted — see the comment where this is used in
// handleCheck. A real case/bottle mismatch shows up as a jump of
// roughly the pack size (6x-24x in every real example seen so far);
// 3x is well below that while still generous for ordinary price
// changes, which are typically well under 2x even during real
// inflation.
const PRICE_DRIFT_FACTOR = 3;

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

async function handleEnqueue(invoiceId: string) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice.source_file_url) throw new Error("invoice has no source_file_url");
  const fileBuffer = await downloadInvoiceFile(invoice.source_file_url);
  const filename = invoice.source_file_url.split("/").pop() ?? "invoice.pdf";
  const { jobId } = await enqueue(fileBuffer, filename, mimeTypeFromPath(invoice.source_file_url));
  await setEnqueued(invoiceId, jobId);
  return { jobId };
}

async function handleCheck(invoiceId: string) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice.mindee_job_id) throw new Error("no OCR job has been enqueued for this invoice yet");

  const result = await checkJob(invoice.mindee_job_id);
  if (result.status === "processing") return { status: "processing" };
  if (result.status === "failed") {
    await setFailed(invoiceId);
    return { status: "failed", error: result.error };
  }

  const outcome = await persistResult(invoice, result);

  const insertedLines = [];
  let casePricingAdjusted = false;
  let casePricingNeedsReview = false;
  for (const item of result.lineItems) {
    const description = item.description ?? "";
    let detectedPackSize = parsePackSize(description);

    // Only a real vendor + product_code lets us key a remembered
    // resolution — without both, there's no way to look one up or to
    // ask a reviewer to create one, so this line always falls back to
    // today's pre-existing (unmultiplied) behavior.
    const memory =
      outcome.vendorId && item.product_code
        ? await getVendorProductPackInfo(invoice.restaurant_id, outcome.vendorId, item.product_code)
        : null;

    let quantity = item.quantity;
    let unitCostCents = item.unit_price != null ? Math.round(item.unit_price * 100) : null;
    let casePricingStatus: "auto" | "needs_review" | null = null;

    if (memory && item.quantity != null) {
      // A human has already told us, for this exact vendor + product,
      // whether the printed quantity means cases or bottles — trust
      // that over re-parsing the description every time (which is
      // also how a line stays correct even on invoices where Mindee
      // fails to extract the pack-size text at all, e.g. the page 2
      // extraction gap seen in testing).
      const totalUnits =
        memory.orderUnit === "case" && memory.packSize != null
          ? item.quantity * memory.packSize
          : item.quantity;
      const impliedUnitCostCents =
        item.total_price != null ? Math.round((item.total_price / totalUnits) * 100) : null;

      // A resolved order type isn't a fixed fact about the product —
      // an owner buying more to hit a case discount can switch it from
      // bottle-ordering to case-ordering between invoices. Applying a
      // stale resolution to that new line would silently reproduce the
      // exact bug this feature exists to prevent. Cross-check the price
      // this application implies against the last real price it
      // produced: a genuine case/bottle mismatch shows up as a jump of
      // roughly the pack size (6x-24x in every real example seen so
      // far), far past anything normal price drift would ever cause —
      // PRICE_DRIFT_FACTOR is set well below that so it only catches
      // real mismatches, not ordinary price changes.
      const isSuspicious =
        memory.lastUnitCostCents != null &&
        impliedUnitCostCents != null &&
        (impliedUnitCostCents > memory.lastUnitCostCents * PRICE_DRIFT_FACTOR ||
          impliedUnitCostCents < memory.lastUnitCostCents / PRICE_DRIFT_FACTOR);

      if (!isSuspicious) {
        quantity = totalUnits;
        unitCostCents = impliedUnitCostCents ?? unitCostCents;
        casePricingStatus = "auto";
        casePricingAdjusted = true;
        if (impliedUnitCostCents != null && outcome.vendorId && item.product_code) {
          await updateVendorProductPackInfoPrice(
            invoice.restaurant_id,
            outcome.vendorId,
            item.product_code,
            impliedUnitCostCents,
          );
        }
      } else {
        // Looks like the order type may have changed since this was
        // last resolved — don't apply a memory that now looks wrong.
        // Falls through to the same safe, unmultiplied placeholder as
        // a brand-new product. If this invoice's own description
        // didn't yield a fresh pack size (e.g. the page 2 extraction
        // gap), fall back to the remembered one so re-resolving is
        // still a one-click suggestion, not a blank guess.
        if (detectedPackSize == null) detectedPackSize = memory.packSize;
        casePricingStatus = "needs_review";
        casePricingNeedsReview = true;
      }
    } else if (detectedPackSize != null && detectedPackSize > 0 && item.product_code) {
      // A pack size was found but we don't yet know whether this
      // specific order was for a case or a bottle — that ambiguity
      // can't be resolved from OCR alone (see parsePackSize's
      // comment), so this line keeps today's raw numbers as a safe
      // placeholder and waits for a one-click human resolution rather
      // than guessing either way.
      casePricingStatus = "needs_review";
      casePricingNeedsReview = true;
    }

    const { matched } = await insertInvoiceLine(invoice, {
      description,
      quantity,
      unit: item.unit_measure,
      unitCostCents,
      totalCents: item.total_price != null ? Math.round(item.total_price * 100) : null,
      productCode: item.product_code,
      detectedPackSize,
      casePricingStatus,
    });
    insertedLines.push({ description, matched });
  }

  // Surfaced so a reviewer can spot-check an auto-applied conversion,
  // or resolve a pending one, rather than either happening invisibly.
  let flags = outcome.flags;
  if (casePricingAdjusted && !flags.includes("case_pricing_adjusted")) {
    await addInvoiceFlag(invoice.id, "case_pricing_adjusted");
    flags = [...flags, "case_pricing_adjusted"];
  }
  if (casePricingNeedsReview && !flags.includes("case_pricing_needs_review")) {
    await addInvoiceFlag(invoice.id, "case_pricing_needs_review");
    flags = [...flags, "case_pricing_needs_review"];
  }

  return {
    status: "ready",
    supplierName: result.supplierName,
    invoiceNumber: result.invoiceNumber,
    date: result.date,
    totalAmount: result.totalAmount,
    lineItemsExtracted: insertedLines.length,
    lineItemsAutoMatched: insertedLines.filter((l) => l.matched).length,
    flags,
    documentType: outcome.documentType,
    vendorId: outcome.vendorId,
  };
}

const server = createServer(async (req, res) => {
  const respond = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.headers.authorization !== `Bearer ${SERVICE_TOKEN}`) {
    respond(401, { ok: false, error: "unauthorized" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const invoiceId = body.invoice_id;
    if (!invoiceId) {
      respond(400, { ok: false, error: "invoice_id is required" });
      return;
    }

    if (req.url === "/enqueue" && req.method === "POST") {
      respond(200, { ok: true, ...(await handleEnqueue(invoiceId)) });
      return;
    }
    if (req.url === "/check" && req.method === "POST") {
      respond(200, { ok: true, ...(await handleCheck(invoiceId)) });
      return;
    }
    respond(404, { ok: false, error: "not found" });
  } catch (e) {
    respond(500, { ok: false, error: String(e) });
  }
});

server.listen(PORT, () => console.log(`invoice-ocr service listening on :${PORT}`));

// Background sweep — this service runs continuously (unlike the sync
// jobs, which are one-shot Railway crons), so it can just re-check its
// own in-flight jobs on a timer instead of relying on a browser tab
// being open to trigger the poll. Re-checking a job that's still
// genuinely processing is a no-op (handleCheck returns early), so
// there's no risk of double-inserting invoice lines on repeat sweeps —
// only a job that just flipped to ready/failed does real work, and it
// won't match the "processing" filter again on the next sweep.
const RECHECK_INTERVAL_MS = 5 * 60 * 1000;

async function recheckStuckInvoices() {
  let stuck: { id: string }[];
  try {
    stuck = await listStuckInvoices();
  } catch (e) {
    console.error("[background-recheck] failed to list stuck invoices:", e);
    return;
  }
  for (const { id } of stuck) {
    try {
      const result = await handleCheck(id);
      if (result.status !== "processing") {
        console.log(`[background-recheck] ${id}: ${result.status}`);
      }
    } catch (e) {
      console.error(`[background-recheck] ${id} failed:`, e);
    }
  }

  let neverEnqueued: { id: string }[];
  try {
    neverEnqueued = await listNeverEnqueuedInvoices();
  } catch (e) {
    console.error("[background-recheck] failed to list never-enqueued invoices:", e);
    return;
  }
  for (const { id } of neverEnqueued) {
    try {
      await handleEnqueue(id);
      console.log(`[background-recheck] ${id}: enqueued (was never started)`);
    } catch (e) {
      console.error(`[background-recheck] ${id} enqueue retry failed:`, e);
    }
  }
}

setInterval(recheckStuckInvoices, RECHECK_INTERVAL_MS);
recheckStuckInvoices();
