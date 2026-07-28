// Menu engineering — classic popularity × margin 2x2 (Star/Plowhorse/
// Puzzle/Dog), median-based. Shared by Product Mix and the Recipes
// page so both show the identical classification, not a copy-paste
// fork. "Unpriced" covers an item with no cost yet — classification
// needs both popularity and margin, so an item with unknown cost can't
// be placed until it has one (via a recipe or a manual override).
export type Quadrant = "Star" | "Plowhorse" | "Puzzle" | "Dog" | "Unpriced";

export const QUAD_COLOR: Record<Quadrant, string> = {
  Star: "#87a878",
  Plowhorse: "#d4a574",
  Puzzle: "#7da3c2",
  Dog: "#c17c74",
  Unpriced: "#9c9890",
};

export function quadrant(
  item: { cost?: number; price: number; soldWk: number },
  popMedian: number,
  marginMedian: number,
): Quadrant {
  if (item.cost == null) return "Unpriced";
  const margin = item.price - item.cost;
  const pop = item.soldWk;
  if (pop >= popMedian && margin >= marginMedian) return "Star";
  if (pop >= popMedian && margin < marginMedian) return "Plowhorse";
  if (pop < popMedian && margin >= marginMedian) return "Puzzle";
  return "Dog";
}

// Some real items (well-pour liquor: single/double, rail vs. call) have
// no fixed Toast catalog price — `price` for those is instead the
// cheapest real unit price ever observed in sales, a derived "starting
// price" rather than a fixed one. Label it as such so it doesn't read
// as a real menu price.
export function formatItemPrice(
  item: { price: number; hasRealPrice: boolean },
  options?: { lowercase?: boolean },
): string {
  if (item.hasRealPrice) return `$${item.price.toFixed(2)}`;
  if (item.price > 0) return `${options?.lowercase ? "from" : "From"} $${item.price.toFixed(2)}`;
  return "$0.00";
}
