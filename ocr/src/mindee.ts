// Mindee V2 Extraction API client. Confirmed working from plain
// Node fetch/FormData (curl and a local Node script both succeeded
// reliably) — the same logic run from a Supabase Edge Function
// consistently failed to register jobs for lookup even after ruling
// out the model, quota, and file content. Moved here to run from
// Railway instead, which we already trust for external API calls
// (the Toast sync job).

const MINDEE_API_KEY = process.env.MINDEE_API_KEY!;
const MINDEE_MODEL_ID = process.env.MINDEE_MODEL_ID!;

export type MindeeField<T> = { value: T | null };
export type MindeeLineItem = {
  description: string | null;
  product_code: string | null;
  quantity: number | null;
  total_price: number | null;
  unit_measure: string | null;
  unit_price: number | null;
};

// Was hardcoded to application/pdf regardless of the actual file —
// harmless while only PDFs ever reached this function, but wrong now
// that email-ingest's attachment gate also allows JPG/PNG. Whether
// this custom-trained Mindee model actually extracts line items from
// an image (vs. just PDFs) is unverified — if it rejects the upload,
// the existing ocr_status='failed' path already surfaces that for
// human review, so there's no new failure mode to build for.
export async function enqueue(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string = "application/pdf",
): Promise<{ jobId: string }> {
  const blob = new Blob([Uint8Array.from(fileBuffer)], { type: mimeType });
  const form = new FormData();
  form.set("model_id", MINDEE_MODEL_ID);
  form.set("file", blob, filename);
  // The explicit filename field (separate from the file part's own
  // filename metadata) is required — without it, enqueue still
  // returns a plausible-looking job id, but it never registers for
  // lookup. Confirmed by direct testing.
  form.set("filename", filename);

  const res = await fetch("https://api-v2.mindee.net/v2/products/extraction/enqueue", {
    method: "POST",
    headers: { Authorization: MINDEE_API_KEY },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.job?.id) {
    throw new Error(`Mindee enqueue failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return { jobId: body.job.id };
}

export type JobCheckResult =
  | { status: "processing" }
  | { status: "failed"; error: unknown }
  | {
      status: "ready";
      supplierName: string | null;
      invoiceNumber: string | null;
      date: string | null;
      totalAmount: number | null;
      lineItems: MindeeLineItem[];
      // Best-effort — average of the 4 key fields' confidence, only
      // when Mindee actually returns a `.confidence` on every one of
      // them (unverified whether this custom model does). null means
      // "no confidence signal available," not "low confidence" — the
      // caller must not treat null as a flag-worthy value.
      confidence: number | null;
    };

function fieldValue(field: any): any {
  return field?.value ?? null;
}

function fieldConfidence(field: any): number | null {
  return typeof field?.confidence === "number" ? field.confidence : null;
}

export async function checkJob(jobId: string): Promise<JobCheckResult> {
  // fetch() follows redirects by default. Once Mindee finishes
  // processing, GET /v2/jobs/{id} 302s straight to the result body —
  // so a successful jobRes here can already BE the inference result,
  // not the {job:{status,...}} wrapper. Check for that shape first;
  // relying on jobBody.job.status alone made completed jobs look like
  // they were stuck "processing" forever.
  const jobRes = await fetch(`https://api-v2.mindee.net/v2/jobs/${jobId}`, {
    headers: { Authorization: MINDEE_API_KEY },
  });
  const jobBody = await jobRes.json().catch(() => null);
  if (!jobRes.ok) {
    if (jobRes.status === 404) return { status: "processing" };
    throw new Error(`job check failed (${jobRes.status}): ${JSON.stringify(jobBody)}`);
  }

  let resultBody = jobBody;
  if (!jobBody?.inference) {
    const status = jobBody?.job?.status;
    if (status === "Failed") return { status: "failed", error: jobBody?.job?.error };
    if (status !== "Processed") return { status: "processing" };

    const resultUrl = jobBody?.job?.result_url;
    if (!resultUrl) throw new Error("job Processed but no result_url");
    const resultRes = await fetch(resultUrl, { headers: { Authorization: MINDEE_API_KEY } });
    resultBody = await resultRes.json();
    if (!resultRes.ok) throw new Error(`result fetch failed (${resultRes.status}): ${JSON.stringify(resultBody)}`);
  }

  const fields = resultBody?.inference?.result?.fields;
  if (!fields) throw new Error(`unexpected result shape: ${JSON.stringify(resultBody)}`);

  const keyFieldConfidences = [
    fieldConfidence(fields.supplier_name),
    fieldConfidence(fields.invoice_number),
    fieldConfidence(fields.date),
    fieldConfidence(fields.total_amount),
  ].filter((c): c is number => c !== null);

  return {
    status: "ready",
    supplierName: fieldValue(fields.supplier_name),
    invoiceNumber: fieldValue(fields.invoice_number),
    date: fieldValue(fields.date),
    totalAmount: fieldValue(fields.total_amount),
    lineItems: (fields.line_items?.items ?? []).map((item: any) => {
      const f = item?.fields ?? {};
      return {
        description: fieldValue(f.description),
        product_code: fieldValue(f.product_code),
        quantity: fieldValue(f.quantity),
        total_price: fieldValue(f.total_price),
        unit_measure: fieldValue(f.unit_measure),
        unit_price: fieldValue(f.unit_price),
      };
    }),
    confidence:
      keyFieldConfidences.length === 4
        ? keyFieldConfidences.reduce((a, b) => a + b, 0) / keyFieldConfidences.length
        : null,
  };
}
