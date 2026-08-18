// Stripe webhook receiver — Part C of phase3-billing-onboarding-spec_4.md.
// Runs on Railway rather than a Supabase Edge Function, matching every
// other backend job in this repo (ocr, sync, email-ingest,
// review-agent) — this service is never called by the frontend at
// all, only by Stripe itself.
//
// STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are plain Railway
// environment variables, not Supabase Vault — Vault in this repo is
// reserved for per-tenant dynamic credentials referenced by name from
// a DB column (Toast/Gmail OAuth tokens, read via get_pos_secret from
// Edge Functions). This is a single, app-wide secret consumed by a
// standalone Node service, the same category as MINDEE_API_KEY in
// ocr/ and SUPABASE_SERVICE_ROLE_KEY here — set directly in Railway's
// dashboard for this service.

import { createServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { upsertSubscriptionFromEvent, markPastDueBySubscriptionId } from "./db.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY must be set");
if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET must be set");

const stripe = new Stripe(STRIPE_SECRET_KEY);

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function planTierFromSubscription(subscription: Stripe.Subscription): "boh" | "full" {
  const lookupKey = subscription.items.data[0]?.price?.lookup_key;
  if (lookupKey === "boh" || lookupKey === "full") return lookupKey;
  throw new Error(
    `subscription ${subscription.id} price has no recognized lookup_key (got: ${lookupKey ?? "none"})`,
  );
}

// Stripe moved per-item billing-period fields off the top-level
// Subscription object onto each subscription item during its 2024-25
// "flexible billing" rollout — the exact shape depends on which API
// version the account is pinned to. Checked defensively (item-level
// first, falling back to the older top-level field via a loose cast)
// rather than assumed, so this doesn't silently break if the account's
// pinned API version differs from what this was written against.
function currentPeriodEndFromSubscription(subscription: Stripe.Subscription): string | null {
  const itemLevel = subscription.items.data[0] as unknown as { current_period_end?: number };
  const legacyTopLevel = subscription as unknown as { current_period_end?: number };
  const epochSeconds = itemLevel?.current_period_end ?? legacyTopLevel?.current_period_end;
  return epochSeconds ? new Date(epochSeconds * 1000).toISOString() : null;
}

async function handleSubscriptionEvent(subscription: Stripe.Subscription) {
  const restaurantId = subscription.metadata.restaurant_id;
  if (!restaurantId) {
    // Every subscription this app creates sets this (Part D) — a
    // missing value here means something upstream forgot to, not a
    // normal condition, so this is logged loudly rather than silently
    // dropped.
    console.error(
      `[stripe-webhook] subscription ${subscription.id} has no metadata.restaurant_id — skipping`,
    );
    return;
  }
  await upsertSubscriptionFromEvent({
    restaurantId,
    stripeSubscriptionId: subscription.id,
    // Stored verbatim — Stripe already sets status to 'canceled' on
    // the subscription object itself when a
    // customer.subscription.deleted event fires, so created/updated/
    // deleted all share this one handler with no special-casing.
    status: subscription.status,
    planTier: planTierFromSubscription(subscription),
    quantity: subscription.items.data[0]?.quantity ?? 1,
    currentPeriodEnd: currentPeriodEndFromSubscription(subscription),
  });
}

const server = createServer(async (req, res) => {
  const respond = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.url !== "/webhook" || req.method !== "POST") {
    respond(404, { ok: false, error: "not found" });
    return;
  }

  const signature = req.headers["stripe-signature"];
  if (!signature || Array.isArray(signature)) {
    respond(400, { ok: false, error: "missing stripe-signature header" });
    return;
  }

  // Signature verification needs the exact raw bytes Stripe signed —
  // reading/parsing JSON first would verify a re-serialized copy that
  // may not byte-for-byte match what was actually signed.
  const rawBody = await readRawBody(req);

  let event: Stripe.Event;
  try {
    // The single security-critical line in this file. Without it,
    // anyone who finds this URL could POST a forged
    // "subscription active" event and unlock paid modules for free —
    // never parse or act on the body ahead of this line.
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[stripe-webhook] signature verification failed:", e);
    respond(400, { ok: false, error: "signature verification failed" });
    return;
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionEvent(event.data.object);
        break;
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        // Stripe moved this off a top-level `invoice.subscription`
        // field during its 2024-25 API restructuring — it now lives
        // under parent.subscription_details on the current API
        // version (confirmed against the installed SDK's own types;
        // if this account is pinned to an older API version, this
        // will need to fall back to the legacy top-level field).
        const subscriptionRef = invoice.parent?.subscription_details?.subscription;
        const subscriptionId =
          typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
        if (subscriptionId) await markPastDueBySubscriptionId(subscriptionId);
        break;
      }
      default:
        // Only the four event types above are meant to be subscribed
        // to on the Stripe dashboard's webhook endpoint config, but an
        // unexpected extra one arriving is just ignored, not an error.
        break;
    }
    // Respond quickly — Stripe retries on any non-2xx, and nothing
    // handled above is slow enough to need backgrounding.
    respond(200, { received: true });
  } catch (e) {
    console.error(`[stripe-webhook] failed to process ${event.type} (${event.id}):`, e);
    respond(500, { ok: false, error: "processing failed" });
  }
});

// Same require.main-equivalent guard the other services use, so this
// file can be imported by a test script without also starting the
// listener.
const isMainModule = process.argv[1] != null && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  server.listen(PORT, () => console.log(`stripe-webhook service listening on :${PORT}`));
}
