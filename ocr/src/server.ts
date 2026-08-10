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
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import {
  getInvoice,
  downloadInvoiceFile,
  setEnqueued,
  setEnqueuedMultiPage,
  setFailed,
  persistResult,
  insertInvoiceLine,
  addInvoiceFlag,
  getVendorCategory,
  getVendorProductPackInfo,
  updateVendorProductPackInfoPrice,
  insertInvoicePageJobs,
  getInvoicePageJobs,
  savePageJobResult,
  createInvoiceRowFromTemplate,
  listStuckInvoices,
  listNeverEnqueuedInvoices,
  mimeTypeFromPath,
  getRecipeImport,
  setRecipeImportProcessing,
  setRecipeImportFailed,
  listStuckRecipeImports,
  listNeverStartedRecipeImports,
  type Invoice,
  type ReadyResult,
} from "./db.js";
import { enqueue, checkJob } from "./mindee.js";
import { processRecipeImport } from "./recipeImport.js";

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

  // Food packaging notation — "6/#10 CAN" (6 cans, #10 size each) or
  // "2/5#CS" (2 rolls, 5lb each, per case). Validated against real
  // FSI line items, including that it does NOT false-positive on
  // "14/16 GAS FLUSHE" (a real bacon slice-count spec, not a pack
  // size) or "1/4"X1/2"" (a fry-cut fraction) — both lack the
  // required trailing "#".
  m = text.match(/\b(\d+)\s*\/\s*#\s*\d+\b/i);
  if (m) return Number(m[1]);
  m = text.match(/\b(\d+)\s*\/\s*(\d+)\s*#/);
  if (m) return Number(m[1]);

  return null;
}

// A line whose case-level arithmetic doesn't hold — quantity ×
// unit_price far from total_price — is priced by real, variable
// weight (a natural protein cut, "$9.37/lb × the real delivered
// weight") rather than a flat per-case/per-unit rate; trust it as
// extracted, same conclusion already reached for Sysco/Pacific
// Seafood. Deliberately arithmetic rather than reading the unit/size
// text: Mindee doesn't reliably populate unit_measure for FSI
// (confirmed null on every real line tested), and text alone can't
// tell a genuinely weight-variable product ("13#AV") apart from a
// merely large FIXED-weight case ("15#") that's actually still a
// stable, flat-priced unit — arithmetic tells the two apart directly
// (verified against 4 real weight-variable FSI lines, each off by
// 10x-38x, versus every stable line matching exactly).
function isWeightVariable(quantity: number | null, unitPrice: number | null, totalPrice: number | null): boolean {
  if (quantity == null || unitPrice == null || totalPrice == null) return false;
  return Math.abs(quantity * unitPrice - totalPrice) > 0.02;
}

// Case-pricing memory (vendor_product_pack_info) is keyed by product
// code — but Mindee often doesn't extract one at all. Confirmed real
// and widespread, not vendor-specific: 79% of Southern Glazer's real
// lines, 100% of Columbia Distributing/Sysco/Pacific Seafood/Greco
// lines had product_code null, silently making the whole resolve/
// remember system inapplicable to most real lines across nearly every
// vendor tested. Falls back to a normalized description when there's
// no real code — less stable than a true SKU (OCR noise between
// invoices could drift the key slightly), but far better than no key
// at all, which meant zero protection. Prefixed so a real product
// code can never coincidentally collide with a fallback key.
function resolutionKey(productCode: string | null, description: string | null): string | null {
  if (productCode) return productCode;
  if (!description) return null;
  const normalized = description.replace(/\n/g, " ").trim().toUpperCase().replace(/\s+/g, " ");
  return normalized ? `desc:${normalized}` : null;
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

async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return doc.getPageCount();
}

async function splitPdfPages(buffer: Buffer): Promise<Buffer[]> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages: Buffer[] = [];
  for (let i = 0; i < src.getPageCount(); i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    pages.push(Buffer.from(await doc.save()));
  }
  return pages;
}

export async function handleEnqueue(invoiceId: string) {
  const invoice = await getInvoice(invoiceId);
  if (!invoice.source_file_url) throw new Error("invoice has no source_file_url");
  const fileBuffer = await downloadInvoiceFile(invoice.source_file_url);
  const filename = invoice.source_file_url.split("/").pop() ?? "invoice.pdf";
  const mimeType = mimeTypeFromPath(invoice.source_file_url);

  // A vendor sometimes batches multiple separate real invoices into
  // one emailed PDF attachment (confirmed real on an FSI invoice —
  // see project memory, 2026-07-31) — Mindee gives no page/location
  // metadata back for this custom model, so there's no way to tell
  // from a single whole-document job where one invoice ends and the
  // next begins. Each page gets its own real job instead; the
  // invoice_number each page's job finds is what actually detects the
  // boundaries, in handleCheckMultiPage below. Single-page files (the
  // vast majority) are completely unaffected — still exactly one
  // Mindee call, same as always.
  if (mimeType === "application/pdf") {
    const pageCount = await getPdfPageCount(fileBuffer);
    if (pageCount > 1) {
      const pages = await splitPdfPages(fileBuffer);
      const jobs: { pageNumber: number; mindeeJobId: string }[] = [];
      for (let i = 0; i < pages.length; i++) {
        const { jobId } = await enqueue(pages[i], `${filename}-page${i + 1}.pdf`, mimeType);
        jobs.push({ pageNumber: i + 1, mindeeJobId: jobId });
      }
      await insertInvoicePageJobs(invoice.restaurant_id, invoiceId, jobs);
      await setEnqueuedMultiPage(invoiceId);
      return { jobId: null, pageCount };
    }
  }

  const { jobId } = await enqueue(fileBuffer, filename, mimeType);
  await setEnqueued(invoiceId, jobId);
  return { jobId };
}

async function processReadyResult(invoice: Invoice, result: ReadyResult) {
  const outcome = await persistResult(invoice, result);

  // Case/bottle resolution is a food-and-beverage-distributor concept
  // (cases of bottles/cans) — a maintenance, utilities, or SaaS/POS
  // vendor never has it, so skip the whole branch for anything else
  // (including a not-yet-matched vendor, since we can't tell either
  // way for those).
  const vendorCategory = outcome.vendorId ? await getVendorCategory(outcome.vendorId) : null;
  const appliesToCasePricing = vendorCategory === "food_beverage";

  const insertedLines = [];
  let casePricingAdjusted = false;
  let casePricingNeedsReview = false;
  for (const item of result.lineItems) {
    const description = item.description ?? "";
    let detectedPackSize = appliesToCasePricing ? parsePackSize(description) : null;
    const key = resolutionKey(item.product_code, item.description);

    // Only a real vendor + resolution key lets us look up or create a
    // remembered resolution — without both, this line always falls
    // back to today's pre-existing (unmultiplied) behavior.
    const memory =
      appliesToCasePricing && outcome.vendorId && key
        ? await getVendorProductPackInfo(invoice.restaurant_id, outcome.vendorId, key)
        : null;

    let quantity = item.quantity;
    let unitCostCents = item.unit_price != null ? Math.round(item.unit_price * 100) : null;
    let casePricingStatus: "auto" | "needs_review" | null = null;

    if (!appliesToCasePricing) {
      // Leave quantity/cost exactly as extracted, no case/bottle
      // question — nothing below this branch applies.
    } else if (memory && item.quantity != null) {
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
        if (impliedUnitCostCents != null && outcome.vendorId && key) {
          await updateVendorProductPackInfoPrice(
            invoice.restaurant_id,
            outcome.vendorId,
            key,
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
    } else if (!isWeightVariable(item.quantity, item.unit_price, item.total_price) && key) {
      // No memory yet for this vendor + product, and the line's own
      // arithmetic doesn't mark it as a naturally weight-variable item
      // (real proteins, produce) — meaning it might be case-packed
      // with no way to tell from this line alone, whether or not a
      // pack size could actually be parsed out of the description.
      // Most real food-vendor case-packed items print their pack size
      // (e.g. "10 gloves per case") only in a printed column Mindee
      // doesn't reliably extract, not in the item's own name the way
      // most beverages do — flag every one of these once per vendor +
      // product rather than only the minority parsePackSize can find a
      // number for, or most food case-pricing errors would never
      // surface at all. Never guesses either way; the UI asks for a
      // real number when there's nothing to suggest.
      casePricingStatus = "needs_review";
      casePricingNeedsReview = true;
    }

    const { matched } = await insertInvoiceLine(invoice, {
      description,
      quantity,
      unit: item.unit_measure,
      unitCostCents,
      totalCents: item.total_price != null ? Math.round(item.total_price * 100) : null,
      productCode: key,
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
    status: "ready" as const,
    invoiceId: invoice.id,
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

type PageJobResult = { pageNumber: number; result: ReadyResult };

// Groups a multi-page document's per-page Mindee results back into
// its real, separate invoices — a page continues the invoice already
// in progress unless it carries its OWN, DIFFERENT invoice number. A
// page with no number at all (e.g. a continuation page that didn't
// visually repeat it) is assumed to belong to the invoice already
// under way rather than starting a new, numberless one. Verified
// against a real 7-page FSI document containing 4 real invoices —
// grouped correctly (1/2/3/1 pages respectively) matching a manual
// read of the source PDF exactly.
function groupPagesByInvoice(pageResults: PageJobResult[]): ReadyResult[] {
  const groups: PageJobResult[][] = [];
  for (const pr of pageResults) {
    const currentGroup = groups[groups.length - 1];
    const currentInvoiceNumber = currentGroup?.[currentGroup.length - 1]?.result.invoiceNumber;
    if (currentGroup && (pr.result.invoiceNumber == null || pr.result.invoiceNumber === currentInvoiceNumber)) {
      currentGroup.push(pr);
    } else {
      groups.push([pr]);
    }
  }

  return groups.map((group) => {
    const invoiceNumber = group.map((g) => g.result.invoiceNumber).find((v) => v != null) ?? null;
    const date = group.map((g) => g.result.date).find((v) => v != null) ?? null;
    const supplierName = group.map((g) => g.result.supplierName).find((v) => v != null) ?? null;
    // Totals commonly print on the invoice's final page, not its
    // first — prefer the last non-null value in the group, not the
    // first.
    const totalAmount =
      [...group].reverse().map((g) => g.result.totalAmount).find((v) => v != null) ?? null;
    const lineItems = group.flatMap((g) => g.result.lineItems);
    const confidences = group.map((g) => g.result.confidence).filter((c): c is number => c != null);
    const confidence =
      confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
    return { status: "ready" as const, supplierName, invoiceNumber, date, totalAmount, lineItems, confidence };
  });
}

async function handleCheckMultiPage(
  invoice: Invoice,
  pageJobs: { id: string; pageNumber: number; mindeeJobId: string; result: ReadyResult | null }[],
) {
  // Idempotency — once this row has already been through
  // processReadyResult (document_type gets set there), grouping and
  // per-invoice row creation must never run a second time, or a
  // repeat /check call (a human reopening the review Sheet, the
  // background sweep re-polling) would create duplicate invoice rows
  // and duplicate lines on every re-check.
  if (invoice.document_type) return { status: "ready" as const, alreadyProcessed: true };

  // Checks every page each call rather than stopping at the first
  // still-processing one — pages that happen to finish out of order
  // (confirmed real: page 6 was the last of 7 to finish) still get
  // read and cached in the same round instead of waiting an extra
  // poll cycle for each.
  const pageResults: PageJobResult[] = [];
  let anyStillProcessing = false;
  for (const { id: pageJobId, pageNumber, mindeeJobId, result: cachedResult } of pageJobs) {
    // A page's result may already have been read and cached on an
    // earlier /check call (see savePageJobResult) — a completed
    // Mindee job is effectively one-time/ephemeral, so a page that's
    // already been successfully read must never be re-fetched while
    // waiting on a slower sibling page to finish.
    if (cachedResult) {
      pageResults.push({ pageNumber, result: cachedResult });
      continue;
    }
    const result = await checkJob(mindeeJobId);
    if (result.status === "processing") {
      anyStillProcessing = true;
      continue;
    }
    if (result.status === "failed") {
      // One bad page shouldn't sink the whole batched upload — the
      // rest still get processed into real invoices; the missing
      // page's data is just absent from whichever invoice it would
      // have belonged to.
      console.error(`[multi-page] ${invoice.id} page ${pageNumber} job ${mindeeJobId} failed:`, result.error);
      continue;
    }
    await savePageJobResult(pageJobId, result);
    pageResults.push({ pageNumber, result });
  }

  if (anyStillProcessing) return { status: "processing" as const };

  if (pageResults.length === 0) {
    await setFailed(invoice.id);
    return { status: "failed" as const, error: "all pages failed" };
  }

  const groups = groupPagesByInvoice(pageResults);
  const outcomes = [];
  for (let i = 0; i < groups.length; i++) {
    const targetInvoice = i === 0 ? invoice : await createInvoiceRowFromTemplate(invoice);
    outcomes.push(await processReadyResult(targetInvoice, groups[i]));
  }

  return { status: "ready" as const, multiInvoice: true, invoiceCount: groups.length, results: outcomes };
}

export async function handleCheck(invoiceId: string) {
  const invoice = await getInvoice(invoiceId);
  const pageJobs = await getInvoicePageJobs(invoiceId);
  if (pageJobs.length > 0) return await handleCheckMultiPage(invoice, pageJobs);

  if (!invoice.mindee_job_id) throw new Error("no OCR job has been enqueued for this invoice yet");
  const result = await checkJob(invoice.mindee_job_id);
  if (result.status === "processing") return { status: "processing" };
  if (result.status === "failed") {
    await setFailed(invoiceId);
    return { status: "failed", error: result.error };
  }
  return await processReadyResult(invoice, result);
}

// Unlike Mindee's own job queue, a single Claude call for one document
// is synchronous end to end — there's no external job id to poll. The
// enqueue/check split is kept anyway (see recipeImport.ts's own header
// comment): enqueue flips the row to "processing" and kicks off
// processRecipeImport WITHOUT awaiting it, so the HTTP response (and
// the Edge Function call in front of it) never blocks on however long
// a real Claude call over a big document takes; check is then just a
// cheap read of whatever processRecipeImport has written so far.
export async function handleRecipeImportEnqueue(recipeImportId: string) {
  await getRecipeImport(recipeImportId); // 404s here, not silently inside the background call
  await setRecipeImportProcessing(recipeImportId);
  processRecipeImport(recipeImportId).catch((e) => {
    console.error(`[recipe-import] ${recipeImportId} background processing failed:`, e);
    setRecipeImportFailed(recipeImportId, String(e)).catch((e2) =>
      console.error(`[recipe-import] ${recipeImportId} failed to record failure:`, e2),
    );
  });
  return { status: "processing" };
}

export async function handleRecipeImportCheck(recipeImportId: string) {
  const row = await getRecipeImport(recipeImportId);
  return { status: row.status, result: row.result, error: row.error_detail };
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

    if (req.url === "/enqueue" && req.method === "POST") {
      const invoiceId = body.invoice_id;
      if (!invoiceId) return respond(400, { ok: false, error: "invoice_id is required" });
      respond(200, { ok: true, ...(await handleEnqueue(invoiceId)) });
      return;
    }
    if (req.url === "/check" && req.method === "POST") {
      const invoiceId = body.invoice_id;
      if (!invoiceId) return respond(400, { ok: false, error: "invoice_id is required" });
      respond(200, { ok: true, ...(await handleCheck(invoiceId)) });
      return;
    }
    if (req.url === "/recipe-import/enqueue" && req.method === "POST") {
      const recipeImportId = body.recipe_import_id;
      if (!recipeImportId) return respond(400, { ok: false, error: "recipe_import_id is required" });
      respond(200, { ok: true, ...(await handleRecipeImportEnqueue(recipeImportId)) });
      return;
    }
    if (req.url === "/recipe-import/check" && req.method === "POST") {
      const recipeImportId = body.recipe_import_id;
      if (!recipeImportId) return respond(400, { ok: false, error: "recipe_import_id is required" });
      respond(200, { ok: true, ...(await handleRecipeImportCheck(recipeImportId)) });
      return;
    }
    respond(404, { ok: false, error: "not found" });
  } catch (e) {
    respond(500, { ok: false, error: String(e) });
  }
});

// Guarded so this file can be imported (e.g. by a test script driving
// handleEnqueue/handleCheck directly against a real Mindee job) without
// also starting the HTTP listener and background sweep as a side
// effect — the standard ESM equivalent of `require.main === module`.
const isMainModule = process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  server.listen(PORT, () => console.log(`invoice-ocr service listening on :${PORT}`));
}

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

// Same safety net as recheckStuckInvoices, for recipe_imports — but
// simpler: since nothing here is ever committed until the owner
// reviews it (see recipeImport.ts header), a stuck or never-started
// row is always safe to just retry from scratch via handleEnqueue,
// no idempotency guard needed.
async function recheckStuckRecipeImports() {
  let stuck: { id: string }[];
  try {
    stuck = await listStuckRecipeImports();
  } catch (e) {
    console.error("[background-recheck] failed to list stuck recipe imports:", e);
    return;
  }
  let neverStarted: { id: string }[];
  try {
    neverStarted = await listNeverStartedRecipeImports();
  } catch (e) {
    console.error("[background-recheck] failed to list never-started recipe imports:", e);
    return;
  }
  for (const { id } of [...stuck, ...neverStarted]) {
    try {
      await handleRecipeImportEnqueue(id);
      console.log(`[background-recheck] recipe import ${id}: re-enqueued`);
    } catch (e) {
      console.error(`[background-recheck] recipe import ${id} retry failed:`, e);
    }
  }
}

if (isMainModule) {
  setInterval(recheckStuckInvoices, RECHECK_INTERVAL_MS);
  recheckStuckInvoices();
  setInterval(recheckStuckRecipeImports, RECHECK_INTERVAL_MS);
  recheckStuckRecipeImports();
}
