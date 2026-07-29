// Gmail API client — read-only (gmail.readonly scope). Never modifies
// or deletes anything in the connected inbox; only lists messages,
// reads their content, and downloads attachments.

const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID!;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET!;

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`refresh access token failed (${res.status}): ${JSON.stringify(body)}`);
  return body.access_token;
}

export type GmailMessageSummary = { id: string };

export async function listMessages(accessToken: string, query: string, maxResults = 25): Promise<GmailMessageSummary[]> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`list messages failed (${res.status}): ${JSON.stringify(body)}`);
  return body.messages ?? [];
}

type GmailPart = {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; size?: number };
  parts?: GmailPart[];
};

export type AttachmentCandidate = {
  filename: string;
  attachmentId: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

export type SenderAuthStatus = "pass" | "fail" | "unknown";

export type ParsedMessage = {
  fromEmail: string | null;
  subject: string | null;
  senderAuthStatus: SenderAuthStatus;
  attachments: AttachmentCandidate[];
};

// The From: header is "Display Name <address@domain.com>" (or just a
// bare address) — pull out the plain address so it can be matched
// against a vendor's invoicing_senders list, not the (spoofable)
// display name.
export function extractEmailAddress(raw: string | null): string | null {
  if (!raw) return null;
  const angleMatch = raw.match(/<([^>]+)>/);
  const candidate = (angleMatch ? angleMatch[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

// Gmail's own Authentication-Results header records the receiving
// server's SPF/DKIM/DMARC verdicts on the actual envelope, which is
// the closest thing to "did this really come from where it claims"
// available without running our own auth checks. Any single "fail"
// wins (conservative); "unknown" if the header is absent or none of
// the three mechanisms are present in it.
function parseSenderAuthStatus(headerValue: string | null): SenderAuthStatus {
  if (!headerValue) return "unknown";
  const results: SenderAuthStatus[] = [];
  for (const mechanism of ["spf", "dkim", "dmarc"]) {
    const match = headerValue.match(new RegExp(`\\b${mechanism}=([a-z]+)`, "i"));
    if (!match) continue;
    const verdict = match[1].toLowerCase();
    results.push(verdict === "pass" ? "pass" : verdict === "fail" ? "fail" : "unknown");
  }
  if (results.length === 0) return "unknown";
  if (results.includes("fail")) return "fail";
  return results.every((r) => r === "pass") ? "pass" : "unknown";
}

// Collects every real attachment part (has attachmentId — excludes
// inline content like a signature image referenced but not attached)
// regardless of type; the attachment gate (type/size allow-list)
// runs downstream in index.ts, not here — this just reports what's
// actually on the message.
function findAllAttachments(part: GmailPart | undefined, acc: AttachmentCandidate[]) {
  if (!part) return;
  if (part.body?.attachmentId) {
    acc.push({
      filename: part.filename || "attachment",
      attachmentId: part.body.attachmentId,
      mimeType: part.mimeType ?? null,
      sizeBytes: part.body.size ?? null,
    });
  }
  for (const child of part.parts ?? []) findAllAttachments(child, acc);
}

export async function getMessage(accessToken: string, messageId: string): Promise<ParsedMessage> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`get message failed (${res.status}): ${JSON.stringify(body)}`);

  const headers: { name: string; value: string }[] = body.payload?.headers ?? [];
  const fromHeader = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? null;
  const subjectHeader = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? null;
  const authHeader = headers.find((h) => h.name.toLowerCase() === "authentication-results")?.value ?? null;

  const attachments: AttachmentCandidate[] = [];
  findAllAttachments(body.payload, attachments);

  return {
    fromEmail: fromHeader,
    subject: subjectHeader,
    senderAuthStatus: parseSenderAuthStatus(authHeader),
    attachments,
  };
}

export async function getAttachmentBytes(accessToken: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.json();
  if (!res.ok || !body.data) throw new Error(`get attachment failed (${res.status}): ${JSON.stringify(body)}`);
  // Gmail attachment data is base64url-encoded.
  return Buffer.from(body.data, "base64url");
}

// ------------------------------------------------------------
// Attachment gate — allow-list of types the pipeline can actually
// review (PDF for now, JPG/PNG reach Claude's document-type
// classification either way; whether Mindee's custom model can
// extract line items from an image is unverified, see ocr/src/mindee.ts).
// Refuse everything else (exe/zip/html/macro Office docs etc) rather
// than silently ignoring it, and gate on size so multi-MB noise and
// tiny signature/logo images never reach OCR.
// ------------------------------------------------------------
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
// Only meaningful for photos/scans — a real invoice needs enough
// resolution to be legible, so a JPG/PNG this small is almost always
// an accidental logo/signature image. A native, text-based PDF has no
// such floor: a short invoice exported directly (not scanned) can
// legitimately be a few KB. Applied to images only, never to PDFs —
// see normalizedMimeType() at the call site in index.ts.
export const MIN_IMAGE_ATTACHMENT_SIZE_BYTES = 20 * 1024; // 20 KB

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);

export function isAllowedAttachmentType(candidate: AttachmentCandidate): boolean {
  const mime = candidate.mimeType?.toLowerCase();
  if (mime && ALLOWED_ATTACHMENT_MIME_TYPES.has(mime)) return true;
  const name = candidate.filename.toLowerCase();
  return name.endsWith(".pdf") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png");
}

// Type gate returns a normalized mime type for downstream use (Claude
// classification and, eventually, Mindee) even when Gmail only gave
// us a filename to go on.
export function normalizedMimeType(candidate: AttachmentCandidate): string {
  if (candidate.mimeType) return candidate.mimeType.toLowerCase();
  const name = candidate.filename.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  return "image/jpeg";
}
