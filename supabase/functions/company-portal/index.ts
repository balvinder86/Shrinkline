// Phase 3 Part F (phase 1) — the company portal. Every other page in
// this app is restaurant-scoped (the caller is already a member of
// whatever restaurant_id they're touching); this is the one place
// that isn't — creating a brand-new tenant and inviting its owner is
// a platform-operator action, checked against platform_admins
// (db/phase3/40_platform_admins.sql), a concept independent of
// memberships entirely.
//
//   { action: "list_tenants" }
//   { action: "get_tenant", restaurant_id }
//   { action: "get_platform_summary" }
//   { action: "create_tenant", name, location_name?, location_timezone?, owner_email }
//
// list_tenants includes taxSettingsComplete/taxDocumentCount and
// setupStepsComplete/setupStepsTotal — status only (has the tenant
// filled this in, how many steps done), never the actual EIN/tax ID
// values or document contents, which stay owner-only RLS'd to the
// tenant's own dashboard. Confirmed with the user: this is
// informational only for now, not a required onboarding gate.
//
// setup status is derived from real data (pos_credentials/menu_items/
// recipe_lines/par_levels/subscriptions existing), the same approach
// as get_setup_status() (db/phase3/50_setup_status.sql) — that RPC
// itself can't be reused here since it's membership-gated to the
// tenant's own members, not callable by a platform admin who isn't a
// member of every restaurant. getSetupStatus() below re-derives the
// same booleans directly via the service-role client instead.
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

type SetupStatus = {
  posConnected: boolean;
  menuImported: boolean;
  recipesDone: boolean;
  parDone: boolean;
  billingActive: boolean;
};

async function getSetupStatus(restaurantId: string): Promise<SetupStatus> {
  const [{ data: pos }, { data: menu }, { data: recipes }, { data: par }, { data: subscription }] =
    await Promise.all([
      supabase.from("pos_credentials").select("id").eq("restaurant_id", restaurantId).limit(1),
      supabase.from("menu_items").select("id").eq("restaurant_id", restaurantId).limit(1),
      supabase.from("recipe_lines").select("id").eq("restaurant_id", restaurantId).limit(1),
      supabase
        .from("par_levels")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .not("par_quantity", "is", null)
        .limit(1),
      supabase
        .from("subscriptions")
        .select("status")
        .eq("restaurant_id", restaurantId)
        .maybeSingle(),
    ]);

  return {
    posConnected: (pos ?? []).length > 0,
    menuImported: (menu ?? []).length > 0,
    recipesDone: (recipes ?? []).length > 0,
    parDone: (par ?? []).length > 0,
    billingActive: subscription?.status === "active" || subscription?.status === "trialing",
  };
}

function countStepsComplete(setup: SetupStatus): number {
  return [setup.posConnected, setup.recipesDone, setup.parDone, setup.billingActive].filter(Boolean)
    .length;
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
          const [
            { count: locationCount },
            { data: subscription },
            { data: owners },
            { data: taxSettings },
            { count: taxDocumentCount },
          ] = await Promise.all([
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
            // Status only — never the actual EIN/tax ID values or
            // document contents, which stay owner-only RLS'd to the
            // tenant's own dashboard (db/phase2/72_tax_compliance.sql).
            // The portal only needs to know whether each tenant has
            // filled this in at all, not what they entered.
            supabase
              .from("restaurant_tax_settings")
              .select("restaurant_id")
              .eq("restaurant_id", r.id)
              .maybeSingle(),
            supabase
              .from("tax_documents")
              .select("id", { count: "exact", head: true })
              .eq("restaurant_id", r.id),
          ]);

          const ownerEmails = await Promise.all(
            (owners ?? []).map(async (o) => {
              const { data: u } = await supabase.auth.admin.getUserById(o.user_id);
              return u.user?.email ?? "unknown";
            }),
          );

          const setup = await getSetupStatus(r.id);

          return {
            id: r.id,
            name: r.name,
            createdAt: r.created_at,
            locationCount: locationCount ?? 0,
            planTier: subscription?.plan_tier ?? null,
            status: subscription?.status ?? null,
            ownerEmails,
            taxSettingsComplete: !!taxSettings,
            taxDocumentCount: taxDocumentCount ?? 0,
            setupStepsComplete: countStepsComplete(setup),
            setupStepsTotal: 4,
          };
        }),
      );

      return json({ ok: true, tenants }, 200);
    }

    if (action === "get_tenant") {
      const { restaurant_id: restaurantId } = body;
      if (typeof restaurantId !== "string") {
        return json({ ok: false, step: "input", error: "restaurant_id is required" }, 400);
      }

      const { data: restaurant, error: restaurantErr } = await supabase
        .from("restaurants")
        .select("id, name, created_at")
        .eq("id", restaurantId)
        .maybeSingle();
      if (restaurantErr) return json({ ok: false, error: restaurantErr.message }, 500);
      if (!restaurant) return json({ ok: false, step: "input", error: "tenant not found" }, 404);

      const [
        { data: locations },
        { data: subscription },
        { data: members },
        { data: taxSettings },
        { count: taxDocumentCount },
        setup,
      ] = await Promise.all([
        supabase
          .from("locations")
          .select("id, name, timezone")
          .eq("restaurant_id", restaurantId)
          .order("created_at", { ascending: true }),
        supabase
          .from("subscriptions")
          .select("plan_tier, status, quantity, current_period_end, stripe_subscription_id")
          .eq("restaurant_id", restaurantId)
          .maybeSingle(),
        supabase.from("memberships").select("user_id, role").eq("restaurant_id", restaurantId),
        // Status only, same as list_tenants — never the actual EIN/tax
        // ID values or document contents.
        supabase
          .from("restaurant_tax_settings")
          .select("restaurant_id")
          .eq("restaurant_id", restaurantId)
          .maybeSingle(),
        supabase
          .from("tax_documents")
          .select("id", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId),
        getSetupStatus(restaurantId),
      ]);

      const membersWithEmail = await Promise.all(
        (members ?? []).map(async (m) => {
          const { data: u } = await supabase.auth.admin.getUserById(m.user_id);
          return { userId: m.user_id, role: m.role, email: u.user?.email ?? "unknown" };
        }),
      );

      return json(
        {
          ok: true,
          tenant: {
            id: restaurant.id,
            name: restaurant.name,
            createdAt: restaurant.created_at,
            locations: locations ?? [],
            subscription: subscription
              ? {
                  planTier: subscription.plan_tier,
                  status: subscription.status,
                  quantity: subscription.quantity,
                  currentPeriodEnd: subscription.current_period_end,
                  stripeSubscriptionId: subscription.stripe_subscription_id,
                }
              : null,
            members: membersWithEmail,
            taxSettingsComplete: !!taxSettings,
            taxDocumentCount: taxDocumentCount ?? 0,
            setup,
          },
        },
        200,
      );
    }

    if (action === "get_platform_summary") {
      const { data: restaurants, error: restaurantsErr } = await supabase
        .from("restaurants")
        .select("id, name, created_at")
        .order("created_at", { ascending: false });
      if (restaurantsErr) return json({ ok: false, error: restaurantsErr.message }, 500);

      const [{ count: totalLocations }, { data: subscriptions }] = await Promise.all([
        supabase.from("locations").select("id", { count: "exact", head: true }),
        supabase.from("subscriptions").select("plan_tier, status"),
      ]);

      // "Current effective tier" — only active/trialing subscriptions
      // count toward boh/full; everything else (no subscription row,
      // or one that's past_due/canceled) counts as "none", same
      // status set tierAllows() (src/lib/billing/tierGate.ts) treats
      // as actually granting access.
      const activeSubscriptions = (subscriptions ?? []).filter(
        (s) => s.status === "active" || s.status === "trialing",
      );
      const planTierBreakdown = {
        boh: activeSubscriptions.filter((s) => s.plan_tier === "boh").length,
        full: activeSubscriptions.filter((s) => s.plan_tier === "full").length,
        none: (restaurants ?? []).length - activeSubscriptions.length,
      };

      return json(
        {
          ok: true,
          summary: {
            totalTenants: (restaurants ?? []).length,
            activeSubscriptions: activeSubscriptions.length,
            planTierBreakdown,
            totalLocations: totalLocations ?? 0,
            recentTenants: (restaurants ?? []).slice(0, 5).map((r) => ({
              id: r.id,
              name: r.name,
              createdAt: r.created_at,
            })),
          },
        },
        200,
      );
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
