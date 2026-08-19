// Phase 3 Part D (tail end) — "When locations are added/removed
// later: update the Stripe subscription quantity; the webhook mirrors
// the change. Don't edit subscriptions.quantity directly."
//
// Called after a location is created (src/lib/settings/queries.ts's
// useCreateLocation). Membership-only check, not owner-only — matches
// who's already allowed to add a location in the first place
// (locations' own tenant_isolation RLS policy), since this is just a
// billing side-effect of an already-permitted action, not a
// standalone billing decision the way starting a subscription is.
//
// A no-op, not an error, when the restaurant has no subscription yet
// (nothing to sync) — this runs unconditionally after every location
// creation, subscribed or not.
//
//   { restaurant_id }

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_API_VERSION = "2026-07-29.dahlia";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

async function stripeRequest(path: string, method: "GET" | "POST", params?: URLSearchParams) {
  const isGet = method === "GET";
  const url =
    isGet && params
      ? `https://api.stripe.com/v1/${path}?${params}`
      : `https://api.stripe.com/v1/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(!isGet ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: !isGet ? params : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Stripe API error (${res.status})`);
  }
  return data as Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      return json({ ok: false, step: "auth", error: "missing Authorization header" }, 401);
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return json({ ok: false, step: "auth", error: "invalid session" }, 401);
    }

    const { restaurant_id: restaurantId } = await req.json();
    if (!restaurantId) {
      return json({ ok: false, step: "input", error: "restaurant_id is required" }, 400);
    }

    const { data: membership } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!membership) {
      return json({ ok: false, step: "auth", error: "not a member of this restaurant" }, 403);
    }

    const { data: subscription, error: subErr } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (subErr) return json({ ok: false, step: "db", error: subErr.message }, 500);
    if (!subscription?.stripe_subscription_id) {
      // Not subscribed yet — nothing to sync. Not an error: this
      // endpoint is called unconditionally after every location add.
      return json({ ok: true, skipped: true }, 200);
    }

    const { count: locationCount, error: locErr } = await supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId);
    if (locErr) return json({ ok: false, step: "db", error: locErr.message }, 500);

    try {
      const stripeSub = await stripeRequest(
        `subscriptions/${subscription.stripe_subscription_id}`,
        "GET",
      );
      const items = stripeSub.items as { data: { id: string }[] };
      const itemId = items?.data?.[0]?.id;
      if (!itemId) {
        return json(
          { ok: false, step: "stripe_subscription", error: "subscription has no line items" },
          500,
        );
      }

      // Updating the item's own quantity (not creating/replacing the
      // subscription) is what keeps this a plain proration instead of
      // a new billing cycle — Stripe prorates the difference
      // automatically. This produces a customer.subscription.updated
      // event, which is what actually writes the new quantity into
      // the subscriptions mirror (Part C) — not this call directly.
      await stripeRequest(
        `subscriptions/${subscription.stripe_subscription_id}`,
        "POST",
        new URLSearchParams({
          "items[0][id]": itemId,
          "items[0][quantity]": String(locationCount ?? 1),
        }),
      );
    } catch (e) {
      return json({ ok: false, step: "stripe_update", error: (e as Error).message }, 502);
    }

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
