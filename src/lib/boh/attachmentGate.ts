// Mirrors email-ingest/src/gmail.ts's attachment gate (same constants,
// same allow-list) — duplicated rather than shared since the frontend
// and email-ingest/ are separate npm packages/deployments. Applied
// client-side on manual upload so a bad file is rejected immediately
// instead of after a full upload+OCR round trip, keeping "what gets
// accepted" consistent regardless of whether an invoice arrives by
// email or gets uploaded directly.
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MIN_ATTACHMENT_SIZE_BYTES = 20 * 1024; // 20 KB — below this is almost always a signature/logo image, not a document

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);

export function isAllowedAttachmentType(file: File): boolean {
  const mime = file.type?.toLowerCase();
  if (mime && ALLOWED_ATTACHMENT_MIME_TYPES.has(mime)) return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".pdf") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
}

// Returns a human-readable rejection reason, or null if the file passes.
export function attachmentGateError(file: File): string | null {
  if (!isAllowedAttachmentType(file)) return "Only PDF, JPG, or PNG files are accepted.";
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) return "File is too large (max 25MB).";
  if (file.size < MIN_ATTACHMENT_SIZE_BYTES) {
    return "File is too small — looks like a logo or signature image, not an invoice.";
  }
  return null;
}
