// Where Google redirects back to after a real tenant approves Gmail
// access for invoice ingestion (see connect-gmail-start for how this
// flow begins). Public GET endpoint — no Authorization header exists
// at this point, since the browser fully navigated away and back. The
// signed `state` param (see ../_shared/oauth-state.ts) is what proves
// which restaurant this belongs to and that it's a real continuation
// of a real member-initiated flow, not a forged request.
//
// Mirrors search-console-oauth-callback exactly. No per-tenant
// "pick a resource" step needed here (Search Console has to pick a
// site; Gmail just has the one connected inbox), so this is slightly
// shorter: exchange code, read the connected email, store the refresh
// token, upsert the credentials row.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyState } from "../_shared/oauth-state.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GOOGLE_WEB_CLIENT_ID = Deno.env.get("GOOGLE_WEB_CLIENT_ID")!;
const GOOGLE_WEB_CLIENT_SECRET = Deno.env.get("GOOGLE_WEB_CLIENT_SECRET")!;
const OAUTH_STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const APP_BASE_URL = Deno.env.get("APP_BASE_URL")!;

function redirectToApp(status: "connected" | "error", message?: string): Response {
  const url = new URL(`${APP_BASE_URL}/settings`);
  url.searchParams.set("gmail", status);
  if (message) url.searchParams.set("message", message);
  return Response.redirect(url.toString(), 302);
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const googleError = url.searchParams.get("error");

    if (googleError) {
      return redirectToApp("error", `Google denied access: ${googleError}`);
    }
    if (!code || !state) {
      return redirectToApp("error", "Missing code or state from Google's redirect.");
    }

    const { restaurantId } = await verifyState(OAUTH_STATE_SECRET, state);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_WEB_CLIENT_ID,
        client_secret: GOOGLE_WEB_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${SUPABASE_URL}/functions/v1/connect-gmail-callback`,
      }),
    });
    const tokenBody = await tokenRes.json();
    if (!tokenRes.ok || !tokenBody.refresh_token) {
      return redirectToApp("error", "Token exchange with Google failed.");
    }

    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    const userInfo = await userInfoRes.json().catch(() => ({}));
    if (!userInfo.email) {
      return redirectToApp("error", "Could not read the connected Gmail address.");
    }

    const vaultSecretName = `gmail_${restaurantId}`;
    const { error: vaultErr } = await supabase.rpc("set_pos_secret", {
      secret_name: vaultSecretName,
      secret_value: JSON.stringify({ refreshToken: tokenBody.refresh_token }),
    });
    if (vaultErr) {
      return redirectToApp("error", `Could not store credentials: ${vaultErr.message}`);
    }

    const { error: upsertErr } = await supabase.from("email_ingestion_credentials").upsert(
      {
        restaurant_id: restaurantId,
        provider: "gmail",
        connected_email: userInfo.email,
        vault_secret_name: vaultSecretName,
      },
      { onConflict: "restaurant_id,provider" },
    );
    if (upsertErr) {
      return redirectToApp("error", `Could not save connection: ${upsertErr.message}`);
    }

    return redirectToApp("connected");
  } catch (e) {
    return redirectToApp("error", String(e));
  }
});
