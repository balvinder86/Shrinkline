import {
  refreshAccessToken,
  listMessages,
  getMessage,
  getAttachmentBytes,
  extractEmailAddress,
} from "./gmail.js";
import {
  getEmailCredentials,
  getVaultSecret,
  isMessageProcessed,
  markMessageProcessed,
  getFirstLocationId,
  uploadInvoicePdf,
  createPendingInvoice,
  findVendorIdBySenderEmail,
  updateLastSyncedAt,
  enqueueOcr,
  type EmailCredential,
} from "./db.js";

// Re-scans a rolling 14-day window every run rather than trying to
// compute a precise incremental watermark (Gmail's `after:` operator
// is date-granularity only, not to-the-minute) — correctness comes
// from the processed_email_messages dedup table, not from the search
// query being perfectly incremental. This also means a failed run
// self-heals on the next one.
function buildQuery(labelFilter: string | null): string {
  const label = labelFilter ? `label:"${labelFilter}" ` : "";
  return `${label}has:attachment filename:pdf newer_than:14d`;
}

async function syncCredential(cred: EmailCredential) {
  console.log(`[email-ingest] ${cred.connected_email}: starting`);
  const { refreshToken } = await getVaultSecret(cred.vault_secret_name);
  const accessToken = await refreshAccessToken(refreshToken);

  const query = buildQuery(cred.label_filter);
  const messages = await listMessages(accessToken, query);
  console.log(
    `[email-ingest] ${cred.connected_email}: query "${query}" matched ${messages.length} message(s)`,
  );

  let created = 0;
  let skipped = 0;

  for (const { id: messageId } of messages) {
    if (await isMessageProcessed(cred.restaurant_id, "gmail", messageId)) {
      skipped++;
      continue;
    }

    try {
      const parsed = await getMessage(accessToken, messageId);
      if (parsed.pdfAttachments.length === 0) {
        // No PDF on this message after all (e.g. matched on a stale
        // index entry) — mark processed so we don't keep rechecking it.
        await markMessageProcessed(cred.restaurant_id, "gmail", messageId, null);
        continue;
      }

      const locationId = await getFirstLocationId(cred.restaurant_id);
      let lastInvoiceId: string | null = null;

      // Looked up once per message (same sender for every attachment
      // on it) rather than per-attachment — a vendor match here just
      // pre-fills vendor_id; the reviewer can still change it in the
      // UI like any other invoice.
      const senderEmail = extractEmailAddress(parsed.fromEmail);
      const matchedVendorId = senderEmail
        ? await findVendorIdBySenderEmail(cred.restaurant_id, senderEmail)
        : null;

      for (const attachment of parsed.pdfAttachments) {
        const bytes = await getAttachmentBytes(accessToken, messageId, attachment.attachmentId);
        const sourceFileUrl = await uploadInvoicePdf(
          cred.restaurant_id,
          attachment.filename,
          bytes,
        );
        const invoiceId = await createPendingInvoice({
          restaurantId: cred.restaurant_id,
          locationId,
          sourceFileUrl,
          fromEmail: parsed.fromEmail,
          subject: parsed.subject,
          vendorId: matchedVendorId,
        });
        // The invoice row already exists at this point — if enqueueOcr
        // fails (e.g. Mindee's own subscription lapsed, nothing to do
        // with this specific email), don't let that fall through to
        // the outer catch below and skip markMessageProcessed, or this
        // same message gets "retried" every run forever, each retry
        // creating a brand-new duplicate invoice for a row that
        // already exists. ocr/'s background sweep retries any invoice
        // that was never successfully enqueued, so it's safe to just
        // log and move on — the row still gets its OCR eventually.
        try {
          await enqueueOcr(invoiceId);
        } catch (enqueueError) {
          console.error(
            `[email-ingest] ${cred.connected_email}: enqueue OCR failed for invoice ${invoiceId} (will retry via ocr/'s background sweep) — ${enqueueError}`,
          );
        }
        lastInvoiceId = invoiceId;
        created++;
        console.log(
          `[email-ingest] ${cred.connected_email}: created invoice ${invoiceId} from "${parsed.subject}" (${attachment.filename})` +
            (matchedVendorId ? ` — matched vendor ${matchedVendorId}` : " — no vendor match"),
        );
      }

      await markMessageProcessed(cred.restaurant_id, "gmail", messageId, lastInvoiceId);
    } catch (e) {
      // One bad message shouldn't block the rest of the inbox scan —
      // it stays unprocessed and gets retried on the next run.
      console.error(`[email-ingest] ${cred.connected_email}: message ${messageId} FAILED — ${e}`);
    }
  }

  await updateLastSyncedAt(cred.id, new Date());
  console.log(
    `[email-ingest] ${cred.connected_email}: done — ${created} invoice(s) created, ${skipped} already processed`,
  );
}

async function main() {
  const credentials = await getEmailCredentials();
  if (credentials.length === 0) {
    console.log("[email-ingest] no email_ingestion_credentials rows found — nothing to do");
    return;
  }
  for (const cred of credentials) {
    try {
      await syncCredential(cred);
    } catch (e) {
      console.error(`[email-ingest] ${cred.connected_email}: FAILED — ${e}`);
    }
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[email-ingest] fatal:", e);
    process.exit(1);
  },
);
