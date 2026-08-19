// Review agent proxy — structurally identical to invoice-ocr/index.ts.
// This function's job: verify the caller's session JWT (automatic via
// the platform gateway), verify the caller is actually a member of the
// target restaurant (NOT automatic — the service-role client on the
// Railway side bypasses RLS, so an authenticated user guessing another
// tenant's restaurant_id/review_id must be blocked explicitly here),
// then forward to Railway with a shared secret the browser never sees.
//
//   { action: "scan", restaurant_id }               — read-only, drafts new reviews
//   { action: "post", review_id }                   — posts one approved reply live
//   { action: "regenerate", review_id }             — re-drafts one reply via Claude
//   { action: "gbp_insights", restaurant_id }       — read-only, real GBP Insights scrape
//   { action: "competitor_scan", tracked_query_id }              — read-only, real local-pack + organic scan
//   { action: "backlinks", restaurant_id }                       — read-only, real Search Console Links scrape
//   { action: "competitor_reviews", restaurant_id, competitor_name } — read-only, real competitor review scrape

import { createClient } from "jsr:@supabase/supabase-js@2";
import { assertTierAccess } from "../_shared/tierGate.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const REVIEW_AGENT_SERVICE_URL = Deno.env.get("REVIEW_AGENT_SERVICE_URL")!;
const REVIEW_AGENT_SERVICE_TOKEN = Deno.env.get("REVIEW_AGENT_SERVICE_TOKEN")!;

// Called directly from the browser (see src/lib/reviews/queries.ts), so
// it needs to handle CORS itself — Supabase doesn't add these headers
// automatically.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// Every action in this file operates on Reviews-domain data — gating
// here covers all 7 branches below from one place, same reasoning as
// assertOwner being checked once per call site elsewhere in this repo.
async function assertMember(userId: string, restaurantId: string) {
  const { data: membership } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (!membership) throw new Error("not a member of this restaurant");
  await assertTierAccess(supabase, restaurantId, "reviews");
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

    const { action, restaurant_id, review_id, tracked_query_id, competitor_name } =
      await req.json();

    if (action === "scan") {
      if (!restaurant_id) {
        return json({ ok: false, step: "input", error: "restaurant_id is required" }, 400);
      }
      try {
        await assertMember(userData.user.id, restaurant_id);
      } catch (e) {
        return json({ ok: false, step: "auth", error: (e as Error).message }, 403);
      }

      const railwayRes = await fetch(`${REVIEW_AGENT_SERVICE_URL}/scan`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REVIEW_AGENT_SERVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ restaurant_id }),
      });
      const railwayBody = await railwayRes.json().catch(() => null);
      return json(
        railwayBody ?? { ok: false, error: "empty response from review agent service" },
        railwayRes.status,
      );
    }

    if (action === "post") {
      if (!review_id) {
        return json({ ok: false, step: "input", error: "review_id is required" }, 400);
      }

      const { data: review, error: reviewErr } = await supabase
        .from("reviews")
        .select("id, restaurant_id")
        .eq("id", review_id)
        .single();
      if (reviewErr || !review) {
        return json(
          { ok: false, step: "load_review", error: reviewErr?.message ?? "not found" },
          404,
        );
      }

      try {
        await assertMember(userData.user.id, review.restaurant_id);
      } catch (e) {
        return json({ ok: false, step: "auth", error: (e as Error).message }, 403);
      }

      const railwayRes = await fetch(`${REVIEW_AGENT_SERVICE_URL}/post`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REVIEW_AGENT_SERVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ review_id }),
      });
      const railwayBody = await railwayRes.json().catch(() => null);
      return json(
        railwayBody ?? { ok: false, error: "empty response from review agent service" },
        railwayRes.status,
      );
    }

    if (action === "gbp_insights") {
      if (!restaurant_id) {
        return json({ ok: false, step: "input", error: "restaurant_id is required" }, 400);
      }
      try {
        await assertMember(userData.user.id, restaurant_id);
      } catch (e) {
        return json({ ok: false, step: "auth", error: (e as Error).message }, 403);
      }

      const railwayRes = await fetch(`${REVIEW_AGENT_SERVICE_URL}/gbp-insights`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REVIEW_AGENT_SERVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ restaurant_id }),
      });
      const railwayBody = await railwayRes.json().catch(() => null);
      return json(
        railwayBody ?? { ok: false, error: "empty response from review agent service" },
        railwayRes.status,
      );
    }

    if (action === "competitor_scan") {
      if (!tracked_query_id) {
        return json({ ok: false, step: "input", error: "tracked_query_id is required" }, 400);
      }

      const { data: tracked, error: trackedErr } = await supabase
        .from("competitor_tracked_queries")
        .select("id, restaurant_id")
        .eq("id", tracked_query_id)
        .single();
      if (trackedErr || !tracked) {
        return json(
          { ok: false, step: "load_tracked_query", error: trackedErr?.message ?? "not found" },
          404,
        );
      }

      try {
        await assertMember(userData.user.id, tracked.restaurant_id);
      } catch (e) {
        return json({ ok: false, step: "auth", error: (e as Error).message }, 403);
      }

      const railwayRes = await fetch(`${REVIEW_AGENT_SERVICE_URL}/competitor-scan`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REVIEW_AGENT_SERVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          restaurant_id: tracked.restaurant_id,
          tracked_query_id: tracked.id,
        }),
      });
      const railwayBody = await railwayRes.json().catch(() => null);
      return json(
        railwayBody ?? { ok: false, error: "empty response from review agent service" },
        railwayRes.status,
      );
    }

    if (action === "backlinks") {
      if (!restaurant_id) {
        return json({ ok: false, step: "input", error: "restaurant_id is required" }, 400);
      }
      try {
        await assertMember(userData.user.id, restaurant_id);
      } catch (e) {
        return json({ ok: false, step: "auth", error: (e as Error).message }, 403);
      }

      const railwayRes = await fetch(`${REVIEW_AGENT_SERVICE_URL}/backlinks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REVIEW_AGENT_SERVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ restaurant_id }),
      });
      const railwayBody = await railwayRes.json().catch(() => null);
      return json(
        railwayBody ?? { ok: false, error: "empty response from review agent service" },
        railwayRes.status,
      );
    }

    if (action === "competitor_reviews") {
      if (!restaurant_id || !competitor_name) {
        return json(
          { ok: false, step: "input", error: "restaurant_id and competitor_name are required" },
          400,
        );
      }
      try {
        await assertMember(userData.user.id, restaurant_id);
      } catch (e) {
        return json({ ok: false, step: "auth", error: (e as Error).message }, 403);
      }

      const railwayRes = await fetch(`${REVIEW_AGENT_SERVICE_URL}/competitor-reviews`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REVIEW_AGENT_SERVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ restaurant_id, competitor_name }),
      });
      const railwayBody = await railwayRes.json().catch(() => null);
      return json(
        railwayBody ?? { ok: false, error: "empty response from review agent service" },
        railwayRes.status,
      );
    }

    if (action === "regenerate") {
      if (!review_id) {
        return json({ ok: false, step: "input", error: "review_id is required" }, 400);
      }

      const { data: review, error: reviewErr } = await supabase
        .from("reviews")
        .select("id, restaurant_id")
        .eq("id", review_id)
        .single();
      if (reviewErr || !review) {
        return json(
          { ok: false, step: "load_review", error: reviewErr?.message ?? "not found" },
          404,
        );
      }

      try {
        await assertMember(userData.user.id, review.restaurant_id);
      } catch (e) {
        return json({ ok: false, step: "auth", error: (e as Error).message }, 403);
      }

      const railwayRes = await fetch(`${REVIEW_AGENT_SERVICE_URL}/regenerate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REVIEW_AGENT_SERVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ review_id }),
      });
      const railwayBody = await railwayRes.json().catch(() => null);
      return json(
        railwayBody ?? { ok: false, error: "empty response from review agent service" },
        railwayRes.status,
      );
    }

    return json(
      {
        ok: false,
        step: "input",
        error:
          "action must be 'scan', 'post', 'regenerate', 'gbp_insights', 'competitor_scan', 'backlinks', or 'competitor_reviews'",
      },
      400,
    );
  } catch (e) {
    return json({ ok: false, step: "unexpected", error: String(e) }, 500);
  }
});
