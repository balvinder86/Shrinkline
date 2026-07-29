// Mirrors email-ingest/src/gmail.ts's attachment gate (same constants,
// same allow-list) — duplicated rather than shared since the frontend
// and email-ingest/ are separate npm packages/deployments. Applied
// client-side on manual upload so a bad file is rejected immediately
// instead of after a full upload+OCR round trip, keeping "what gets
// accepted" consistent regardless of whether an invoice arrives by
// email or gets uploaded directly.
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
// Only meaningful for photos/scans — a real invoice needs enough
// resolution to be legible, so a JPG/PNG this small is almost always
// an accidental logo/signature image. A native, text-based PDF has no
// such floor: a short, simple invoice exported directly (not scanned)
// can legitimately be a few KB and still be a complete, real document
// — confirmed live with a real 5KB invoice PDF this check was wrongly
// rejecting. Applied to images only, never to PDFs.
export const MIN_IMAGE_ATTACHMENT_SIZE_BYTES = 20 * 1024; // 20 KB

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);

export function isAllowedAttachmentType(file: File): boolean {
  const mime = file.type?.toLowerCase();
  if (mime && ALLOWED_ATTACHMENT_MIME_TYPES.has(mime)) return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".pdf") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
}

function isPdf(file: File): boolean {
  return file.type?.toLowerCase() === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

// Returns a human-readable rejection reason, or null if the file passes.
export function attachmentGateError(file: File): string | null {
  if (!isAllowedAttachmentType(file)) return "Only PDF, JPG, or PNG files are accepted.";
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) return "File is too large (max 25MB).";
  if (!isPdf(file) && file.size < MIN_IMAGE_ATTACHMENT_SIZE_BYTES) {
    return "File is too small — looks like a logo or signature image, not an invoice.";
  }
  return null;
}
