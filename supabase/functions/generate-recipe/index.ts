// Drafts real, grounded recipes for one or more menu items — Claude is
// given the restaurant's actual ingredients and prep recipes and told
// to build from THOSE, classifying each proposed component as a real
// purchased match, a real prep-recipe match, or (when nothing on file
// is a genuine match) a new-ingredient/new-prep-recipe proposal.
// Nothing is written to the database here. The frontend shows every
// proposed line for review before the owner explicitly commits it via
// the same recipe_lines/prep_recipe_lines mutations manual recipe
// editing already uses — an unreviewed AI portion never touches cost
// math.
//
//   { restaurant_id, menu_item_pos_ids }

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

const MAX_ITEMS_PER_CALL = 25;

const LINE_KINDS = ["ingredient", "prep_recipe", "new_ingredient", "new_prep_recipe"];
const CONFIDENCES = ["high", "medium", "low"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      return json({ ok: false, error: "missing Authorization header" }, 401);
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "invalid session" }, 401);
    }

    const { restaurant_id, menu_item_pos_ids } = await req.json();
    if (!restaurant_id || !Array.isArray(menu_item_pos_ids) || menu_item_pos_ids.length === 0) {
      return json(
        { ok: false, error: "restaurant_id and a non-empty menu_item_pos_ids array are required" },
        400,
      );
    }
    if (menu_item_pos_ids.length > MAX_ITEMS_PER_CALL) {
      return json(
        { ok: false, error: `at most ${MAX_ITEMS_PER_CALL} menu items per call` },
        400,
      );
    }

    const { data: membership } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .eq("restaurant_id", restaurant_id)
      .maybeSingle();
    if (!membership) {
      return json({ ok: false, error: "not a member of this restaurant" }, 403);
    }

    // Tenant scoping is derived server-side from restaurant_id, never
    // trusted from the client — mirrors useLocationIds' own query.
    const { data: locations } = await supabase
      .from("locations")
      .select("id")
      .eq("restaurant_id", restaurant_id);
    const locationIds = (locations ?? []).map((l: { id: string }) => l.id);
    if (locationIds.length === 0) {
      return json({ ok: false, error: "no locations found for this restaurant" }, 400);
    }

    const [menuItemsRes, ingredientsRes, prepRecipesRes] = await Promise.all([
      supabase
        .from("menu_items")
        .select("pos_id, name, category")
        .in("location_id", locationIds)
        .in("pos_id", menu_item_pos_ids),
      supabase
        .from("ingredients")
        .select("id, name, unit, unit_cost_cents, category")
        .eq("restaurant_id", restaurant_id),
      supabase
        .from("prep_recipes")
        .select("id, name, yield_qty, yield_unit")
        .in("location_id", locationIds),
    ]);
    if (menuItemsRes.error) return json({ ok: false, error: menuItemsRes.error.message }, 500);
    if (ingredientsRes.error) return json({ ok: false, error: ingredientsRes.error.message }, 500);
    if (prepRecipesRes.error) return json({ ok: false, error: prepRecipesRes.error.message }, 500);

    const menuItems = menuItemsRes.data ?? [];
    const ingredients = ingredientsRes.data ?? [];
    const prepRecipes = prepRecipesRes.data ?? [];
    if (menuItems.length === 0) {
      return json({ ok: false, error: "none of the given menu_item_pos_ids were found" }, 404);
    }

    const ingredientById = new Map(
      ingredients.map((i: { id: string; unit: string; category: string | null }) => [i.id, i]),
    );
    const ingredientIds = new Set(ingredients.map((i: { id: string }) => i.id));
    const prepRecipeIds = new Set(prepRecipes.map((p: { id: string }) => p.id));

    // Whole-container units — one purchased bottle/case, not a serving.
    // Only meaningful to sanity-check against for Alcohol/Beverages
    // ingredients (poured a little at a time per drink) — a discrete
    // food item ("1 each" bun) legitimately uses a whole unit per dish.
    const WHOLE_CONTAINER_UNITS = new Set(["each", "bottle", "btl", "case"]);
    const POURED_CATEGORIES = new Set(["Alcohol", "Beverages"]);
    function looksLikeWholeContainerMistake(
      ingredientId: string | null,
      quantity: number | null,
    ): boolean {
      if (!ingredientId || quantity == null) return false;
      const ing = ingredientById.get(ingredientId) as
        | { unit: string; category: string | null }
        | undefined;
      if (!ing) return false;
      return (
        WHOLE_CONTAINER_UNITS.has(ing.unit.toLowerCase()) &&
        POURED_CATEGORIES.has(ing.category ?? "") &&
        quantity >= 0.3
      );
    }

    const systemPrompt = `You are drafting real, grounded recipes for one or more menu items at a restaurant, using ONLY the ingredients and prep recipes actually on file for this restaurant. Never invent an id that isn't in the lists provided. This restaurant's ingredient list may only cover a narrow category (e.g. alcohol) — it's expected and fine for most raw components of food dishes to have no real match; propose a new one rather than forcing a wrong match.

Respond with ONLY valid JSON, no markdown, no commentary, matching exactly this shape:
{"recipes":[{"menuItemPosId":string,"lines":[{
  "kind":"ingredient"|"prep_recipe"|"new_ingredient"|"new_prep_recipe",
  "ingredientId":string|null,
  "prepRecipeId":string|null,
  "quantity":number,
  "unit":string,
  "proposedName":string|null,
  "proposedSubIngredients":[{"name":string,"quantity":number,"unit":string}]|null,
  "confidence":"high"|"medium"|"low",
  "notes":string|null
}]}]}

Rules:
- Return exactly one "recipes" entry per menu item given below, menuItemPosId copied verbatim — never omit one, even if every line ends up "new_ingredient".
- kind="ingredient": ingredientId MUST be one of the real ids in AVAILABLE INGREDIENTS below (never invent one); unit MUST exactly match that ingredient's own unit as shown. prepRecipeId, proposedName, proposedSubIngredients null.
- CRITICAL — quantity must be expressed IN THE INGREDIENT'S OWN UNIT, not in whatever unit you'd naturally think of the portion in. If the ingredient's unit is a whole-container unit ("each", "bottle", "btl", "case", "unit" — meaning one purchased container, not a serving), and the ingredient is something poured/measured by volume per serving (a spirit, liqueur, cordial, syrup, oil, sauce — anything sold by the bottle but used a little at a time), quantity must be the FRACTION of that container used for one serving, never a raw ounce number. Assume a standard 750ml (~25 oz) bottle unless the ingredient's name says otherwise (e.g. "1L", "1.75L", "handle" imply a bigger bottle — use the real size when you can tell). Example: a 2 oz tequila pour matched to an ingredient with unit "each" → quantity ≈ 0.08 (2 ÷ 25), NEVER quantity 2 (that would mean two whole bottles for one drink). Only write a literal ounce/cup/tbsp number directly when the ingredient's own unit actually IS oz/cup/tbsp/etc. Discrete countable ingredients (a bun, an egg, a cheese slice) are NOT subject to this conversion — "1 each" bun for one burger is correct as-is. Because the real bottle size is a guess, cap confidence at "medium" for any line where you made this conversion, and say so in notes (e.g. "assumed a standard 750ml bottle").
- kind="prep_recipe": same, but ingredientId null, prepRecipeId one of AVAILABLE PREP RECIPES' real ids, unit MUST exactly match that prep recipe's own yield unit — apply the same fraction-of-container logic using the prep recipe's own real yieldQty/yieldUnit (no need to guess a size, it's given).
- kind="new_ingredient": use whenever no real ingredient on file is a genuine match for a raw, purchased component the dish needs. ingredientId and prepRecipeId null. proposedName is your best real name (e.g. "ground beef 80/20"), quantity/unit your best estimate, proposedSubIngredients null.
- kind="new_prep_recipe": use for a house-made component (sauce, dressing, batch) genuinely not already in AVAILABLE PREP RECIPES. proposedName is the suggested recipe name; proposedSubIngredients lists ITS OWN real ingredients+quantities (these may themselves have no match on file — that's expected, it's a proposal for the owner). The outer quantity/unit describe how much of the FINISHED prep recipe this dish uses (e.g. 2 oz).
- confidence: "low" whenever you're inferring purely from the item's name/category with no other signal (this will be common). notes: optional short caveat, else null.
- Never invent a menu item not listed below.`;

    const userMessage = `MENU ITEMS TO DRAFT RECIPES FOR:
${JSON.stringify(menuItems.map((m: { pos_id: string; name: string; category: string | null }) => ({ menuItemPosId: m.pos_id, name: m.name, category: m.category })))}

AVAILABLE INGREDIENTS:
${JSON.stringify(ingredients.map((i: { id: string; name: string; unit: string; unit_cost_cents: number | null; category: string | null }) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category })))}

AVAILABLE PREP RECIPES:
${JSON.stringify(prepRecipes.map((p: { id: string; name: string; yield_qty: number; yield_unit: string }) => ({ id: p.id, name: p.name, yieldQty: p.yield_qty, yieldUnit: p.yield_unit })))}`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text().catch(() => "");
      return json({ ok: false, error: `Claude API error ${anthropicRes.status}: ${errBody}` }, 502);
    }

    const anthropicBody = await anthropicRes.json();
    const rawText: string = (anthropicBody.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");

    let parsed;
    try {
      parsed = JSON.parse(stripJsonFences(rawText));
    } catch {
      return json({ ok: false, error: `Could not parse Claude's response as JSON: ${rawText}` }, 502);
    }

    // Defensive repair pass — Claude was given exact candidate ids but
    // could still hallucinate one; never trust an id we didn't actually
    // provide. A repaired line reads to the frontend exactly like a
    // new_ingredient/new_prep_recipe line (empty pre-fill).
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
    const recipes = (parsed.recipes ?? []).map((r: { menuItemPosId?: string; lines?: RawLine[] }) => ({
      menuItemPosId: r.menuItemPosId ?? null,
      lines: (r.lines ?? []).map((l) => {
        const kind = LINE_KINDS.includes(l.kind ?? "") ? l.kind : "new_ingredient";
        const ingredientId =
          kind === "ingredient" && l.ingredientId && ingredientIds.has(l.ingredientId)
            ? l.ingredientId
            : null;
        const prepRecipeId =
          kind === "prep_recipe" && l.prepRecipeId && prepRecipeIds.has(l.prepRecipeId)
            ? l.prepRecipeId
            : null;
        const quantity = typeof l.quantity === "number" ? l.quantity : null;

        // Safety net independent of whether Claude actually followed the
        // container-fraction instruction above — a spirit/liqueur/syrup
        // quantity of a third-of-a-bottle or more for a single serving
        // is almost certainly a units mistake (oz pasted in as whole
        // containers), not a real recipe. Flag loudly rather than let a
        // wildly inflated cost slip through un-reviewed.
        const suspiciousQuantity = looksLikeWholeContainerMistake(ingredientId, quantity);
        const confidence = suspiciousQuantity
          ? "low"
          : CONFIDENCES.includes(l.confidence ?? "")
            ? l.confidence!
            : "low";
        const notes = suspiciousQuantity
          ? `⚠️ This quantity may mean whole containers, not a pour — double-check before adding.${l.notes ? ` ${l.notes}` : ""}`
          : (l.notes ?? null);

        return {
          kind,
          ingredientId,
          prepRecipeId,
          quantity,
          unit: l.unit ?? "",
          proposedName: l.proposedName ?? null,
          proposedSubIngredients: Array.isArray(l.proposedSubIngredients) ? l.proposedSubIngredients : null,
          confidence,
          notes,
        };
      }),
    }));

    return json({ ok: true, recipes }, 200);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
