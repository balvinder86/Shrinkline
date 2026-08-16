import { useAuth } from "@/lib/supabase/auth-context";
import { useRestaurantIds } from "@/lib/supabase/scope";

type CurrentMembership = {
  role: "owner" | "manager" | "staff";
  permissions: Record<string, boolean>;
} | null;

// Every real feature an owner can grant or withhold per person, one
// key per gated nav item/route. Admin (team management) isn't here —
// it stays owner-only regardless of what's granted, enforced by
// manage-team itself, not something an owner can hand out. Settings
// isn't here either — everyone manages their own account.
export const PERMISSION_KEYS = [
  "sales_overview",
  "product_mix",
  "inventory",
  "invoices",
  "reviews",
  "seo",
  "marketing",
  "loyalty",
  "scheduling",
  "pnl",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const PERMISSION_LABEL: Record<PermissionKey, string> = {
  sales_overview: "Home",
  product_mix: "Product Mix",
  inventory: "Inventory & Ordering",
  invoices: "Invoices",
  reviews: "Reviews",
  seo: "SEO",
  marketing: "Marketing",
  loyalty: "Loyalty",
  scheduling: "Scheduling",
  pnl: "P&L",
};

// Maps a route pathname to the permission that gates it — used by
// both the sidebar (to hide links) and the root layout (to actually
// block direct navigation, since hiding a link alone doesn't stop
// someone typing the URL).
export const ROUTE_PERMISSION: Record<string, PermissionKey> = {
  "/": "sales_overview",
  "/product-mix": "product_mix",
  "/inventory": "inventory",
  "/inventory-count": "inventory",
  "/vendors": "inventory",
  "/purchase-orders": "inventory",
  "/waste-log": "inventory",
  "/invoices": "invoices",
  "/reviews": "reviews",
  "/seo": "seo",
  "/marketing": "marketing",
  "/loyalty": "loyalty",
  "/scheduling": "scheduling",
  "/labor": "scheduling",
  "/pnl": "pnl",
};

// Owners always have full access, independent of what's stored — a
// restaurant's owner can never be locked out of their own dashboard
// by a stale or empty permissions object. Manager/staff need an
// explicit true for the key; a missing key means no access, not "ask
// the role for a default." Plain function (not a hook) so callers
// checking several keys at once — the sidebar's nav filter, the root
// layout's route guard — only need to resolve the current membership
// once, instead of one hook call per key.
export function hasAccess(membership: CurrentMembership, key: PermissionKey): boolean {
  if (!membership) return false;
  if (membership.role === "owner") return true;
  return membership.permissions[key] === true;
}

export function useCurrentMembership(): CurrentMembership {
  const { memberships } = useAuth();
  const restaurantId = useRestaurantIds()[0];
  return memberships.find((m) => m.restaurant_id === restaurantId) ?? null;
}

export function useHasAccess(key: PermissionKey): boolean {
  return hasAccess(useCurrentMembership(), key);
}
