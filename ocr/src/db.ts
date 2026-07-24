import { createClient } from "@supabase/supabase-js";

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
  source_file_url: string | null;
  mindee_job_id: string | null;
};

export async function getInvoice(invoiceId: string): Promise<Invoice> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, restaurant_id, location_id, source_file_url, mindee_job_id")
    .eq("id", invoiceId)
    .single();
  if (error || !data) throw new Error(`invoice not found: ${error?.message ?? invoiceId}`);
  return data;
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

export async function persistResult(
  invoice: Invoice,
  result: { invoiceNumber: string | null; date: string | null; totalAmount: number | null },
) {
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
}

export async function insertInvoiceLine(
  invoice: Invoice,
  line: {
    description: string;
    quantity: number | null;
    unit: string | null;
    unitCostCents: number | null;
    totalCents: number | null;
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
  });
  if (error) throw new Error(`insert invoice_line failed: ${error.message}`);
  return { matched: matchedIngredientId != null };
}
