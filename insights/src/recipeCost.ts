// Ported verbatim from src/lib/boh/recipeCost.ts (the frontend's single
// source of truth for this math, used by useFoodCostSummary /
// useProductMix) — pure, dependency-free, so it can run server-side
// unchanged. Only the functions useFoodCostSummary actually needs are
// included; reachablePrepRecipeIds/wouldCreateCycle are UI-editing-only.

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
