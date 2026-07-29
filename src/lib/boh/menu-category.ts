import { CATEGORIES, type Category } from "@/lib/boh/ingredient-categories";

// Maps a real menu item onto this app's own curated 5-category
// taxonomy (Beverages/Alcohol/Food/Dry Goods/Miscellaneous) — the
// SAME taxonomy the Inventory page already filters ingredients by.
//
// Deliberately NOT a lookup table keyed by this tenant's own raw
// Toast POS category names ("HH", "Daily Specials", "Game Day menu"
// are real examples from one real restaurant) — those names are
// unique to how each individual restaurant organizes its own menu and
// won't mean anything for a different tenant's POS data. Real,
// generic food/drink vocabulary generalizes across any tenant;
// tenant-specific section names don't.
//
// Two passes: the item's own POS category name first (cheap, usually
// decisive — "Tequila", "Burgers" are unambiguous on their own), then
// the item's own name as a fallback for opaque/branded section names
// ("HH" turned out to be 100% food once the real items were checked;
// "Daily Drinks" 100% alcohol) — see project memory for the specific
// real data this was validated against. Whatever matches neither pass
// falls back to Miscellaneous rather than a guess.
//
// Word-boundary + light inflection matching (handles real plurals —
// "popper" matching "Poppers", "pickle" matching "Pickles" — without
// the false positives naive substring matching caused, e.g. "pop"
// wrongly matching inside "Poppers"). A few known non-alcoholic
// phrases that contain alcohol-sounding words ("root beer", "ginger
// beer") are checked first so they don't get misread as Alcohol.

const NONALCOHOLIC_OVERRIDES = ["root beer", "ginger beer"];

const ALCOHOL_KEYWORDS = [
  "beer", "ipa", "lager", "stout", "pilsner", "cider", "pale ale", "amber ale", "wheat ale", "brown ale",
  "wine", "chardonnay", "pinot", "prosecco", "champagne", "merlot", "cabernet", "sauvignon", "sangria",
  "whiskey", "whisky", "bourbon", "scotch", "rye",
  "vodka", "tequila", "mezcal", "rum", "gin", "brandy", "cognac",
  "liquor", "liqueur", "liquer", "cocktail", "martini", "margarita", "mojito", "daiquiri", "spritz", "mule",
  "old fashioned", "mimosa", "shot", "shooter", "keg", "draft", "draught", "fireball", "alcohol", "spirit",
  "bar drink", "bar drinks", "well drink", "well drinks", "wells",
];
const FOOD_KEYWORDS = [
  "burger", "sandwich", "wrap", "taco", "burrito", "quesadilla", "nacho", "pizza", "flatbread", "slider",
  "wing", "fry", "fries", "salad", "soup", "app", "apps", "appetizer", "side", "breakfast", "egg", "bacon",
  "sausage", "pancake", "waffle", "dessert", "desert", "cake", "pie", "chicken", "beef", "pork", "fish",
  "shrimp", "steak", "rib", "pretzel", "dip", "chip", "popper", "brussel", "spinach", "pasta", "alfredo",
  "dog", "crab", "entree", "platter", "prime", "fettuccine", "tot", "pickle", "potato", "onion", "mozzarella",
  "cheese", "mushroom",
];
const BEVERAGE_KEYWORDS = [
  "beverage", "soda", "pop", "coffee", "tea", "juice", "water", "lemonade", "milkshake", "smoothie",
  "latte", "espresso", "mocktail", "soft drink", "float",
];
const MISC_KEYWORDS = ["retail", "rental", "fee", "hour", "minute", "merchandise", "gift", "apparel", "shirt", "hat"];

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+/g) ?? [];
}

function wordMatches(word: string, keyword: string): boolean {
  if (word === keyword) return true;
  if (["s", "es", "ed", "ing"].some((suf) => word === keyword + suf)) return true;
  if (keyword.endsWith("y") && word === `${keyword.slice(0, -1)}ies`) return true;
  return false;
}

function matchesAny(text: string, keywords: string[]): boolean {
  const words = tokenize(text);
  const padded = ` ${text.toLowerCase()} `;
  return keywords.some((k) => (k.includes(" ") ? padded.includes(` ${k} `) : words.some((w) => wordMatches(w, k))));
}

function classifyText(text: string | null | undefined): Category | null {
  if (!text) return null;
  if (matchesAny(text, NONALCOHOLIC_OVERRIDES)) return "Beverages";
  if (matchesAny(text, ALCOHOL_KEYWORDS)) return "Alcohol";
  if (matchesAny(text, BEVERAGE_KEYWORDS)) return "Beverages";
  if (matchesAny(text, FOOD_KEYWORDS)) return "Food";
  if (matchesAny(text, MISC_KEYWORDS)) return "Miscellaneous";
  return null;
}

export function classifyMenuItemCategory(posCategory: string | null | undefined, itemName: string | null | undefined): Category {
  return classifyText(posCategory) ?? classifyText(itemName) ?? "Miscellaneous";
}

export { CATEGORIES };
export type { Category };
