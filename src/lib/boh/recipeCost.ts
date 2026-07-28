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

export type PrepRecipeLineRow = {
  prep_recipe_id: string;
  ingredient_id: string | null;
  sub_prep_recipe_id: string | null;
  quantity: number;
};

export type RecipeLineRow = {
  ingredient_id: string | null;
  prep_recipe_id: string | null;
  quantity: number;
};

// null = can't be costed yet (a line's ingredient has no cost, or a
// sub-recipe couldn't be costed, or — via the memo pre-seed below — a
// cycle was detected). Never silently treated as $0.
export function resolvePrepRecipeCostPerYieldUnit(
  prepRecipeId: string,
  prepRecipeLinesByPrepId: Map<string, PrepRecipeLineRow[]>,
  prepRecipeYieldById: Map<string, number>,
  ingredientCostById: Map<string, number | null>,
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
      ? (ingredientCostById.get(line.ingredient_id) ?? null)
      : resolvePrepRecipeCostPerYieldUnit(
          line.sub_prep_recipe_id!,
          prepRecipeLinesByPrepId,
          prepRecipeYieldById,
          ingredientCostById,
          memo,
        );
    if (lineCost == null) return null;
    totalCents += Number(line.quantity) * lineCost;
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
  ingredientCostById: Map<string, number | null>,
): number | null {
  if (recipeLines.length === 0) return null;
  const memo = new Map<string, number | null>();
  let totalCents = 0;
  for (const line of recipeLines) {
    const lineCost = line.ingredient_id
      ? (ingredientCostById.get(line.ingredient_id) ?? null)
      : resolvePrepRecipeCostPerYieldUnit(
          line.prep_recipe_id!,
          prepRecipeLinesByPrepId,
          prepRecipeYieldById,
          ingredientCostById,
          memo,
        );
    if (lineCost == null) return null;
    totalCents += Number(line.quantity) * lineCost;
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
