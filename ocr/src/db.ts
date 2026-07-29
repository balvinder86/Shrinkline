import { createClient } from "@supabase/supabase-js";
import { classifyDocument } from "./classify.js";
import type { JobCheckResult } from "./mindee.js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

export const supabase = createClient(url, serviceRoleKey);

export type Invoice = {
  id: string;
  restaurant_id: string;
  location_id: string;
  vendor_id: string | null;
  source_file_url: string | null;
  mindee_job_id: string | null;
  document_type: string | null;
  flags: string[];
};

export async function getInvoice(invoiceId: string): Promise<Invoice> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, restaurant_id, location_id, vendor_id, source_file_url, mindee_job_id, document_type, flags")
    .eq("id", invoiceId)
    .single();
  if (error || !data) throw new Error(`invoice not found: ${error?.message ?? invoiceId}`);
  return { ...data, flags: data.flags ?? [] };
}

export async function downloadInvoiceFile(path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from("invoice-uploads").download(path);
  if (error || !data) throw new Error(`download failed: ${error?.message ?? "no file"}`);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function setEnqueued(invoiceId: string, jobId: string) {
  const { error } = await supabase
    .from("invoices")
    .update({ mindee_job_id: jobId, ocr_status: "processing" })
    .eq("id", invoiceId);
  if (error) throw new Error(`update failed: ${error.message}`);
}

export async function setFailed(invoiceId: string) {
  await supabase.from("invoices").update({ ocr_status: "failed" }).eq("id", invoiceId);
}

// Invoices that finished enqueueing (have a real mindee_job_id) but
// never got their result claimed — previously this only happened when
// a human had that exact invoice's review Sheet open in the browser,
// so an email-ingested invoice nobody manually opened could sit
// "processing" forever even after Mindee actually finished the job.
export async function listStuckInvoices(): Promise<{ id: string }[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id")
    .eq("ocr_status", "processing")
    .not("mindee_job_id", "is", null);
  if (error) throw new Error(`list stuck invoices failed: ${error.message}`);
  return data ?? [];
}

// Invoices whose OCR was never even enqueued — email-ingest calls
// enqueueOcr() right after creating the row, but that call can fail
// for reasons that have nothing to do with the specific invoice (e.g.
// Mindee's own subscription lapsing), and email-ingest deliberately
// doesn't retry the same email forever (that previously caused a real
// duplicate-invoice storm — one failed enqueue meant the source email
// was never marked processed, so every ~15-min cron run re-created a
// fresh invoice for the same message). The 2-minute age floor avoids
// racing a legitimate first-attempt enqueue that just hasn't happened
// yet for a brand-new row.
export async function listNeverEnqueuedInvoices(): Promise<{ id: string }[]> {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("invoices")
    .select("id")
    .is("ocr_status", null)
    .is("mindee_job_id", null)
    .not("source_file_url", "is", null)
    .lt("created_at", twoMinutesAgo);
  if (error) throw new Error(`list never-enqueued invoices failed: ${error.message}`);
  return data ?? [];
}

// The invoices row doesn't separately persist the original
// attachment's mime type — inferred from the stored file's name,
// which email-ingest names with the real extension either way.
export function mimeTypeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/pdf";
}

function normalizeVendorName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Only used when the sender gate found no vendor (or an unknown one) —
// fuzzy-matches Mindee's extracted supplier name against this
// restaurant's vendor list. Confident only on an unambiguous single
// match (substring either direction, e.g. "Sysco" vs "Sysco Corp");
// zero or multiple matches leaves vendor_id untouched for a human to
// pick, per "never guess and commit."
async function fallbackMatchVendorByName(
  restaurantId: string,
  supplierName: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("vendors")
    .select("id, name")
    .eq("restaurant_id", restaurantId);
  if (error) throw new Error(`list vendors for name fallback failed: ${error.message}`);
  const normalizedSupplier = normalizeVendorName(supplierName);
  if (!normalizedSupplier) return null;
  const matches = (data ?? []).filter((v) => {
    const normalizedVendor = normalizeVendorName(v.name);
    return (
      normalizedVendor.length > 0 &&
      (normalizedVendor.includes(normalizedSupplier) || normalizedSupplier.includes(normalizedVendor))
    );
  });
  return matches.length === 1 ? matches[0].id : null;
}

// Natural key = vendor + invoice_number. Only checkable once both are
// known — an invoice with no vendor resolved, or a vendor whose bills
// never carry a printed number, simply can't be dedup-checked under
// this key (known v1 limitation, not silently wrong: the caller only
// invokes this once both are non-empty, so this never compares
// against null, which would throw as a Supabase filter, not match).
async function findDuplicateInvoice(
  restaurantId: string,
  vendorId: string,
  invoiceNumber: string,
  excludeInvoiceId: string,
): Promise<{ id: string; invoice_date: string | null } | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_date")
    .eq("restaurant_id", restaurantId)
    .eq("vendor_id", vendorId)
    .eq("invoice_number", invoiceNumber)
    .neq("id", excludeInvoiceId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`duplicate invoice check failed: ${error.message}`);
  return data ?? null;
}

type ReadyResult = Extract<JobCheckResult, { status: "ready" }>;

export type PersistOutcome = { flags: string[]; documentType: string | null; vendorId: string | null };

// Invoice-check → classify → validate → attribution fallback → dedupe,
// replacing the old unconditional field write. Always reaches
// ocr_status='ready' — only a genuine Mindee job failure (handled
// separately in server.ts before this is even called) produces
// ocr_status='failed'; issues found here become flags/document_type
// on an otherwise-normal reviewable row, never a stuck/failed state.
export async function persistResult(invoice: Invoice, result: ReadyResult): Promise<PersistOutcome> {
  // Idempotency guard — handleCheck can be re-invoked on an
  // already-processed invoice (a human reopening the review Sheet
  // re-polls /check; the background sweep can also re-hit one mid-
  // transition). document_type is only ever set once by this
  // pipeline, so its presence means classification/validation/dedupe
  // already ran — skip re-running them (avoids re-billing Claude on
  // every re-check and re-flagging 'duplicate' against itself) and
  // just re-affirm the core fields, which is harmless to repeat.
  if (invoice.document_type) {
    const { error } = await supabase
      .from("invoices")
      .update({
        invoice_number: result.invoiceNumber,
        invoice_date: result.date,
        total_cents: result.totalAmount != null ? Math.round(result.totalAmount * 100) : null,
        ocr_status: "ready",
      })
      .eq("id", invoice.id);
    if (error) throw new Error(`update failed: ${error.message}`);
    return { flags: invoice.flags, documentType: invoice.document_type, vendorId: invoice.vendor_id };
  }

  // Flags accumulate on top of whatever email-ingest already set
  // (unknown_sender / sender_auth_failed) — never overwritten.
  const flags = new Set(invoice.flags);
  const flagDetails: string[] = [];

  const hasAnyMarker =
    result.invoiceNumber != null ||
    result.date != null ||
    result.totalAmount != null ||
    result.lineItems.length > 0;
  if (!hasAnyMarker) flags.add("not_an_invoice");

  const mimeType = mimeTypeFromPath(invoice.source_file_url ?? "");
  const fileBuffer = invoice.source_file_url ? await downloadInvoiceFile(invoice.source_file_url) : null;
  const { documentType } = fileBuffer
    ? await classifyDocument(fileBuffer, mimeType)
    : { documentType: "unclear" as const };

  // Totals validation — folded into low_confidence rather than a
  // false totals_mismatch when there's nothing to sum or nothing to
  // compare against (zero line items, or Mindee didn't find a total).
  if (result.lineItems.length === 0) {
    if (result.totalAmount != null) flags.add("low_confidence");
  } else if (result.totalAmount != null) {
    const sum = result.lineItems.reduce((a, li) => a + (li.total_price ?? 0), 0);
    const tolerance = Math.max(0.02, result.totalAmount * 0.005);
    if (Math.abs(sum - result.totalAmount) > tolerance) {
      flags.add("totals_mismatch");
      flagDetails.push(
        `line items sum to $${sum.toFixed(2)} but total is $${result.totalAmount.toFixed(2)}`,
      );
    }
  }

  if (result.confidence != null && result.confidence < 0.5) {
    flags.add("low_confidence");
  }

  // Attribution fallback runs before dedupe (deviating from the
  // spec's literal received→...→dedupe→attribution ordering) —
  // dedupe's natural key needs vendor_id resolved first, and
  // sender-gate attribution (done in email-ingest) may have left it
  // null.
  let vendorId = invoice.vendor_id;
  if (!vendorId && result.supplierName) {
    vendorId = await fallbackMatchVendorByName(invoice.restaurant_id, result.supplierName);
    if (vendorId) {
      const { error } = await supabase.from("invoices").update({ vendor_id: vendorId }).eq("id", invoice.id);
      if (error) throw new Error(`vendor fallback update failed: ${error.message}`);
    }
  }

  if (vendorId && result.invoiceNumber) {
    const dup = await findDuplicateInvoice(invoice.restaurant_id, vendorId, result.invoiceNumber, invoice.id);
    if (dup) {
      flags.add("duplicate");
      flagDetails.push(
        `matches existing invoice ${dup.id}${dup.invoice_date ? ` dated ${dup.invoice_date}` : ""}`,
      );
    }
  }

  const flagsArray = Array.from(flags);
  const { error } = await supabase
    .from("invoices")
    .update({
      invoice_number: result.invoiceNumber,
      invoice_date: result.date,
      total_cents: result.totalAmount != null ? Math.round(result.totalAmount * 100) : null,
      ocr_status: "ready",
      flags: flagsArray,
      flag_detail: flagDetails.length > 0 ? flagDetails.join("; ") : null,
      document_type: documentType,
    })
    .eq("id", invoice.id);
  if (error) throw new Error(`update failed: ${error.message}`);

  return { flags: flagsArray, documentType, vendorId };
}

export async function addInvoiceFlag(invoiceId: string, flag: string) {
  const { data, error: fetchError } = await supabase
    .from("invoices")
    .select("flags")
    .eq("id", invoiceId)
    .single();
  if (fetchError || !data) throw new Error(`fetch flags failed: ${fetchError?.message ?? invoiceId}`);
  const flags = Array.from(new Set([...(data.flags ?? []), flag]));
  const { error } = await supabase.from("invoices").update({ flags }).eq("id", invoiceId);
  if (error) throw new Error(`update flags failed: ${error.message}`);
}

export async function insertInvoiceLine(
  invoice: Invoice,
  line: {
    description: string;
    quantity: number | null;
    unit: string | null;
    unitCostCents: number | null;
    totalCents: number | null;
    productCode: string | null;
    detectedPackSize: number | null;
    casePricingStatus: "auto" | "needs_review" | null;
  },
) {
  const { data: matchedIngredientId } = await supabase.rpc("match_ingredient", {
    p_restaurant_id: invoice.restaurant_id,
    p_description: line.description,
  });

  const { error } = await supabase.from("invoice_lines").insert({
    restaurant_id: invoice.restaurant_id,
    invoice_id: invoice.id,
    ingredient_id: matchedIngredientId ?? null,
    raw_description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unit_cost_cents: line.unitCostCents,
    line_total_cents: line.totalCents,
    product_code: line.productCode,
    detected_pack_size: line.detectedPackSize,
    case_pricing_status: line.casePricingStatus,
  });
  if (error) throw new Error(`insert invoice_line failed: ${error.message}`);
  return { matched: matchedIngredientId != null };
}

// Per-tenant, per-vendor, per-SKU memory of whether a product is
// ordered by the case or by the bottle from this vendor — see
// db/phase2/48_case_bottle_resolution.sql for why this exists instead
// of trying to get OCR to infer it fresh on every invoice.
export async function getVendorProductPackInfo(
  restaurantId: string,
  vendorId: string,
  productCode: string,
): Promise<{ orderUnit: "case" | "bottle"; packSize: number | null } | null> {
  const { data, error } = await supabase
    .from("vendor_product_pack_info")
    .select("order_unit, pack_size")
    .eq("restaurant_id", restaurantId)
    .eq("vendor_id", vendorId)
    .eq("product_code", productCode)
    .maybeSingle();
  if (error) throw new Error(`fetch vendor_product_pack_info failed: ${error.message}`);
  if (!data) return null;
  return { orderUnit: data.order_unit, packSize: data.pack_size };
}
