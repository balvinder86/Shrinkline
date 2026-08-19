// Phase 3 Part E — tier gating. A single place, not scattered per
// module, per the spec: "canAccess(restaurant_id, module) => read
// subscriptions.status + plan_tier; if status not in
// ('trialing','active') -> locked; else module allowed if module in
// TIER_MODULES[plan_tier]."
//
// This is a SEPARATE dimension from permissions.ts's hasAccess(), not
// a replacement for it. hasAccess asks "has the owner granted YOU
// access" (owners always yes, by that function's own explicit design
// — an owner can never be locked out of their own dashboard by a
// stale permissions object). This asks "has the owner PAID for this
// module" — deliberately NO owner bypass here, since restricting the
// owner's own access based on what they're subscribed to is the
// entire point of a paywall. A page is visible only when both pass.
import { hasAccess, useCurrentMembership, type PermissionKey } from "@/lib/permissions";
import { useSubscription, type Subscription } from "@/lib/billing/queries";

export const TIER_MODULES: Record<"boh" | "full", readonly PermissionKey[]> = {
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

// No subscription row at all -> NOT gated (full access). Part F's
// onboarding wizard, which would force every tenant through a real
// subscribe-or-don't step, isn't built yet — treating "never
// subscribed" as "fully locked" would immediately break every other
// brand the self-serve Add Brand feature can create, none of which
// have a subscription of their own. This gate only actually restricts
// once a restaurant has an explicit subscription row (any status).
export function tierAllows(subscription: Subscription | null, key: PermissionKey): boolean {
  if (!subscription) return true;
  if (subscription.status !== "active" && subscription.status !== "trialing") return false;
  return TIER_MODULES[subscription.planTier].includes(key);
}

// Plain-function variant for call sites that already have both values
// resolved once (AppSidebar's nav filter, RouteGuard) — mirrors
// hasAccess's own shape for the same reason: several keys get checked
// per render, so this shouldn't cost a hook call each.
export function canAccess(
  membership: Parameters<typeof hasAccess>[0],
  subscription: Subscription | null,
  key: PermissionKey,
): boolean {
  return hasAccess(membership, key) && tierAllows(subscription, key);
}

export function useCanAccess(key: PermissionKey): boolean {
  const membership = useCurrentMembership();
  const { data: subscription } = useSubscription();
  return canAccess(membership, subscription ?? null, key);
}

// Distinguishes "your plan doesn't include this" from "you weren't
// granted access" — RouteGuard needs this to show the right message
// (an upgrade prompt vs. "ask an owner"), since hasAccess() alone
// can't tell the two apart once both dimensions are combined.
export function tierIsTheBlocker(
  membership: Parameters<typeof hasAccess>[0],
  subscription: Subscription | null,
  key: PermissionKey,
): boolean {
  return hasAccess(membership, key) && !tierAllows(subscription, key);
}
