// Single source of truth for the waste-log reason taxonomy — mirrors
// vendor-categories.ts's shape so the DB value list and display
// labels never drift apart between the log form and the summary/table.

export const WASTE_REASONS = [
  { value: "spoilage", label: "Spoilage" },
  { value: "over_production", label: "Over-production" },
  { value: "breakage", label: "Breakage" },
  { value: "spill", label: "Spill" },
  { value: "expired", label: "Expired" },
  { value: "prep_error", label: "Prep error" },
  { value: "other", label: "Other" },
] as const;

export type WasteReason = (typeof WASTE_REASONS)[number]["value"];

export const WASTE_REASON_LABEL: Record<WasteReason, string> = Object.fromEntries(
  WASTE_REASONS.map((r) => [r.value, r.label]),
) as Record<WasteReason, string>;
