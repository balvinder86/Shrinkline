// Where Square redirects back to after a real tenant approves access
// (see connect-square-start for how this begins). Public GET endpoint
// — mirrors connect-gmail-callback's shape (verify signed state,
// exchange code, store credentials), adapted to Square's own token
// response and its per-merchant "which location" resolution step,
// which Gmail never needed (one connected inbox, not a list of
// locations to pick from).
//
// v1 simplification: if the connected Square merchant has more than
// one location, this takes the first ACTIVE one rather than offering
// a picker — same "one Shrinkline location, one POS credential" model
// Toast's connect flow already assumes. Revisit with a real picker if
// a multi-location Square merchant needs it.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { verifyState } from "../_shared/oauth-state.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SQUARE_APPLICATION_ID = Deno.env.get("SQUARE_APPLICATION_ID")!;
const SQUARE_APPLICATION_SECRET = Deno.env.get("SQUARE_APPLICATION_SECRET")!;
const SQUARE_API_HOSTNAME = Deno.env.get("SQUARE_API_HOSTNAME")!;
const OAUTH_STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const APP_BASE_URL = Deno.env.get("APP_BASE_URL")!;

function redirectToApp(status: "connected" | "error", message?: string): Response {
  const url = new URL(`${APP_BASE_URL}/settings`);
  url.searchParams.set("square", status);
  if (message) url.searchParams.set("message", message);
  return Response.redirect(url.toString(), 302);
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const squareError = url.searchParams.get("error");

    if (squareError) {
      return redirectToApp("error", `Square denied access: ${squareError}`);
    }
    if (!code || !state) {
      return redirectToApp("error", "Missing code or state from Square's redirect.");
    }

    const { restaurantId, locationId } = await verifyState(OAUTH_STATE_SECRET, state);
    if (!locationId) {
      return redirectToApp("error", "Missing location in the connection request.");
    }

    const tokenRes = await fetch(`${SQUARE_API_HOSTNAME}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: SQUARE_APPLICATION_ID,
        client_secret: SQUARE_APPLICATION_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${SUPABASE_URL}/functions/v1/connect-square-callback`,
      }),
    });
    const tokenBody = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenBody?.access_token || !tokenBody?.refresh_token) {
      return redirectToApp("error", "Token exchange with Square failed.");
    }

    const locationsRes = await fetch(`${SQUARE_API_HOSTNAME}/v2/locations`, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    const locationsBody = await locationsRes.json().catch(() => null);
    const squareLocation = (locationsBody?.locations ?? []).find(
      (l: { status?: string }) => l.status === "ACTIVE",
    );
    if (!locationsRes.ok || !squareLocation?.id) {
      return redirectToApp("error", "Could not read the connected Square location.");
    }

    const vaultSecretName = `square_pos_${locationId}`;
    const { error: vaultErr } = await supabase.rpc("set_pos_secret", {
      secret_name: vaultSecretName,
      secret_value: JSON.stringify({
        refreshToken: tokenBody.refresh_token,
        merchantId: tokenBody.merchant_id ?? null,
      }),
    });
    if (vaultErr) {
      return redirectToApp("error", `Could not store credentials: ${vaultErr.message}`);
    }

    const { error: upsertErr } = await supabase.from("pos_credentials").upsert(
      {
        restaurant_id: restaurantId,
        location_id: locationId,
        provider: "square",
        pos_location_ref: squareLocation.id,
        vault_secret_name: vaultSecretName,
        api_hostname: SQUARE_API_HOSTNAME,
      },
      { onConflict: "location_id,provider" },
    );
    if (upsertErr) {
      return redirectToApp("error", `Could not save connection: ${upsertErr.message}`);
    }

    return redirectToApp("connected");
  } catch (e) {
    return redirectToApp("error", String(e));
  }
});
