import {
  refreshAccessToken,
  listMessages,
  getMessage,
  getAttachmentBytes,
  extractEmailAddress,
  isAllowedAttachmentType,
  normalizedMimeType,
  MAX_ATTACHMENT_SIZE_BYTES,
  MIN_IMAGE_ATTACHMENT_SIZE_BYTES,
} from "./gmail.js";
import {
  getEmailCredentials,
  getVaultSecret,
  isMessageProcessed,
  markMessageProcessed,
  getFirstLocationId,
  uploadInvoiceFile,
  createPendingInvoice,
  listVendorsForSenderMatch,
  matchVendorForSender,
  logIngestionEvent,
  updateLastSyncedAt,
  enqueueOcr,
  type EmailCredential,
} from "./db.js";

// Re-scans a rolling 14-day window every run rather than trying to
// compute a precise incremental watermark (Gmail's `after:` operator
// is date-granularity only, not to-the-minute) — correctness comes
// from the processed_email_messages dedup table, not from the search
// query being perfectly incremental. This also means a failed run
// self-heals on the next one. No `filename:pdf` restriction — JPG/PNG
// are also allowed by the attachment gate below, which needs to see
// them to log a real rejection reason rather than never fetching the
// message at all.
function buildQuery(labelFilter: string | null): string {
  const label = labelFilter ? `label:"${labelFilter}" ` : "";
  return `${label}has:attachment newer_than:14d`;
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

  // One round trip per run, not per message — vendor lists are small
  // per restaurant, matching happens in JS (see matchVendorForSender).
  const vendors = await listVendorsForSenderMatch(cred.restaurant_id);

  let created = 0;
  let flagged = 0;
  let skipped = 0;

  for (const { id: messageId } of messages) {
    if (await isMessageProcessed(cred.restaurant_id, "gmail", messageId)) {
      skipped++;
      continue;
    }

    try {
      const parsed = await getMessage(accessToken, messageId);
      if (parsed.attachments.length === 0) {
        await logIngestionEvent({
          restaurantId: cred.restaurant_id,
          messageId,
          filename: null,
          mimeType: null,
          sizeBytes: null,
          outcome: "skipped",
          reason: "no_attachment",
          invoiceId: null,
        });
        await markMessageProcessed(cred.restaurant_id, "gmail", messageId, null);
        continue;
      }

      const locationId = await getFirstLocationId(cred.restaurant_id);
      let lastInvoiceId: string | null = null;

      // Sender/auth gate — computed once per message (same sender for
      // every attachment on it). A match only pre-fills vendor_id; an
      // unrecognized or auth-failed sender still creates the invoice
      // (never silently drop) but flagged, and vendor_id stays null so
      // a human picks it — same as any other unassigned invoice.
      const senderEmail = extractEmailAddress(parsed.fromEmail);
      const matchedVendorId = senderEmail ? matchVendorForSender(vendors, senderEmail) : null;
      const senderTrusted = matchedVendorId !== null && parsed.senderAuthStatus !== "fail";
      const flags: string[] = [];
      if (!matchedVendorId) flags.push("unknown_sender");
      else if (parsed.senderAuthStatus === "fail") flags.push("sender_auth_failed");

      for (const attachment of parsed.attachments) {
        // Attachment gate — type and size. Every candidate gets a
        // logged decision either way (never a silent drop).
        if (!isAllowedAttachmentType(attachment)) {
          await logIngestionEvent({
            restaurantId: cred.restaurant_id,
            messageId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            outcome: "skipped",
            reason: "wrong_type",
            invoiceId: null,
          });
          continue;
        }
        if (attachment.sizeBytes != null && attachment.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
          await logIngestionEvent({
            restaurantId: cred.restaurant_id,
            messageId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            outcome: "skipped",
            reason: "too_large",
            invoiceId: null,
          });
          continue;
        }
        const isPdfAttachment = normalizedMimeType(attachment) === "application/pdf";
        if (!isPdfAttachment && attachment.sizeBytes != null && attachment.sizeBytes < MIN_IMAGE_ATTACHMENT_SIZE_BYTES) {
          await logIngestionEvent({
            restaurantId: cred.restaurant_id,
            messageId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            outcome: "skipped",
            reason: "too_small",
            invoiceId: null,
          });
          continue;
        }

        // Each attachment gets its own try/catch — a transient failure
        // on one attachment (e.g. a storage upload network blip) must
        // not abort the whole message. Letting it fall through to the
        // outer catch skipped markMessageProcessed, so a retry
        // re-walked every attachment on the message from scratch,
        // re-creating a fresh duplicate invoice for every attachment
        // that had already succeeded — confirmed live (two real
        // duplicate rows for the same image before this fix). A
        // permanently-failing attachment is still never silently
        // dropped — logged as a skipped event with the real error, and
        // the message is still marked processed so it doesn't retry
        // forever creating more successful-attachment duplicates.
        try {
          const bytes = await getAttachmentBytes(accessToken, messageId, attachment.attachmentId);
          const mimeType = normalizedMimeType(attachment);
          const sourceFileUrl = await uploadInvoiceFile(
            cred.restaurant_id,
            attachment.filename,
            bytes,
            mimeType,
          );
          const invoiceId = await createPendingInvoice({
            restaurantId: cred.restaurant_id,
            locationId,
            sourceFileUrl,
            fromEmail: parsed.fromEmail,
            subject: parsed.subject,
            vendorId: senderTrusted ? matchedVendorId : null,
            flags,
            senderAuthStatus: parsed.senderAuthStatus,
          });
          await logIngestionEvent({
            restaurantId: cred.restaurant_id,
            messageId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            outcome: "processed",
            reason: flags.length > 0 ? flags.join(",") : "ok",
            invoiceId,
          });
          // The invoice row already exists at this point — if
          // enqueueOcr fails (e.g. Mindee's own subscription lapsed,
          // nothing to do with this specific email), don't let that
          // throw and get caught as an attachment failure below — the
          // row still gets its OCR eventually via ocr/'s background
          // sweep, which retries any invoice that was never enqueued.
          try {
            await enqueueOcr(invoiceId);
          } catch (enqueueError) {
            console.error(
              `[email-ingest] ${cred.connected_email}: enqueue OCR failed for invoice ${invoiceId} (will retry via ocr/'s background sweep) — ${enqueueError}`,
            );
          }
          lastInvoiceId = invoiceId;
          if (flags.length > 0) flagged++;
          else created++;
          console.log(
            `[email-ingest] ${cred.connected_email}: created invoice ${invoiceId} from "${parsed.subject}" (${attachment.filename})` +
              (flags.length > 0 ? ` — flagged: ${flags.join(",")}` : ` — matched vendor ${matchedVendorId}`),
          );
        } catch (attachmentError) {
          console.error(
            `[email-ingest] ${cred.connected_email}: attachment "${attachment.filename}" on message ${messageId} FAILED (skipping, message still marked processed) — ${attachmentError}`,
          );
          await logIngestionEvent({
            restaurantId: cred.restaurant_id,
            messageId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            outcome: "skipped",
            reason: "processing_error",
            invoiceId: null,
          });
        }
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
    `[email-ingest] ${cred.connected_email}: done — ${created} invoice(s) created, ${flagged} flagged, ${skipped} already processed`,
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
