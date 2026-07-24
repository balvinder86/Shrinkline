import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

export const supabase = createClient(url, serviceRoleKey);

export type EmailCredential = {
  id: string;
  restaurant_id: string;
  provider: string;
  connected_email: string;
  vault_secret_name: string;
  label_filter: string | null;
  last_synced_at: string | null;
};

export async function getEmailCredentials(): Promise<EmailCredential[]> {
  const { data, error } = await supabase
    .from("email_ingestion_credentials")
    .select("id, restaurant_id, provider, connected_email, vault_secret_name, label_filter, last_synced_at")
    .eq("provider", "gmail");
  if (error) throw new Error(`load email_ingestion_credentials failed: ${error.message}`);
  return data ?? [];
}

// Reuses the same Vault-secret-reader RPC Toast credentials use — it's
// generic (looks up any named secret), not Toast-specific.
export async function getVaultSecret(vaultSecretName: string): Promise<{ refreshToken: string }> {
  const { data, error } = await supabase.rpc("get_pos_secret", { secret_name: vaultSecretName });
  if (error || !data) throw new Error(`vault secret '${vaultSecretName}' not found: ${error?.message ?? ""}`);
  const parsed = JSON.parse(data);
  if (!parsed.refreshToken) throw new Error(`vault secret '${vaultSecretName}' missing refreshToken`);
  return parsed;
}

export async function isMessageProcessed(restaurantId: string, provider: string, messageId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("processed_email_messages")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("provider", provider)
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) throw new Error(`check processed_email_messages failed: ${error.message}`);
  return !!data;
}

export async function markMessageProcessed(
  restaurantId: string,
  provider: string,
  messageId: string,
  invoiceId: string | null,
) {
  const { error } = await supabase.from("processed_email_messages").insert({
    restaurant_id: restaurantId,
    provider,
    message_id: messageId,
    invoice_id: invoiceId,
  });
  if (error) throw new Error(`insert processed_email_messages failed: ${error.message}`);
}

export async function getFirstLocationId(restaurantId: string): Promise<string> {
  const { data, error } = await supabase.from("locations").select("id").eq("restaurant_id", restaurantId).limit(1).single();
  if (error || !data) throw new Error(`no location found for restaurant ${restaurantId}: ${error?.message ?? ""}`);
  return data.id;
}

export async function uploadInvoiceFile(
  restaurantId: string,
  filename: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const path = `${restaurantId}/gmail-${Date.now()}-${filename}`;
  const { error } = await supabase.storage.from("invoice-uploads").upload(path, bytes, { contentType });
  if (error) throw new Error(`upload to invoice-uploads failed: ${error.message}`);
  return path;
}

export type SenderMatchVendor = { id: string; invoicingSenderEmails: string[] };

// One query per syncCredential() run (not per message) — vendor
// counts per restaurant are small (tens, not thousands), so matching
// happens in JS below rather than round-tripping SQL per message.
export async function listVendorsForSenderMatch(restaurantId: string): Promise<SenderMatchVendor[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("id, invoicing_sender_emails")
    .eq("restaurant_id", restaurantId);
  if (error) throw new Error(`list vendors for sender match failed: ${error.message}`);
  return (data ?? []).map((v) => ({ id: v.id, invoicingSenderEmails: v.invoicing_sender_emails ?? [] }));
}

const BARE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_ENTRY_RE = /^@[^\s@]+\.[^\s@]+$/;

// Malformed entries can predate UI validation or be hand-edited via
// SQL — skip them rather than let one bad row throw the whole cron
// run, or (worse) have a malformed pattern accidentally match
// everything.
function isValidSenderListEntry(entry: string): boolean {
  return BARE_EMAIL_RE.test(entry) || DOMAIN_ENTRY_RE.test(entry);
}

// Exact-address match OR "@domain" suffix match. Both sides are
// already lowercased (extractEmailAddress lowercases the sender;
// invoicing_sender_emails is lowercased on write in the app's toRow),
// so this is plain string comparison.
export function matchVendorForSender(vendors: SenderMatchVendor[], senderEmail: string): string | null {
  const senderDomain = senderEmail.split("@")[1];
  for (const vendor of vendors) {
    for (const entry of vendor.invoicingSenderEmails) {
      if (!isValidSenderListEntry(entry)) continue;
      if (entry === senderEmail) return vendor.id;
      if (entry.startsWith("@") && entry.slice(1) === senderDomain) return vendor.id;
    }
  }
  return null;
}

export async function logIngestionEvent(input: {
  restaurantId: string;
  messageId: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  outcome: "processed" | "skipped";
  reason: string;
  invoiceId: string | null;
}) {
  const { error } = await supabase.from("email_ingestion_events").insert({
    restaurant_id: input.restaurantId,
    message_id: input.messageId,
    filename: input.filename,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    outcome: input.outcome,
    reason: input.reason,
    invoice_id: input.invoiceId,
  });
  if (error) throw new Error(`insert email_ingestion_events failed: ${error.message}`);
}

export async function createPendingInvoice(input: {
  restaurantId: string;
  locationId: string;
  sourceFileUrl: string;
  fromEmail: string | null;
  subject: string | null;
  vendorId: string | null;
  flags: string[];
  senderAuthStatus: "pass" | "fail" | "unknown";
}): Promise<string> {
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      restaurant_id: input.restaurantId,
      location_id: input.locationId,
      vendor_id: input.vendorId,
      status: "pending_review",
      source_file_url: input.sourceFileUrl,
      source_email_from: input.fromEmail,
      source_email_subject: input.subject,
      flags: input.flags,
      sender_auth_status: input.senderAuthStatus,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insert invoice failed: ${error?.message ?? ""}`);
  return data.id;
}

export async function updateLastSyncedAt(credentialId: string, at: Date) {
  const { error } = await supabase
    .from("email_ingestion_credentials")
    .update({ last_synced_at: at.toISOString() })
    .eq("id", credentialId);
  if (error) throw new Error(`update last_synced_at failed: ${error.message}`);
}

export async function enqueueOcr(invoiceId: string) {
  const ocrServiceUrl = process.env.OCR_SERVICE_URL;
  const ocrServiceToken = process.env.OCR_SERVICE_TOKEN;
  if (!ocrServiceUrl || !ocrServiceToken) throw new Error("OCR_SERVICE_URL and OCR_SERVICE_TOKEN must be set");

  const res = await fetch(`${ocrServiceUrl}/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ocrServiceToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ invoice_id: invoiceId }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) throw new Error(`enqueue OCR failed (${res.status}): ${JSON.stringify(body)}`);
}
