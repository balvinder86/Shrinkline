// Deterministic "obvious 1:1 match" recipe drafting for simple pass-
// through items — a menu item that's just one purchased unit sold as
// is (a bottled beer, a canned seltzer) or a plain brand-name pour —
// as opposed to a prepared dish or cocktail that genuinely needs a
// multi-line recipe. No AI call: pure name matching against this
// tenant's own real ingredients.
//
// Reuses the exact GeneratedRecipeLine draft shape the AI recipe
// generator (generate-recipe Edge Function) produces, so the review
// UI already built for that — GeneratedRecipeReview / GeneratedLineRow,
// nothing written until the owner clicks "Add" on a specific line —
// works unchanged here.
//
// Runs entirely client-side against whatever `ingredients` the
// current tenant/location already has (RLS-scoped by the caller, same
// as everywhere else) — no tenant-specific logic, so the same rules
// apply identically to any restaurant using this app.

import type { GeneratedRecipeLine } from "./queries";

export type MatchableIngredient = {
  id: string;
  name: string;
  unit: string;
  category: string | null;
};

export type MatchableItem = {
  name: string;
  category: string;
};

// Items whose name/category signals they're poured or mixed to a
// measured serving from a larger container (a shot, a keg, a 750ml
// bottle by the glass) rather than sold as the whole purchased unit.
// Matching these to "1 unit of the ingredient" would cost a whole
// bottle/keg against a single drink — worse than no recipe at all —
// so they're never auto-proposed regardless of name-match confidence.
const POURED_SIGNAL_KEYWORDS = [
  "draft",
  "draught",
  "tap",
  "keg",
  "flight",
  "bucket",
  "shot",
  "shooter",
  "well",
  "wells",
  "house",
  "call",
  "premium",
  "top shelf",
  "rail",
  "glass",
  "btg",
  "cocktail",
  "martini",
  "margarita",
  "mule",
  "spritz",
  "old fashion",
  "mojito",
  "daiquiri",
  "sangria",
  "mimosa",
  "bomb",
  "long island",
  "sunrise",
  "hawaiian",
];

// Packaging/size words that don't count as "another real ingredient"
// when left over after matching — an item can carry these alongside
// a clean brand match without becoming a different product.
const NOISE_TOKENS = new Set([
  "btl",
  "bottle",
  "bottled",
  "can",
  "canned",
  "domestic",
  "import",
  "imported",
  "single",
  "double",
  "tall",
  "the",
  "a",
  "an",
  "of",
]);

// Explicit signal that this item is sold as the whole purchased unit
// (not poured) — the only case it's safe to default quantity to 1.
const WHOLE_CONTAINER_KEYWORDS = ["bottle", "btl", "can", "canned", "bottled"];

// Ingredient units that mean "one discrete sellable thing" — a case
// or keg is bulk, never "one serving," so it's never auto-defaulted.
const DISCRETE_UNITS = new Set(["each", "unit", "bottle", "can", "btl"]);

const SIZE_TOKEN_RE = /\b\d+(\.\d+)?\s*(oz|ml|l|pt|qt|gal|cl|ltr)\b/gi;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(SIZE_TOKEN_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

function containsSignal(text: string, keywords: string[]): boolean {
  const padded = ` ${text.toLowerCase()} `;
  return keywords.some((k) => padded.includes(` ${k} `));
}

// True when every token in the ingredient's name also appears in the
// item's name, and whatever's left over is just packaging/size noise
// rather than another real word — the signal that this item really
// is that one ingredient, not a cocktail or dish that happens to
// share a word with it (e.g. "Irish Coffee" sharing "coffee" with a
// plain "Coffee" ingredient would NOT qualify: residual = ["irish"]).
function isCleanMatch(itemName: string, ingredientName: string): boolean {
  const ingredientTokens = tokens(ingredientName);
  if (ingredientTokens.length === 0) return false;
  const itemTokenList = tokens(itemName);
  const itemSet = new Set(itemTokenList);
  if (!ingredientTokens.every((t) => itemSet.has(t))) return false;
  const ingredientSet = new Set(ingredientTokens);
  const residual = itemTokenList.filter((t) => !ingredientSet.has(t));
  return residual.every((t) => NOISE_TOKENS.has(t));
}

function findIngredientMatch(
  itemName: string,
  candidates: MatchableIngredient[],
): MatchableIngredient | null {
  const clean = candidates.filter((ing) => isCleanMatch(itemName, ing.name));
  if (clean.length === 0) return null;
  // Prefer the longest (most specific) ingredient name among clean
  // matches — e.g. "Bud Light Lime" over a shorter accidental "Bud".
  clean.sort((a, b) => tokens(b.name).length - tokens(a.name).length);
  return clean[0];
}

// Proposes at most one draft recipe line per item. Returns an empty
// array when the item looks poured/mixed, no ingredient matches
// cleanly, the matched ingredient is tracked in a bulk unit (case,
// keg) that can't stand in for "one serving," or a prep recipe with
// the same name exists — a same-named house-made batch ("Lemonade"
// the prep recipe vs. "Lemonade" a purchased ingredient) is exactly
// the ambiguous case a name-only matcher can't safely resolve on its
// own, so it's left for manual review rather than guessing the
// purchased ingredient.
export function matchBeverageLine(
  item: MatchableItem,
  ingredients: MatchableIngredient[],
  prepRecipeNames: string[] = [],
): GeneratedRecipeLine[] {
  if (containsSignal(`${item.name} ${item.category}`, POURED_SIGNAL_KEYWORDS)) return [];
  if (prepRecipeNames.some((name) => isCleanMatch(item.name, name))) return [];

  const drinkIngredients = ingredients.filter(
    (ing) => ing.category === "Alcohol" || ing.category === "Beverages",
  );
  const match = findIngredientMatch(item.name, drinkIngredients);
  if (!match) return [];
  if (!DISCRETE_UNITS.has(match.unit.toLowerCase().trim())) return [];

  const wholeContainer = containsSignal(`${item.name} ${item.category}`, WHOLE_CONTAINER_KEYWORDS);

  return [
    {
      kind: "ingredient",
      ingredientId: match.id,
      prepRecipeId: null,
      quantity: wholeContainer ? 1 : null,
      unit: match.unit,
      proposedName: match.name,
      proposedSubIngredients: null,
      confidence: wholeContainer ? "high" : "medium",
      notes: wholeContainer
        ? null
        : `Matched "${match.name}" by name — enter the actual pour size before adding (this ingredient is tracked per whole ${match.unit}, not per serving).`,
    },
  ];
}
