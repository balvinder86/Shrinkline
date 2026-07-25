// One-time script — run locally, not deployed. Creates a Gmail filter
// that auto-applies the "Invoices" label to any incoming email with an
// attachment, so a new vendor's very first email is never missed just
// because nobody set up a label rule for that sender yet. Requires a
// refresh token issued with the gmail.settings.basic scope (see
// get-refresh-token.mjs) — a gmail.readonly-only token will fail here
// with an insufficient-scope error.
//
// Run with:
//   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... GMAIL_REFRESH_TOKEN=... \
//     node setup-invoice-filter.mjs [label name, default "Invoices"]

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const LABEL_NAME = process.argv[2] || "Invoices";

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN first.");
  process.exit(1);
}

async function refreshAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`refresh failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function findOrCreateLabel(accessToken, name) {
  const listRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listBody = await listRes.json();
  if (!listRes.ok) throw new Error(`labels.list failed: ${JSON.stringify(listBody)}`);

  const existing = (listBody.labels ?? []).find((l) => l.name === name);
  if (existing) {
    console.log(`Using existing label "${name}" (id ${existing.id})`);
    return existing.id;
  }

  const createRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
  });
  const createBody = await createRes.json();
  if (!createRes.ok) throw new Error(`labels.create failed: ${JSON.stringify(createBody)}`);
  console.log(`Created label "${name}" (id ${createBody.id})`);
  return createBody.id;
}

async function listExistingFilters(accessToken) {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/filters", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`filters.list failed: ${JSON.stringify(body)}`);
  return body.filter ?? [];
}

// PDF/JPG/JPEG/PNG — matches the attachment-gate allow-list in
// email-ingest/src/gmail.ts (isAllowedAttachmentType) — a vendor
// sending a photo of an invoice instead of a PDF needs the same
// auto-labeling a PDF invoice already gets. Not any-attachment, so
// this doesn't label every logo/signature-image email as an invoice.
const FILTER_QUERY =
  "has:attachment (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png)";

async function createFilter(accessToken, labelId) {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/filters", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      criteria: { query: FILTER_QUERY },
      action: { addLabelIds: [labelId] },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`filters.create failed: ${JSON.stringify(body)}`);
  return body;
}

const accessToken = await refreshAccessToken();
const labelId = await findOrCreateLabel(accessToken, LABEL_NAME);

const existingFilters = await listExistingFilters(accessToken);
const alreadyExists = existingFilters.some(
  (f) => (f.criteria?.query ?? "") === FILTER_QUERY && (f.action?.addLabelIds ?? []).includes(labelId),
);
if (alreadyExists) {
  console.log("A matching filter (hasAttachment -> this label) already exists — nothing to do.");
  process.exit(0);
}

const filter = await createFilter(accessToken, labelId);
console.log(`Created filter ${filter.id}: any email with an attachment now gets labeled "${LABEL_NAME}".`);
