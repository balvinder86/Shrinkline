import {
  LayoutDashboard,
  PieChart,
  Package,
  Receipt,
  ChefHat,
  Star,
  Search,
  Megaphone,
  Gift,
  CalendarClock,
  Wallet,
  Landmark,
  Shield,
  Settings,
  Trash2,
  Truck,
  ClipboardCheck,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";

import type { PermissionKey } from "@/lib/permissions";
import type { TranslationDict } from "@/lib/i18n/translations";

export type NavItem = {
  titleKey: keyof TranslationDict["nav"];
  url: string;
  icon: LucideIcon;
  permission: PermissionKey;
  // Sub-pages shown nested under this item (e.g. Vendors and Waste Log
  // under Inventory & Ordering). When present, AppSidebar renders the
  // parent as a pure expand/collapse toggle rather than a link — never
  // nesting one clickable element inside another — so the parent's own
  // `url` only matters for deciding whether the group should default
  // to expanded (i.e. a child, or the parent's own base page, is the
  // active route).
  children?: NavItem[];
};

// Single source of truth for every gated nav destination — shared by
// AppSidebar and the global search palette so the two never drift.
// titleKey looks up the real display string from the active
// language's translation dict (src/lib/i18n/translations.ts), not a
// hardcoded English string.
export const NAV_OVERVIEW: NavItem[] = [
  { titleKey: "home", url: "/", icon: LayoutDashboard, permission: "sales_overview" },
  { titleKey: "productMix", url: "/product-mix", icon: PieChart, permission: "product_mix" },
  // Reuses "product_mix" — Recipes is the cost/recipe side of Product
  // Mix's real menu items, same domain, no new permission needed.
  { titleKey: "recipes", url: "/recipes", icon: ChefHat, permission: "product_mix" },
  {
    titleKey: "inventory",
    url: "/inventory",
    icon: Package,
    permission: "inventory",
    // Inventory Count, Vendors, Purchase Orders, and Waste Log all
    // reuse "inventory" — same domain (ingredients, vendors, stock,
    // orders), no new permission plumbing needed for any of them.
    children: [
      { titleKey: "inventoryItems", url: "/inventory", icon: Package, permission: "inventory" },
      {
        titleKey: "inventoryCount",
        url: "/inventory-count",
        icon: ClipboardCheck,
        permission: "inventory",
      },
      { titleKey: "vendors", url: "/vendors", icon: Truck, permission: "inventory" },
      {
        titleKey: "purchaseOrders",
        url: "/purchase-orders",
        icon: ClipboardList,
        permission: "inventory",
      },
      { titleKey: "wasteLog", url: "/waste-log", icon: Trash2, permission: "inventory" },
    ],
  },
  { titleKey: "invoices", url: "/invoices", icon: Receipt, permission: "invoices" },
  // Rolls up Sales + COGS + Labor + Operating Expenses — spans every
  // Overview-section page rather than belonging to one, so it lives
  // here rather than in Growth/Operations.
  { titleKey: "pnl", url: "/pnl", icon: Landmark, permission: "pnl" },
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
