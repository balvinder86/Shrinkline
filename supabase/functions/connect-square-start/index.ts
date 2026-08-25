// Starts the self-serve "Connect Square" flow — mirrors
// connect-gmail-start exactly (same signed-state handoff via
// ../_shared/oauth-state.ts), with two differences Square's own model
// requires: the state also carries location_id (pos_credentials is
// keyed by location, not restaurant, same as Toast's connect flow),
// and the caller must be an owner, not just a member — same bar
// connect-toast already sets for writing pos_credentials.
//
//   { restaurant_id, location_id }
//
// SQUARE_API_HOSTNAME is an env var (not a hardcoded constant the way
// TOAST_API_HOSTNAME is) specifically so this can point at Square's
// Sandbox during rollout/testing and Production once verified —
// Toast never needed that switch in this codebase, Square does.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { signState } from "../_shared/oauth-state.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SQUARE_APPLICATION_ID = Deno.env.get("SQUARE_APPLICATION_ID")!;
const SQUARE_API_HOSTNAME = Deno.env.get("SQUARE_API_HOSTNAME")!;
const OAUTH_STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// The five scopes this integration needs — orders/sales, catalog
// (menu), merchant profile (to resolve the location on connect), and
// labor (team members + timecards). Verified against Square's OAuth
// permissions reference, not guessed.
const SQUARE_SCOPES = [
  "ORDERS_READ",
  "ITEMS_READ",
  "MERCHANT_PROFILE_READ",
  "TIMECARDS_READ",
  "EMPLOYEES_READ",
].join(" ");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      return json({ ok: false, error: "missing Authorization header" }, 401);
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "invalid session" }, 401);
    }

    const { restaurant_id: restaurantId, location_id: locationId } = await req.json();
    if (!restaurantId || !locationId) {
      return json({ ok: false, error: "restaurant_id and location_id are required" }, 400);
    }

    const { data: membership } = await supabase
      .from("memberships")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (membership?.role !== "owner") {
      return json({ ok: false, error: "only an owner can manage integrations" }, 403);
    }

    const { data: loc } = await supabase
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!loc) {
      return json({ ok: false, error: "that location does not belong to this restaurant" }, 400);
    }

    const state = await signState(OAUTH_STATE_SECRET, restaurantId, locationId);

    const authUrl = new URL(`${SQUARE_API_HOSTNAME}/oauth2/authorize`);
    authUrl.searchParams.set("client_id", SQUARE_APPLICATION_ID);
    authUrl.searchParams.set("scope", SQUARE_SCOPES);
    authUrl.searchParams.set("session", "false");
    authUrl.searchParams.set(
      "redirect_uri",
      `${SUPABASE_URL}/functions/v1/connect-square-callback`,
    );
    authUrl.searchParams.set("state", state);

    return json({ ok: true, authUrl: authUrl.toString() }, 200);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
