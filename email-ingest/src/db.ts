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

export async function uploadInvoicePdf(restaurantId: string, filename: string, bytes: Buffer): Promise<string> {
  const path = `${restaurantId}/gmail-${Date.now()}-${filename}`;
  const { error } = await supabase.storage.from("invoice-uploads").upload(path, bytes, { contentType: "application/pdf" });
  if (error) throw new Error(`upload to invoice-uploads failed: ${error.message}`);
  return path;
}

// Matches a sender address (already lowercased, plain — see
// extractEmailAddress) against vendors.invoicing_sender_emails, which
// the app normalizes to lowercase on write, so this is a plain
// case-sensitive array-containment lookup, no citext needed.
export async function findVendorIdBySenderEmail(
  restaurantId: string,
  senderEmail: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("vendors")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .contains("invoicing_sender_emails", [senderEmail])
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`vendor lookup by sender email failed: ${error.message}`);
  return data?.id ?? null;
}

export async function createPendingInvoice(input: {
  restaurantId: string;
  locationId: string;
  sourceFileUrl: string;
  fromEmail: string | null;
  subject: string | null;
  vendorId: string | null;
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
