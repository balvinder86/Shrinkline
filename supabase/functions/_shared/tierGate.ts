// Phase 3 Part E — server-side half. The client-side gate
// (src/lib/billing/tierGate.ts, wired into AppSidebar/RouteGuard) stops
// a normal user from ever reaching a locked page's UI, but nothing
// stops a direct API call to an Edge Function — this is what actually
// blocks a boh-tier tenant from invoking a full-tier-only AI/API call,
// not just hiding the button. Deno-side mirror of the client version,
// kept in sync by hand (same tradeoff as recipeCost.ts/units.ts in
// this same _shared/ folder — no shared build step between the Vite
// app and Edge Functions).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type PermissionKey =
  | "sales_overview"
  | "product_mix"
  | "inventory"
  | "invoices"
  | "reviews"
  | "seo"
  | "marketing"
  | "loyalty"
  | "scheduling"
  | "pnl";

const TIER_MODULES: Record<"boh" | "full", readonly PermissionKey[]> = {
  boh: ["sales_overview", "product_mix", "invoices", "inventory", "pnl"],
  full: [
    "sales_overview",
    "product_mix",
    "invoices",
    "inventory",
    "pnl",
    "reviews",
    "seo",
    "marketing",
    "loyalty",
    "scheduling",
  ],
};

// Throws (never returns a boolean) so every call site fails closed by
// construction — a caller that forgets to check a return value can't
// accidentally let a blocked request through.
export async function assertTierAccess(
  supabase: SupabaseClient,
  restaurantId: string,
  moduleKey: PermissionKey,
): Promise<void> {
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("status, plan_tier")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();

  // No subscription row at all -> not gated. Part F's onboarding
  // wizard, which would force every tenant through a real subscribe
  // step, isn't built yet — a restaurant that's never subscribed
  // shouldn't be hard-locked out of every AI feature just because this
  // check runs unconditionally.
  if (!subscription) return;

  if (subscription.status !== "active" && subscription.status !== "trialing") {
    throw new Error(
      `Your subscription is ${subscription.status} — reactivate it in Settings → Billing & plan.`,
    );
  }

  const planTier = subscription.plan_tier as "boh" | "full";
  if (!TIER_MODULES[planTier].includes(moduleKey)) {
    throw new Error(
      "This feature needs the Full Suite plan — upgrade in Settings → Billing & plan.",
    );
  }
}
