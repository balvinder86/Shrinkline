// Settings > Restaurant profile > "Your brands" — real, self-serve
// hard delete of a whole restaurant ("brand"). Supersedes the earlier
// closure-request-only design (tenant_closure_requests,
// db/phase2/73_tenant_closure_requests.sql, now dropped by
// db/phase2/75_drop_tenant_closure_requests.sql): that scoped brand
// deletion as a platform-operator action from the company portal, but
// nothing was ever built on that side to act on a request, so it just
// sat unused. With the same person owning both the tenant dashboard
// and the company portal today, a real delete here is simpler.
//
// Cancels any active Stripe subscription immediately (not at period
// end — there's no restaurant left to bill for once this runs), then
// deletes the restaurant row, which cascades to every table keyed by
// restaurant_id (memberships, locations, ingredients, invoices,
// everything). There's no undo.
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

async function assertOwner(userId: string, restaurantId: string) {
  const { data } = await supabase
    .from("memberships")
    .select("role")
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (data?.role !== "owner") throw new Error("only an owner can delete a brand");
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

    try {
      await assertOwner(userData.user.id, restaurantId);
    } catch (e) {
      return json({ ok: false, step: "auth", error: (e as Error).message }, 403);
    }

    // Re-validated server-side, not just disabled client-side — must
    // remain owner of at least one other brand, or this dashboard has
    // nothing left to sign into.
    const { data: ownedMemberships, error: membershipsErr } = await supabase
      .from("memberships")
      .select("restaurant_id")
      .eq("user_id", userData.user.id)
      .eq("role", "owner");
    if (membershipsErr) {
      return json({ ok: false, step: "db", error: membershipsErr.message }, 500);
    }
    if ((ownedMemberships ?? []).length <= 1) {
      return json({ ok: false, step: "guard", error: "You can't delete your only brand." }, 400);
    }

    const { data: subscription, error: subErr } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (subErr) return json({ ok: false, step: "db", error: subErr.message }, 500);

    if (subscription?.stripe_subscription_id) {
      const res = await fetch(
        `https://api.stripe.com/v1/subscriptions/${subscription.stripe_subscription_id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
            "Stripe-Version": STRIPE_API_VERSION,
          },
        },
      );
      const data = await res.json();
      // "resource_missing" means Stripe already has no such
      // subscription (e.g. cancelled out-of-band) — fine to proceed.
      // Any other failure blocks the delete rather than silently
      // leaving an orphaned subscription that keeps billing a
      // restaurant that no longer exists.
      if (!res.ok && data?.error?.code !== "resource_missing") {
        return json(
          {
            ok: false,
            step: "stripe",
            error: data?.error?.message ?? "could not cancel the Stripe subscription",
          },
          500,
        );
      }
    }

    const { error: deleteErr } = await supabase.from("restaurants").delete().eq("id", restaurantId);
    if (deleteErr) return json({ ok: false, step: "delete", error: deleteErr.message }, 500);

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ ok: false, step: "unknown", error: (e as Error).message }, 500);
  }
});
