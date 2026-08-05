// Starts the real, self-serve "Connect Gmail" flow for invoice
// ingestion — the multi-tenant-friendly replacement for
// email-ingest/get-refresh-token.mjs, a local script with a
// `localhost` OAuth redirect and a hand-pasted refresh token. Mirrors
// search-console-oauth-start/callback exactly (same GOOGLE_WEB_CLIENT_ID
// "Web application" client, same signed-state handoff) — that flow
// already proved this pattern out for a different Google API.
//
// Reuses GOOGLE_WEB_CLIENT_ID, not GMAIL_CLIENT_ID/SECRET — the latter
// is a "Desktop" type OAuth client (used by the local script) that
// can't be configured with a custom HTTPS redirect URI at all, only
// localhost loopback. The Gmail scopes below must be enabled on the
// same Google Cloud project/consent screen as GOOGLE_WEB_CLIENT_ID.
//
//   { restaurant_id }
//
// Verifies the caller's session JWT and restaurant membership before
// returning anything.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { signState } from "../_shared/oauth-state.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GOOGLE_WEB_CLIENT_ID = Deno.env.get("GOOGLE_WEB_CLIENT_ID")!;
const OAUTH_STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

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

    const { restaurant_id } = await req.json();
    if (!restaurant_id) {
      return json({ ok: false, error: "restaurant_id is required" }, 400);
    }

    const { data: membership } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .eq("restaurant_id", restaurant_id)
      .maybeSingle();
    if (!membership) {
      return json({ ok: false, error: "not a member of this restaurant" }, 403);
    }

    const state = await signState(OAUTH_STATE_SECRET, restaurant_id);

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", GOOGLE_WEB_CLIENT_ID);
    authUrl.searchParams.set(
      "redirect_uri",
      `${SUPABASE_URL}/functions/v1/connect-gmail-callback`,
    );
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set(
      "scope",
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email",
    );
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);

    return json({ ok: true, authUrl: authUrl.toString() }, 200);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
