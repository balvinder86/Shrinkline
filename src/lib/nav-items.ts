import {
  LayoutDashboard,
  PieChart,
  Package,
  Receipt,
  Star,
  Search,
  Megaphone,
  Gift,
  CalendarClock,
  Wallet,
  Shield,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { PermissionKey } from "@/lib/permissions";
import type { TranslationDict } from "@/lib/i18n/translations";

export type NavItem = {
  titleKey: keyof TranslationDict["nav"];
  url: string;
  icon: LucideIcon;
  permission: PermissionKey;
};

// Single source of truth for every gated nav destination — shared by
// AppSidebar and the global search palette so the two never drift.
// titleKey looks up the real display string from the active
// language's translation dict (src/lib/i18n/translations.ts), not a
// hardcoded English string.
export const NAV_OVERVIEW: NavItem[] = [
  { titleKey: "home", url: "/", icon: LayoutDashboard, permission: "sales_overview" },
  { titleKey: "productMix", url: "/product-mix", icon: PieChart, permission: "product_mix" },
  { titleKey: "inventory", url: "/inventory", icon: Package, permission: "inventory" },
  { titleKey: "invoices", url: "/invoices", icon: Receipt, permission: "invoices" },
];

export const NAV_GROWTH: NavItem[] = [
  { titleKey: "reviews", url: "/reviews", icon: Star, permission: "reviews" },
  { titleKey: "seo", url: "/seo", icon: Search, permission: "seo" },
  { titleKey: "marketing", url: "/marketing", icon: Megaphone, permission: "marketing" },
  { titleKey: "loyalty", url: "/loyalty", icon: Gift, permission: "loyalty" },
];

export const NAV_OPERATIONS: NavItem[] = [
  { titleKey: "scheduling", url: "/scheduling", icon: CalendarClock, permission: "scheduling" },
  // Reuses the "scheduling" permission — same workforce-operations
  // bucket, no new permission plumbing needed for this one page.
  { titleKey: "laborCost", url: "/labor", icon: Wallet, permission: "scheduling" },
];

// Not permission-gated — Admin is owner-only (enforced by manage-team
// itself) but still visible read-only to everyone, and Settings is
// every member's own account, independent of what they're granted.
export const NAV_UNGATED: {
  titleKey: keyof TranslationDict["nav"];
  url: string;
  icon: LucideIcon;
}[] = [
  { titleKey: "admin", url: "/admin", icon: Shield },
  { titleKey: "settings", url: "/settings", icon: Settings },
];
