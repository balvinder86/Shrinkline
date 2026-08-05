// Self-serve Toast POS connection — replaces the manual "developer runs
// raw SQL against Supabase" provisioning path (see
// db/phase2/35_vault_write_secret.sql's comment: this was true of
// Toast, Gmail, and Google Business Profile alike, fine for a single
// pilot tenant, not something that scales to self-serve onboarding).
//
// Toast's own auth is client-credentials, not OAuth — a restaurant
// owner generates their own Client ID/Secret in Toast's admin portal
// (standard RMS subscription, no partner approval needed since they
// own the restaurant), then pastes them in here. sync/ itself needs no
// changes: it already loops every pos_credentials row.
//
//   { action: "status", restaurant_id }
//   { action: "connect", restaurant_id, location_id, client_id, client_secret, pos_location_ref }

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Production Toast API host — not user-facing. PROJECT_CONTEXT.md
// documents this as the only hostname standard (non-partner) API
// access uses; exposing it as an editable field would just invite typos.
const TOAST_API_HOSTNAME = "https://ws-api.toasttab.com";

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
  if (data?.role !== "owner") throw new Error("only an owner can manage integrations");
}

// Mirrors sync/src/toast.ts's authenticate() — confirms the
// credentials actually work before persisting them, so a typo doesn't
// silently save a broken connection that only surfaces as a sync
// failure hours later.
async function verifyToastCredentials(clientId: string, clientSecret: string): Promise<void> {
  const res = await fetch(`${TOAST_API_HOSTNAME}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret, userAccessType: "TOAST_MACHINE_CLIENT" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Toast rejected these credentials (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  if (!data?.token?.accessToken) {
    throw new Error("Toast did not return an access token — check the Client ID/Secret");
  }
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
    const callerId = userData.user.id;

    const body = await req.json();
    const { action, restaurant_id: restaurantId } = body;
    if (!restaurantId) {
      return json({ ok: false, step: "input", error: "restaurant_id is required" }, 400);
    }

    if (action === "status") {
      const { data, error } = await supabase
        .from("pos_credentials")
        .select("location_id, pos_location_ref, last_synced_at")
        .eq("restaurant_id", restaurantId)
        .eq("provider", "toast")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, connected: !!data, credential: data ?? null }, 200);
    }

    if (action === "connect") {
      try {
        await assertOwner(callerId, restaurantId);
      } catch (e) {
        return json({ ok: false, step: "auth", error: (e as Error).message }, 403);
      }

      const {
        location_id: locationId,
        client_id: clientId,
        client_secret: clientSecret,
        pos_location_ref: posLocationRef,
      } = body;
      if (!locationId || !clientId || !clientSecret || !posLocationRef) {
        return json(
          {
            ok: false,
            step: "input",
            error: "location_id, client_id, client_secret, and pos_location_ref are all required",
          },
          400,
        );
      }

      // Service role bypasses RLS — confirm the location actually
      // belongs to this restaurant before writing anything. This is
      // the only thing stopping a caller from attaching credentials to
      // a location outside their own restaurant.
      const { data: loc, error: locErr } = await supabase
        .from("locations")
        .select("id")
        .eq("id", locationId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (locErr) return json({ ok: false, error: locErr.message }, 500);
      if (!loc) {
        return json(
          { ok: false, step: "input", error: "that location does not belong to this restaurant" },
          400,
        );
      }

      try {
        await verifyToastCredentials(clientId, clientSecret);
      } catch (e) {
        return json({ ok: false, step: "verify", error: (e as Error).message }, 400);
      }

      const vaultSecretName = `toast_pos_${locationId}`;
      const { error: vaultErr } = await supabase.rpc("set_pos_secret", {
        secret_name: vaultSecretName,
        secret_value: JSON.stringify({ clientId, clientSecret }),
      });
      if (vaultErr) return json({ ok: false, step: "vault", error: vaultErr.message }, 500);

      const { error: upsertErr } = await supabase.from("pos_credentials").upsert(
        {
          restaurant_id: restaurantId,
          location_id: locationId,
          provider: "toast",
          pos_location_ref: posLocationRef,
          vault_secret_name: vaultSecretName,
          api_hostname: TOAST_API_HOSTNAME,
        },
        { onConflict: "location_id,provider" },
      );
      if (upsertErr) return json({ ok: false, step: "db", error: upsertErr.message }, 500);

      return json({ ok: true }, 200);
    }

    return json({ ok: false, step: "input", error: `unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
