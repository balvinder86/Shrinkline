// Single source of truth for this app's own curated ingredient
// category taxonomy — used by the Inventory page's filter bar and by
// the Recipes page, which maps real (much messier) Toast POS menu
// categories onto these same 5 buckets so both pages share one
// consistent filter vocabulary.
export const CATEGORIES = ["Beverages", "Alcohol", "Food", "Dry Goods", "Miscellaneous"] as const;
export type Category = (typeof CATEGORIES)[number];
