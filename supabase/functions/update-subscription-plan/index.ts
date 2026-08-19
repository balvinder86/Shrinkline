// Changes an existing subscription's tier (boh <-> full) — Checkout
// (create-checkout-session) only handles brand-new subscriptions, this
// is the "Change plan" path for a restaurant that's already
// subscribed. Owner-only, same bar as starting a subscription in the
// first place — this is a real billing decision, not a side-effect of
// an already-permitted action the way sync-subscription-quantity is.
//
// Updates the existing subscription item's price directly via
// Stripe's API (no new Checkout Session, no new payment method
// collection needed — one's already on file). Stripe prorates the
// difference automatically. The resulting customer.subscription.updated
// webhook (Part C) is what actually writes the new plan_tier into the
// subscriptions mirror — this function never writes to it directly,
// same single-writer rule as the rest of Part C/D.
//
//   { restaurant_id, plan_tier }   plan_tier: "boh" | "full"

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

async function assertOwner(userId: string, restaurantId: string) {
  const { data } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (data?.role !== "owner") throw new Error("only an owner can manage billing");
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

    const { restaurant_id: restaurantId, plan_tier: planTier } = await req.json();
    if (!restaurantId) {
      return json({ ok: false, step: "input", error: "restaurant_id is required" }, 400);
    }
    if (planTier !== "boh" && planTier !== "full") {
      return json({ ok: false, step: "input", error: "plan_tier must be 'boh' or 'full'" }, 400);
    }

    try {
      await assertOwner(userData.user.id, restaurantId);
    } catch (e) {
      return json({ ok: false, step: "auth", error: (e as Error).message }, 403);
    }

    const { data: subscription, error: subErr } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id, plan_tier")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (subErr) return json({ ok: false, step: "db", error: subErr.message }, 500);
    if (!subscription?.stripe_subscription_id) {
      return json(
        { ok: false, step: "input", error: "restaurant has no active subscription to change" },
        400,
      );
    }
    if (subscription.plan_tier === planTier) {
      return json({ ok: false, step: "input", error: `already on the ${planTier} plan` }, 400);
    }

    try {
      const priceLookup = (await stripeRequest(
        "prices",
        "GET",
        new URLSearchParams([
          ["lookup_keys[]", planTier],
          ["active", "true"],
        ]),
      )) as { data: { id: string }[] };
      if (!priceLookup.data || priceLookup.data.length === 0) {
        return json(
          {
            ok: false,
            step: "stripe_price",
            error: `No active Stripe price found with lookup_key "${planTier}".`,
          },
          500,
        );
      }
      const newPriceId = priceLookup.data[0].id;

      const stripeSub = await stripeRequest(
        `subscriptions/${subscription.stripe_subscription_id}`,
        "GET",
      );
      const items = stripeSub.items as { data: { id: string; quantity: number }[] };
      const currentItem = items?.data?.[0];
      if (!currentItem) {
        return json(
          { ok: false, step: "stripe_subscription", error: "subscription has no line items" },
          500,
        );
      }

      // Quantity must be re-sent explicitly — Stripe resets a
      // replaced item's quantity to 1 if it's omitted rather than
      // preserving the previous value, confirmed the hard way (a real
      // 2-location subscription dropped to quantity 1 on the first
      // version of this function that didn't do this).
      await stripeRequest(
        `subscriptions/${subscription.stripe_subscription_id}`,
        "POST",
        new URLSearchParams({
          "items[0][id]": currentItem.id,
          "items[0][price]": newPriceId,
          "items[0][quantity]": String(currentItem.quantity),
          proration_behavior: "create_prorations",
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
