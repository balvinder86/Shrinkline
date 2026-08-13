// Shared unit-conversion for recipe lines. A raw ingredient is priced
// per whatever unit it's purchased in (ingredients.unit — often a
// count like "each"/"case"/"bottle"), but a recipe line naturally
// wants to be expressed in however it's actually used (a pour in oz,
// a dash in ml). Converting at every point a line's cost/usage gets
// computed keeps recipe_lines.quantity/unit exactly what was typed,
// while still costing correctly against the ingredient's real
// per-purchase-unit price.

// mL is the base unit for the volume family.
const ML_PER_UNIT: Record<string, number> = {
  oz: 29.5735,
  cup: 236.588,
  pt: 473.176,
  qt: 946.353,
  gal: 3785.41,
  ml: 1,
  L: 1000,
};

// Grams is the base unit for the weight family.
const G_PER_UNIT: Record<string, number> = {
  lb: 453.592,
  g: 1,
};

export const VOLUME_UNITS = Object.keys(ML_PER_UNIT);
export const WEIGHT_UNITS = Object.keys(G_PER_UNIT);

export type UnitFamily = "volume" | "weight" | "count";

export function unitFamily(unit: string): UnitFamily {
  if (unit in ML_PER_UNIT) return "volume";
  if (unit in G_PER_UNIT) return "weight";
  return "count";
}

// Converts `quantity` (in `fromUnit`) into the equivalent quantity
// expressed in `ingredientUnit` — the unit the ingredient's
// unit_cost_cents is actually priced per — so `converted * unitCostCents`
// is always the right line cost regardless of which unit a recipe was
// written in. `containerSizeMl` bridges a count unit (a bottle, a
// case) to a volume pour (e.g. a 750ml wine bottle) — null when that
// bridge hasn't been set for this ingredient. Returns null when
// there's no way to convert (incompatible families with no bridge);
// callers should treat that the same as "this line can't be costed."
export function convertQuantityToIngredientUnit(
  quantity: number,
  fromUnit: string,
  ingredientUnit: string,
  containerSizeMl: number | null,
): number | null {
  if (fromUnit === ingredientUnit) return quantity;
  const fromFamily = unitFamily(fromUnit);
  const toFamily = unitFamily(ingredientUnit);
  if (fromFamily === "volume" && toFamily === "volume") {
    return (quantity * ML_PER_UNIT[fromUnit]) / ML_PER_UNIT[ingredientUnit];
  }
  if (fromFamily === "weight" && toFamily === "weight") {
    return (quantity * G_PER_UNIT[fromUnit]) / G_PER_UNIT[ingredientUnit];
  }
  if (fromFamily === "volume" && toFamily === "count" && containerSizeMl) {
    return (quantity * ML_PER_UNIT[fromUnit]) / containerSizeMl;
  }
  return null;
}

// Which units a recipe line can be entered in for a given ingredient —
// its own native unit always works; same-family units always convert
// via fixed ratios; volume units additionally work once a container
// size is set (bridging "5 oz poured" back to "0.2 bottles bought").
export function compatibleLineUnits(
  ingredientUnit: string,
  containerSizeMl: number | null,
): string[] {
  const family = unitFamily(ingredientUnit);
  const units = new Set<string>([ingredientUnit]);
  if (family === "volume") for (const u of VOLUME_UNITS) units.add(u);
  if (family === "weight") for (const u of WEIGHT_UNITS) units.add(u);
  if (family === "count" && containerSizeMl) for (const u of VOLUME_UNITS) units.add(u);
  return Array.from(units);
}

// Full measure-unit list with display labels — used for both a prep
// recipe's own yield unit and (via compatibleLineUnits) a recipe
// line's unit picker.
export const MEASURE_UNITS = [
  { value: "oz", label: "oz (fl oz)" },
  { value: "cup", label: "cup" },
  { value: "pt", label: "pint" },
  { value: "qt", label: "quart" },
  { value: "gal", label: "gallon" },
  { value: "ml", label: "ml" },
  { value: "L", label: "liter" },
  { value: "lb", label: "lb" },
  { value: "g", label: "gram" },
  { value: "each", label: "each" },
  { value: "portion", label: "portion" },
  { value: "serving", label: "serving" },
] as const;

export function unitLabel(unit: string): string {
  return MEASURE_UNITS.find((u) => u.value === unit)?.label ?? unit;
}
