// Bulk recipe import — parses an uploaded Word/PDF document into
// draft recipes, grounded in this restaurant's real menu items,
// ingredients, and prep recipes, using the exact same "kind"/
// "confidence" line contract generate-recipe already established (see
// supabase/functions/generate-recipe/index.ts) so the frontend needs
// zero new line-rendering code. Nothing is written to recipe_lines/
// prep_recipe_lines here — the result is a cached draft the owner
// reviews and commits line-by-line, same gate as everywhere else.
//
// PDFs are sent to Claude as a native "document" content block (same
// proven pattern classify.ts already uses for invoice classification)
// rather than text-extracted first — better fidelity for recipe cards
// with tables/columns, and it reads scanned/photographed pages too.
// DOCX has no such native support, so it's extracted to plain text via
// mammoth first.

import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import { PDFDocument } from "pdf-lib";
import {
  supabase,
  getRecipeImport,
  downloadRecipeDocFile,
  setRecipeImportReady,
  setRecipeImportFailed,
} from "./db.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_PDF_PAGES = 20;

const LINE_KINDS = ["ingredient", "prep_recipe", "new_ingredient", "new_prep_recipe"];
const CONFIDENCES = ["high", "medium", "low"];
const MATCH_CONFIDENCES = ["high", "medium", "low", "none"];
const TARGET_KINDS = ["menu_item", "prep_recipe"];

const LINE_SCHEMA = {
  type: "object" as const,
  properties: {
    kind: { type: "string" as const, enum: LINE_KINDS },
    ingredientId: { type: ["string", "null"] as const },
    prepRecipeId: { type: ["string", "null"] as const },
    quantity: { type: ["number", "null"] as const },
    unit: { type: "string" as const },
    proposedName: { type: ["string", "null"] as const },
    proposedSubIngredients: {
      type: ["array", "null"] as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
          quantity: { type: "number" as const },
          unit: { type: "string" as const },
        },
        required: ["name", "quantity", "unit"],
      },
    },
    confidence: { type: "string" as const, enum: CONFIDENCES },
    notes: { type: ["string", "null"] as const },
  },
  required: [
    "kind",
    "ingredientId",
    "prepRecipeId",
    "quantity",
    "unit",
    "proposedName",
    "proposedSubIngredients",
    "confidence",
    "notes",
  ],
};

const EXTRACT_RECIPES_TOOL = {
  name: "extract_recipes",
  description:
    "Record every distinct recipe/dish found in this document, each matched against this restaurant's real menu items, ingredients, and prep recipes.",
  input_schema: {
    type: "object" as const,
    properties: {
      recipes: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            proposedName: { type: "string" as const, description: "The dish/recipe name as written in the document." },
            targetKind: {
              type: "string" as const,
              enum: TARGET_KINDS,
              description:
                "menu_item if this is a sellable dish; prep_recipe if it's a house-made component (a sauce, dressing, marinade, batch) that's an ingredient FOR other dishes, not sold on its own.",
            },
            matchedMenuItemPosId: {
              type: ["string", "null"] as const,
              description:
                "Only set when targetKind is menu_item: the pos_id of the closest real match in REAL MENU ITEMS below, or null if nothing plausible matches. Always null when targetKind is prep_recipe.",
            },
            matchConfidence: { type: "string" as const, enum: MATCH_CONFIDENCES },
            lines: { type: "array" as const, items: LINE_SCHEMA },
          },
          required: ["proposedName", "targetKind", "matchedMenuItemPosId", "matchConfidence", "lines"],
        },
      },
    },
    required: ["recipes"],
  },
};

// Same rules generate-recipe already established for individual
// lines (the whole-container-fraction guidance in particular is the
// single most load-bearing rule there — see that file's own comments
// for the real-world reasoning), extended with the new per-recipe
// matching step this pipeline also has to do.
const SYSTEM_PROMPT = `You are extracting every distinct recipe/dish from an uploaded restaurant document — it may contain a single recipe or a whole recipe binder with many — and matching each one against this restaurant's REAL menu items, ingredients, and prep recipes, provided below. Never invent an id that isn't in the lists provided.

For each recipe you find:
- proposedName: the dish/recipe name as written in the document.
- targetKind: "menu_item" if this is a sellable dish; "prep_recipe" if it's a house-made component (a sauce, dressing, marinade, batch) that's an ingredient FOR other dishes, not sold on its own.
- matchedMenuItemPosId + matchConfidence: only meaningful when targetKind is "menu_item". Names in the document may not match the real menu exactly (e.g. "House Burger" in the doc could really be "Classic Burger" on the real menu) — look for the closest real match by name in REAL MENU ITEMS below. Use matchConfidence "none" and matchedMenuItemPosId null when nothing plausible matches (a discontinued dish, or genuinely not on this menu) — never force a wrong match. When targetKind is "prep_recipe", matchedMenuItemPosId is always null and matchConfidence is always "none".
- lines: this recipe's own ingredient list, using the exact same rules as below.

Rules for each line:
- kind="ingredient": ingredientId MUST be one of the real ids in AVAILABLE INGREDIENTS below (never invent one); unit MUST exactly match that ingredient's own unit as shown. prepRecipeId, proposedName, proposedSubIngredients null.
- CRITICAL — quantity must be expressed IN THE INGREDIENT'S OWN UNIT, not in whatever unit you'd naturally think of the portion in. If the ingredient's unit is a whole-container unit ("each", "bottle", "btl", "case", "unit" — meaning one purchased container, not a serving), and the ingredient is something poured/measured by volume per serving (a spirit, liqueur, cordial, syrup, oil, sauce — anything sold by the bottle but used a little at a time), quantity must be the FRACTION of that container used for one serving, never a raw ounce number. Assume a standard 750ml (~25 oz) bottle unless the ingredient's name says otherwise (e.g. "1L", "1.75L", "handle" imply a bigger bottle — use the real size when you can tell). Example: a 2 oz tequila pour matched to an ingredient with unit "each" → quantity ≈ 0.08 (2 ÷ 25), NEVER quantity 2. Only write a literal ounce/cup/tbsp number directly when the ingredient's own unit actually IS oz/cup/tbsp/etc. Discrete countable ingredients (a bun, an egg, a cheese slice) are NOT subject to this conversion. Because the real bottle size is a guess, cap confidence at "medium" for any line where you made this conversion, and say so in notes.
- kind="prep_recipe": same, but ingredientId null, prepRecipeId one of AVAILABLE PREP RECIPES' real ids, unit MUST exactly match that prep recipe's own yield unit — apply the same fraction-of-container logic using its real yieldQty/yieldUnit.
- kind="new_ingredient": use whenever no real ingredient on file is a genuine match for a raw, purchased component the dish needs. ingredientId and prepRecipeId null. proposedName is your best real name from the document, quantity/unit as written or your best estimate, proposedSubIngredients null.
- kind="new_prep_recipe": use for a house-made component genuinely not already in AVAILABLE PREP RECIPES. proposedName is the suggested recipe name; proposedSubIngredients lists ITS OWN ingredients+quantities as written in the document (these may themselves have no match on file — expected). The outer quantity/unit describe how much of the FINISHED prep recipe this dish uses.
- confidence: "low" whenever you're inferring purely from context with no clear signal in the document. notes: optional short caveat, else null.

This restaurant's ingredient list may only cover a narrow category (e.g. mostly alcohol) — expected; propose new_ingredient rather than force a wrong match. Extract every recipe you can find in the document, even ones with no good matches anywhere — those just come back with more new_ingredient/new_prep_recipe lines and lower confidence, which is fine.`;

type GroundingContext = {
  restaurantId: string;
  menuItems: { pos_id: string; name: string; category: string | null }[];
  ingredients: { id: string; name: string; unit: string; category: string | null }[];
  prepRecipes: { id: string; name: string; yield_qty: number; yield_unit: string }[];
};

async function fetchGroundingContext(restaurantId: string, locationId: string): Promise<GroundingContext> {
  const [menuItemsRes, ingredientsRes, prepRecipesRes] = await Promise.all([
    supabase.from("menu_items").select("pos_id, name, category").eq("location_id", locationId),
    supabase.from("ingredients").select("id, name, unit, category").eq("restaurant_id", restaurantId),
    supabase.from("prep_recipes").select("id, name, yield_qty, yield_unit").eq("location_id", locationId),
  ]);
  if (menuItemsRes.error) throw new Error(`fetch menu_items failed: ${menuItemsRes.error.message}`);
  if (ingredientsRes.error) throw new Error(`fetch ingredients failed: ${ingredientsRes.error.message}`);
  if (prepRecipesRes.error) throw new Error(`fetch prep_recipes failed: ${prepRecipesRes.error.message}`);
  return {
    restaurantId,
    menuItems: menuItemsRes.data ?? [],
    ingredients: ingredientsRes.data ?? [],
    prepRecipes: prepRecipesRes.data ?? [],
  };
}

function buildUserText(ctx: GroundingContext): string {
  return `REAL MENU ITEMS:
${JSON.stringify(ctx.menuItems.map((m) => ({ posId: m.pos_id, name: m.name, category: m.category })))}

AVAILABLE INGREDIENTS:
${JSON.stringify(ctx.ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category })))}

AVAILABLE PREP RECIPES:
${JSON.stringify(ctx.prepRecipes.map((p) => ({ id: p.id, name: p.name, yieldQty: p.yield_qty, yieldUnit: p.yield_unit })))}`;
}

async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return doc.getPageCount();
}

async function callClaude(ctx: GroundingContext, contentBlocks: Anthropic.ContentBlockParam[]): Promise<unknown> {
  const response = await client.messages.create(
    {
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_RECIPES_TOOL],
      tool_choice: { type: "tool", name: "extract_recipes" },
      messages: [
        {
          role: "user",
          content: [...contentBlocks, { type: "text", text: buildUserText(ctx) }],
        },
      ],
    },
    { timeout: 120000 },
  );

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) throw new Error("Claude did not call extract_recipes");
  return toolUse.input;
}

type RawLine = {
  kind?: string;
  ingredientId?: string | null;
  prepRecipeId?: string | null;
  quantity?: number | null;
  unit?: string | null;
  proposedName?: string | null;
  proposedSubIngredients?: { name: string; quantity: number; unit: string }[] | null;
  confidence?: string | null;
  notes?: string | null;
};
type RawRecipe = {
  proposedName?: string | null;
  targetKind?: string | null;
  matchedMenuItemPosId?: string | null;
  matchConfidence?: string | null;
  lines?: RawLine[];
};

// Same defensive-repair discipline generate-recipe already applies —
// Claude was given exact candidate ids but could still hallucinate
// one; never trust an id we didn't actually provide. A repaired line
// reads to the frontend exactly like a new_ingredient/new_prep_recipe
// line (empty pre-fill); a repaired match reads like "no match".
function repairResult(raw: unknown, ctx: GroundingContext) {
  const parsed = raw as { recipes?: RawRecipe[] };
  const menuItemIds = new Set(ctx.menuItems.map((m) => m.pos_id));
  const ingredientIds = new Set(ctx.ingredients.map((i) => i.id));
  const prepRecipeIds = new Set(ctx.prepRecipes.map((p) => p.id));

  const recipes = (parsed.recipes ?? []).map((r) => {
    const targetKind = TARGET_KINDS.includes(r.targetKind ?? "") ? r.targetKind : "menu_item";
    const matchedMenuItemPosId =
      targetKind === "menu_item" && r.matchedMenuItemPosId && menuItemIds.has(r.matchedMenuItemPosId)
        ? r.matchedMenuItemPosId
        : null;
    const matchConfidence =
      targetKind === "menu_item" && MATCH_CONFIDENCES.includes(r.matchConfidence ?? "")
        ? r.matchConfidence!
        : "none";

    return {
      proposedName: r.proposedName ?? "Untitled recipe",
      targetKind,
      matchedMenuItemPosId,
      matchConfidence,
      lines: (r.lines ?? []).map((l) => {
        const kind = LINE_KINDS.includes(l.kind ?? "") ? l.kind : "new_ingredient";
        const ingredientId =
          kind === "ingredient" && l.ingredientId && ingredientIds.has(l.ingredientId) ? l.ingredientId : null;
        const prepRecipeId =
          kind === "prep_recipe" && l.prepRecipeId && prepRecipeIds.has(l.prepRecipeId) ? l.prepRecipeId : null;
        return {
          kind,
          ingredientId,
          prepRecipeId,
          quantity: typeof l.quantity === "number" ? l.quantity : null,
          unit: l.unit ?? "",
          proposedName: l.proposedName ?? null,
          proposedSubIngredients: Array.isArray(l.proposedSubIngredients) ? l.proposedSubIngredients : null,
          confidence: CONFIDENCES.includes(l.confidence ?? "") ? l.confidence! : "low",
          notes: l.notes ?? null,
        };
      }),
    };
  });

  return { recipes };
}

export async function processRecipeImport(recipeImportId: string): Promise<void> {
  const row = await getRecipeImport(recipeImportId);
  const lowerName = row.file_name.toLowerCase();
  const isPdf = lowerName.endsWith(".pdf");
  const isDocx = lowerName.endsWith(".docx");
  if (!isPdf && !isDocx) {
    await setRecipeImportFailed(recipeImportId, "unsupported file type — only .pdf and .docx are supported");
    return;
  }

  const fileBuffer = await downloadRecipeDocFile(row.source_file_url);

  if (isPdf) {
    let pageCount: number;
    try {
      pageCount = await getPdfPageCount(fileBuffer);
    } catch (e) {
      // Permanently corrupt PDF, not transient — same class of bug as
      // server.ts's invoice enqueue path (see its comment). Mark failed
      // now so the 5-minute background-recheck sweep stops re-running
      // this forever.
      console.error(`[recipe-import] ${recipeImportId}: PDF unparseable, marking failed:`, e);
      await setRecipeImportFailed(recipeImportId, "PDF could not be read — the file may be corrupted");
      return;
    }
    if (pageCount > MAX_PDF_PAGES) {
      await setRecipeImportFailed(
        recipeImportId,
        `PDF has ${pageCount} pages — at most ${MAX_PDF_PAGES} are supported per import`,
      );
      return;
    }
  }

  const ctx = await fetchGroundingContext(row.restaurant_id, row.location_id);

  const contentBlocks: Anthropic.ContentBlockParam[] = isPdf
    ? [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: fileBuffer.toString("base64") },
        },
      ]
    : [{ type: "text", text: (await mammoth.extractRawText({ buffer: fileBuffer })).value }];

  const raw = await callClaude(ctx, contentBlocks);
  const result = repairResult(raw, ctx);
  await setRecipeImportReady(recipeImportId, result);
}
