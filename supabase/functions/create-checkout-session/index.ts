// Phase 3 Part D — starts a real Stripe subscription for a restaurant.
// Creates (or reuses) a Stripe Customer, finds the right Price by its
// lookup_key (boh/full — set up in Stripe's dashboard during Part A),
// and opens a Checkout Session sized to the restaurant's current
// location count. The resulting customer.subscription.created webhook
// (stripe-webhook/, Part C) is what actually writes the subscriptions
// mirror row — this function only ever creates a Checkout Session, it
// never writes to subscriptions itself, so Stripe stays the one source
// of truth end to end.
//
//   { restaurant_id, plan_tier }   plan_tier: "boh" | "full"

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const APP_BASE_URL = Deno.env.get("APP_BASE_URL")!;

// Pinned rather than left to Stripe's account default — same reasoning
// as stripe-webhook/src/server.ts: Stripe's response shapes have
// genuinely moved between API versions (see that file's
// current_period_end/invoice.subscription comments), so this should
// never silently start using a different version than what was tested
// against. Matches the version shown in the Stripe dashboard's
// "Configure your event destination" step during Part A.
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

async function stripeRequest(
  path: string,
  method: "GET" | "POST",
  params?: URLSearchParams,
): Promise<Record<string, unknown>> {
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
  return data;
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

    const { count: locationCount, error: locErr } = await supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId);
    if (locErr) return json({ ok: false, step: "db", error: locErr.message }, 500);
    if (!locationCount || locationCount < 1) {
      return json(
        { ok: false, step: "input", error: "restaurant has no locations to bill for" },
        400,
      );
    }

    const { data: restaurant, error: restErr } = await supabase
      .from("restaurants")
      .select("name, stripe_customer_id")
      .eq("id", restaurantId)
      .single();
    if (restErr || !restaurant) {
      return json(
        { ok: false, step: "db", error: restErr?.message ?? "restaurant not found" },
        404,
      );
    }

    let stripeCustomerId = restaurant.stripe_customer_id as string | null;
    if (!stripeCustomerId) {
      try {
        const customer = (await stripeRequest(
          "customers",
          "POST",
          new URLSearchParams({
            name: restaurant.name,
            "metadata[restaurant_id]": restaurantId,
          }),
        )) as { id: string };
        stripeCustomerId = customer.id;
      } catch (e) {
        return json({ ok: false, step: "stripe_customer", error: (e as Error).message }, 502);
      }

      const { error: updateErr } = await supabase
        .from("restaurants")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", restaurantId);
      if (updateErr) return json({ ok: false, step: "db", error: updateErr.message }, 500);
    }

    let priceId: string;
    try {
      const prices = (await stripeRequest(
        "prices",
        "GET",
        new URLSearchParams([
          ["lookup_keys[]", planTier],
          ["active", "true"],
        ]),
      )) as { data: { id: string }[] };
      if (!prices.data || prices.data.length === 0) {
        return json(
          {
            ok: false,
            step: "stripe_price",
            error: `No active Stripe price found with lookup_key "${planTier}" — check Part A setup.`,
          },
          500,
        );
      }
      priceId = prices.data[0].id;
    } catch (e) {
      return json({ ok: false, step: "stripe_price", error: (e as Error).message }, 502);
    }

    try {
      const session = (await stripeRequest(
        "checkout/sessions",
        "POST",
        new URLSearchParams({
          mode: "subscription",
          customer: stripeCustomerId!,
          "line_items[0][price]": priceId,
          "line_items[0][quantity]": String(locationCount),
          // The webhook (Part C) keys off this to know which
          // restaurant a subscription event belongs to — nothing
          // downstream works without it.
          "subscription_data[metadata][restaurant_id]": restaurantId,
          success_url: `${APP_BASE_URL}/settings?section=billing&checkout=success`,
          cancel_url: `${APP_BASE_URL}/settings?section=billing&checkout=cancelled`,
        }),
      )) as { url: string };
      return json({ ok: true, url: session.url }, 200);
    } catch (e) {
      return json({ ok: false, step: "stripe_checkout", error: (e as Error).message }, 502);
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
