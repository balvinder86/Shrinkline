// Recursive recipe-cost rollup — the one shared implementation, used
// by useProductMix and useFoodCostSummary (src/lib/pos/queries.ts).
// Previously this math was duplicated in three places (those two,
// plus a dead unused copy in this file); sub-recipes made a fourth
// duplicate untenable, so this is now the single source of truth.
//
// A menu item's recipe_lines can point at a raw ingredient OR a prep
// recipe (e.g. a house sauce used across several dishes). A prep
// recipe's own lines can likewise point at a raw ingredient or
// *another* prep recipe, recursively — but never back at a menu item,
// so the only cycle risk is within the prep-recipe graph itself.

import { convertQuantityToIngredientUnit } from "@/lib/units";

export type PrepRecipeLineRow = {
  prep_recipe_id: string;
  ingredient_id: string | null;
  sub_prep_recipe_id: string | null;
  quantity: number;
  unit: string;
};

export type RecipeLineRow = {
  ingredient_id: string | null;
  prep_recipe_id: string | null;
  quantity: number;
  unit: string;
};

export type IngredientCostInfo = {
  unitCostCents: number | null;
  unit: string;
  containerSizeMl: number | null;
};

// A raw-ingredient line's quantity is in `line.unit`, which may differ
// from the ingredient's own priced unit (`ingredients.unit`) — e.g. a
// recipe written as "5 oz" of a wine bought "each" (a bottle). Convert
// before multiplying so line cost is always quantity-in-native-unit ×
// price-per-native-unit. null = can't be costed (no price, or units
// that genuinely can't convert — no container size set) — never
// silently treated as $0 or silently wrong.
function resolveIngredientLineCostCents(
  quantity: number,
  unit: string,
  info: IngredientCostInfo | undefined,
): number | null {
  if (!info || info.unitCostCents == null) return null;
  const converted = convertQuantityToIngredientUnit(
    quantity,
    unit,
    info.unit,
    info.containerSizeMl,
  );
  if (converted == null) return null;
  return converted * info.unitCostCents;
}

export function resolvePrepRecipeCostPerYieldUnit(
  prepRecipeId: string,
  prepRecipeLinesByPrepId: Map<string, PrepRecipeLineRow[]>,
  prepRecipeYieldById: Map<string, number>,
  ingredientById: Map<string, IngredientCostInfo | undefined>,
  memo: Map<string, number | null> = new Map(),
): number | null {
  if (memo.has(prepRecipeId)) return memo.get(prepRecipeId)!;
  const ownLines = prepRecipeLinesByPrepId.get(prepRecipeId) ?? [];
  // A prep recipe with no lines yet isn't a $0 recipe — it's uncosted.
  // Without this, an empty prep recipe would silently resolve to 0 and
  // let any recipe that references it look cheaper than it really is.
  if (ownLines.length === 0) {
    memo.set(prepRecipeId, null);
    return null;
  }
  // Pre-seed with null before recursing — if a cycle brings us back to
  // this same prep recipe id, the recursive call reads this null
  // instead of looping forever.
  memo.set(prepRecipeId, null);

  let totalCents = 0;
  for (const line of ownLines) {
    const lineCost = line.ingredient_id
      ? resolveIngredientLineCostCents(
          line.quantity,
          line.unit,
          ingredientById.get(line.ingredient_id),
        )
      : resolvePrepRecipeCostPerYieldUnit(
          line.sub_prep_recipe_id!,
          prepRecipeLinesByPrepId,
          prepRecipeYieldById,
          ingredientById,
          memo,
        );
    if (lineCost == null) return null;
    // A prep-recipe sub-line's cost is already per its own yield unit
    // (no conversion — the AddLineForm locks a prep sub-line's unit to
    // the sub-recipe's own yieldUnit, so line.quantity is already "how
    // many yield units").
    totalCents += line.ingredient_id ? lineCost : Number(line.quantity) * lineCost;
  }

  const yieldQty = prepRecipeYieldById.get(prepRecipeId) ?? 1;
  const result = yieldQty > 0 ? totalCents / yieldQty : null;
  memo.set(prepRecipeId, result);
  return result;
}

export function resolveMenuItemRecipeCostCents(
  recipeLines: RecipeLineRow[],
  prepRecipeLinesByPrepId: Map<string, PrepRecipeLineRow[]>,
  prepRecipeYieldById: Map<string, number>,
  ingredientById: Map<string, IngredientCostInfo | undefined>,
): number | null {
  if (recipeLines.length === 0) return null;
  const memo = new Map<string, number | null>();
  let totalCents = 0;
  for (const line of recipeLines) {
    const lineCost = line.ingredient_id
      ? resolveIngredientLineCostCents(
          line.quantity,
          line.unit,
          ingredientById.get(line.ingredient_id),
        )
      : resolvePrepRecipeCostPerYieldUnit(
          line.prep_recipe_id!,
          prepRecipeLinesByPrepId,
          prepRecipeYieldById,
          ingredientById,
          memo,
        );
    if (lineCost == null) return null;
    totalCents += line.ingredient_id ? lineCost : Number(line.quantity) * lineCost;
  }
  return Math.round(totalCents);
}

// Walks a prep recipe's own dependency graph and reports every prep
// recipe id reachable from it (itself included) — used to reject a
// cycle *before* writing a new prep_recipe_lines row: if the recipe
// you're about to attach as a sub-recipe already (transitively)
// depends on the recipe you're editing, adding it would create a
// cycle the cost resolver could only detect by silently returning
// null, which is a much worse user experience than an upfront reject.
export function reachablePrepRecipeIds(
  startId: string,
  prepRecipeLinesByPrepId: Map<string, PrepRecipeLineRow[]>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const line of prepRecipeLinesByPrepId.get(id) ?? []) {
      if (line.sub_prep_recipe_id) stack.push(line.sub_prep_recipe_id);
    }
  }
  return seen;
}

// True if attaching `candidateSubRecipeId` as a line inside
// `targetPrepRecipeId` would create a cycle (including attaching a
// recipe to itself).
export function wouldCreateCycle(
  targetPrepRecipeId: string,
  candidateSubRecipeId: string,
  prepRecipeLinesByPrepId: Map<string, PrepRecipeLineRow[]>,
): boolean {
  if (targetPrepRecipeId === candidateSubRecipeId) return true;
  return reachablePrepRecipeIds(candidateSubRecipeId, prepRecipeLinesByPrepId).has(targetPrepRecipeId);
}
