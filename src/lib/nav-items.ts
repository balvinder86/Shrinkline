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
  TrendingUp,
  Scale,
  PackageSearch,
  LineChart,
  PiggyBank,
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
  // under Stock & Purchasing). When present, AppSidebar renders the
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
    titleKey: "invoices",
    url: "/invoices",
    icon: Receipt,
    permission: "invoices",
    // Line items/Savings/Vendor spend were tabs inside /invoices —
    // promoted to real sub-pages, same nested-children treatment as
    // Inventory below. "Vendor spend" is deliberately distinct from
    // the real Vendors catalog page (under Inventory's own children)
    // — this one is an invoice-spend breakdown, not vendor management.
    children: [
      { titleKey: "invoices", url: "/invoices", icon: Receipt, permission: "invoices" },
      {
        titleKey: "invoiceLineItems",
        url: "/invoice-line-items",
        icon: Receipt,
        permission: "invoices",
      },
      {
        titleKey: "invoiceSavings",
        url: "/invoice-savings",
        icon: PiggyBank,
        permission: "invoices",
      },
      { titleKey: "vendorSpend", url: "/vendor-spend", icon: Truck, permission: "invoices" },
    ],
  },
  {
    titleKey: "inventory",
    url: "/inventory",
    icon: Package,
    permission: "inventory",
    // Inventory Count, Vendors, Purchase Orders, Waste Log, and
    // Inventory Variance all reuse "inventory" — same domain
    // (ingredients, vendors, stock, orders), no new permission
    // plumbing needed for any of them.
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
      {
        titleKey: "inventoryVariance",
        url: "/inventory-variance",
        icon: PackageSearch,
        permission: "inventory",
      },
    ],
  },
  {
    titleKey: "performance",
    url: "/pnl",
    icon: TrendingUp,
    permission: "pnl",
    // P&L rolls up Sales + COGS + Labor + Operating Expenses — spans
    // every Overview-section page rather than belonging to one, so it
    // lives under its own "Performance" group rather than in
    // Growth/Operations. Variance reuses "pnl" too — same financial
    // domain, just decomposing P&L's one aggregate food cost gap into
    // a per-ingredient breakdown. Labor Cost keeps its own
    // "scheduling" permission (it's workforce data, not financial
    // data an owner would gate the same way as P&L) even though it
    // now lives in this group.
    children: [
      { titleKey: "pnl", url: "/pnl", icon: Landmark, permission: "pnl" },
      { titleKey: "variance", url: "/variance", icon: Scale, permission: "pnl" },
      { titleKey: "laborCost", url: "/labor", icon: Wallet, permission: "scheduling" },
      {
        titleKey: "ingredientPriceTrends",
        url: "/ingredient-price-trends",
        icon: LineChart,
        permission: "pnl",
      },
    ],
  },
];

export const NAV_GROWTH: NavItem[] = [
  { titleKey: "reviews", url: "/reviews", icon: Star, permission: "reviews" },
  { titleKey: "seo", url: "/seo", icon: Search, permission: "seo" },
  { titleKey: "marketing", url: "/marketing", icon: Megaphone, permission: "marketing" },
  { titleKey: "loyalty", url: "/loyalty", icon: Gift, permission: "loyalty" },
];

export const NAV_OPERATIONS: NavItem[] = [
  { titleKey: "scheduling", url: "/scheduling", icon: CalendarClock, permission: "scheduling" },
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
