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
  listStuckInvoices,
  listNeverEnqueuedInvoices,
  mimeTypeFromPath,
} from "./db.js";
import { enqueue, checkJob } from "./mindee.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const SERVICE_TOKEN = process.env.OCR_SERVICE_TOKEN;
if (!SERVICE_TOKEN) throw new Error("OCR_SERVICE_TOKEN must be set");

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
  for (const item of result.lineItems) {
    const description = item.description ?? "";
    const { matched } = await insertInvoiceLine(invoice, {
      description,
      quantity: item.quantity,
      unit: item.unit_measure,
      unitCostCents: item.unit_price != null ? Math.round(item.unit_price * 100) : null,
      totalCents: item.total_price != null ? Math.round(item.total_price * 100) : null,
    });
    insertedLines.push({ description, matched });
  }

  return {
    status: "ready",
    supplierName: result.supplierName,
    invoiceNumber: result.invoiceNumber,
    date: result.date,
    totalAmount: result.totalAmount,
    lineItemsExtracted: insertedLines.length,
    lineItemsAutoMatched: insertedLines.filter((l) => l.matched).length,
    flags: outcome.flags,
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
