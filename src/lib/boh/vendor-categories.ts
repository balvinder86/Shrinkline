// Single source of truth for the vendor expense-category taxonomy —
// reused by the vendor CRUD dialog, the Invoices page's category
// filter/chart, and both OCR-review vendor pickers, so the DB value
// list and display labels never drift apart across files.

export const VENDOR_CATEGORIES = [
  { value: "food_beverage", label: "Food & Beverage" },
  { value: "utilities", label: "Utilities" },
  { value: "maintenance", label: "Maintenance & Repairs" },
  { value: "rent", label: "Rent" },
  { value: "insurance", label: "Insurance" },
  { value: "events", label: "Events" },
  { value: "other", label: "Other" },
] as const;

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number]["value"];

export const VENDOR_CATEGORY_LABEL: Record<VendorCategory, string> = Object.fromEntries(
  VENDOR_CATEGORIES.map((c) => [c.value, c.label]),
) as Record<VendorCategory, string>;

// Bare var(--x) or literal hsl()/hex — never hsl(var(--x)), which
// silently fails since this app's CSS vars are OKLCH already (see
// feedback_thrasherspub_oklch_charts memory).
export const VENDOR_CATEGORY_COLOR: Record<VendorCategory, string> = {
  food_beverage: "var(--primary)",
  utilities: "hsl(205 60% 48%)",
  maintenance: "hsl(38 60% 55%)",
  rent: "hsl(280 40% 55%)",
  insurance: "hsl(120 25% 45%)",
  events: "hsl(340 55% 55%)",
  other: "hsl(220 15% 55%)",
};
