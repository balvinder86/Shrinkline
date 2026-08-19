// Phase 3 Part F (phase 1) — the company portal. Every other page in
// this app is restaurant-scoped (the caller is already a member of
// whatever restaurant_id they're touching); this is the one place
// that isn't — creating a brand-new tenant and inviting its owner is
// a platform-operator action, checked against platform_admins
// (db/phase3/40_platform_admins.sql), a concept independent of
// memberships entirely.
//
//   { action: "list_tenants" }
//   { action: "create_tenant", name, location_name?, location_timezone?, owner_email }
//
// Invite mechanics are copied from manage-team's "invite" action:
// generateLink creates the user and hands back a real link without
// sending anything; if the email already has a real account,
// generateLink errors and the existing user is found via
// get_user_id_by_email and added directly. Unlike manage-team, this
// never auto-sends the link over Gmail — a brand-new tenant has no
// connected Gmail account yet to send from — so the link is always
// just returned for the operator to copy and send themselves.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const APP_BASE_URL = Deno.env.get("APP_BASE_URL")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

async function assertPlatformAdmin(userId: string) {
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("not a platform admin");
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

    try {
      await assertPlatformAdmin(callerId);
    } catch (e) {
      return json({ ok: false, step: "auth", error: (e as Error).message }, 403);
    }

    const body = await req.json();
    const { action } = body;

    if (action === "list_tenants") {
      const { data: restaurants, error: restaurantsErr } = await supabase
        .from("restaurants")
        .select("id, name, created_at")
        .order("created_at", { ascending: false });
      if (restaurantsErr) return json({ ok: false, error: restaurantsErr.message }, 500);

      const tenants = await Promise.all(
        (restaurants ?? []).map(async (r) => {
          const [{ count: locationCount }, { data: subscription }, { data: owners }] =
            await Promise.all([
              supabase
                .from("locations")
                .select("id", { count: "exact", head: true })
                .eq("restaurant_id", r.id),
              supabase
                .from("subscriptions")
                .select("plan_tier, status")
                .eq("restaurant_id", r.id)
                .maybeSingle(),
              supabase
                .from("memberships")
                .select("user_id")
                .eq("restaurant_id", r.id)
                .eq("role", "owner"),
            ]);

          const ownerEmails = await Promise.all(
            (owners ?? []).map(async (o) => {
              const { data: u } = await supabase.auth.admin.getUserById(o.user_id);
              return u.user?.email ?? "unknown";
            }),
          );

          return {
            id: r.id,
            name: r.name,
            createdAt: r.created_at,
            locationCount: locationCount ?? 0,
            planTier: subscription?.plan_tier ?? null,
            status: subscription?.status ?? null,
            ownerEmails,
          };
        }),
      );

      return json({ ok: true, tenants }, 200);
    }

    if (action === "create_tenant") {
      const {
        name,
        location_name: locationName,
        location_timezone: locationTimezone,
        owner_email: ownerEmail,
      } = body;
      if (typeof name !== "string" || !name.trim()) {
        return json({ ok: false, step: "input", error: "name is required" }, 400);
      }
      if (typeof ownerEmail !== "string" || !ownerEmail.includes("@")) {
        return json({ ok: false, step: "input", error: "a valid owner_email is required" }, 400);
      }

      const { data: restaurant, error: restaurantErr } = await supabase
        .from("restaurants")
        .insert({ name: name.trim() })
        .select("id")
        .single();
      if (restaurantErr || !restaurant) {
        return json(
          { ok: false, step: "restaurant", error: restaurantErr?.message ?? "insert failed" },
          500,
        );
      }
      const restaurantId = restaurant.id as string;

      const { error: locationErr } = await supabase.from("locations").insert({
        restaurant_id: restaurantId,
        name:
          typeof locationName === "string" && locationName.trim() ? locationName.trim() : "Main",
        timezone:
          typeof locationTimezone === "string" && locationTimezone
            ? locationTimezone
            : "America/Chicago",
      });
      if (locationErr) {
        return json({ ok: false, step: "location", error: locationErr.message }, 500);
      }

      // Same generateLink-or-lookup-existing-user pattern as
      // manage-team's "invite" action — see file header.
      const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
        type: "invite",
        email: ownerEmail,
        options: { redirectTo: `${APP_BASE_URL}/set-password` },
      });

      let ownerUserId: string;
      let inviteLink: string | null = null;
      let alreadyRegistered = false;
      if (linkErr || !linkData?.user) {
        if (!linkErr || !/already.*registered|already.*exists/i.test(linkErr.message)) {
          return json(
            { ok: false, step: "invite", error: linkErr?.message ?? "could not create invite" },
            500,
          );
        }
        const { data: existingId, error: lookupErr } = await supabase.rpc("get_user_id_by_email", {
          lookup_email: ownerEmail,
        });
        if (lookupErr || !existingId) {
          return json(
            { ok: false, step: "invite", error: lookupErr?.message ?? "could not find that user" },
            500,
          );
        }
        ownerUserId = existingId;
        alreadyRegistered = true;
      } else {
        ownerUserId = linkData.user.id;
        inviteLink = linkData.properties.action_link;
      }

      const { error: membershipErr } = await supabase
        .from("memberships")
        .upsert(
          { user_id: ownerUserId, restaurant_id: restaurantId, role: "owner" },
          { onConflict: "user_id,restaurant_id" },
        );
      if (membershipErr) {
        return json({ ok: false, step: "membership", error: membershipErr.message }, 500);
      }

      const { error: progressErr } = await supabase.from("onboarding_progress").insert([
        {
          restaurant_id: restaurantId,
          step: "restaurant",
          status: "done",
          completed_at: new Date().toISOString(),
        },
        {
          restaurant_id: restaurantId,
          step: "owner",
          status: "done",
          completed_at: new Date().toISOString(),
        },
      ]);
      if (progressErr) {
        return json({ ok: false, step: "progress", error: progressErr.message }, 500);
      }

      return json({ ok: true, restaurantId, ownerUserId, inviteLink, alreadyRegistered }, 200);
    }

    return json(
      { ok: false, step: "input", error: "action must be 'list_tenants' or 'create_tenant'" },
      400,
    );
  } catch (e) {
    return json({ ok: false, step: "unexpected", error: String(e) }, 500);
  }
});
