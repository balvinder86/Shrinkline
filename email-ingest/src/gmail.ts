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

export type ParsedMessage = {
  fromEmail: string | null;
  subject: string | null;
  pdfAttachments: { filename: string; attachmentId: string }[];
};

// The From: header is "Display Name <address@domain.com>" (or just a
// bare address) — pull out the plain address so it can be matched
// against a vendor's invoicing_sender_emails, which is a list of
// plain addresses, not header strings.
export function extractEmailAddress(raw: string | null): string | null {
  if (!raw) return null;
  const angleMatch = raw.match(/<([^>]+)>/);
  const candidate = (angleMatch ? angleMatch[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function findPdfAttachments(part: GmailPart | undefined, acc: { filename: string; attachmentId: string }[]) {
  if (!part) return;
  const isPdf = part.mimeType === "application/pdf" || (part.filename?.toLowerCase().endsWith(".pdf") ?? false);
  if (isPdf && part.body?.attachmentId) {
    acc.push({ filename: part.filename || "invoice.pdf", attachmentId: part.body.attachmentId });
  }
  for (const child of part.parts ?? []) findPdfAttachments(child, acc);
}

export async function getMessage(accessToken: string, messageId: string): Promise<ParsedMessage> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`get message failed (${res.status}): ${JSON.stringify(body)}`);

  const headers: { name: string; value: string }[] = body.payload?.headers ?? [];
  const fromHeader = headers.find((h) => h.name.toLowerCase() === "from")?.value ?? null;
  const subjectHeader = headers.find((h) => h.name.toLowerCase() === "subject")?.value ?? null;

  const pdfAttachments: { filename: string; attachmentId: string }[] = [];
  findPdfAttachments(body.payload, pdfAttachments);

  return { fromEmail: fromHeader, subject: subjectHeader, pdfAttachments };
}

export async function getAttachmentBytes(accessToken: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.json();
  if (!res.ok || !body.data) throw new Error(`get attachment failed (${res.status}): ${JSON.stringify(body)}`);
  // Gmail attachment data is base64url-encoded.
  return Buffer.from(body.data, "base64url");
}
