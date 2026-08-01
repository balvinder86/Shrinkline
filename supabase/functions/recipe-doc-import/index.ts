// Recipe doc import proxy — mirrors invoice-ocr/index.ts exactly.
// The actual document handling (downloading from Storage, extracting
// DOCX text, calling Claude) lives in the same Node service on
// Railway invoice OCR already uses (~/dev/thrasherspub/ocr/) — no npm
// packages are usable from a Deno Edge Function, and that service
// already has Storage access and the enqueue/check plumbing proven
// out. This function's job is just: verify the caller's session JWT,
// verify the caller is actually a member of the import's restaurant
// (NOT automatic — the service-role client below bypasses RLS), then
// forward to Railway with a shared secret the browser never sees.
//
//   { recipe_import_id, action: "enqueue" | "check" }

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const OCR_SERVICE_URL = Deno.env.get("OCR_SERVICE_URL")!;
const OCR_SERVICE_TOKEN = Deno.env.get("OCR_SERVICE_TOKEN")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      return json({ ok: false, step: "auth", error: "missing Authorization header" }, 401);
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return json({ ok: false, step: "auth", error: "invalid session" }, 401);
    }

    const { recipe_import_id, action } = await req.json();
    if (!recipe_import_id || !action || (action !== "enqueue" && action !== "check")) {
      return json(
        { ok: false, step: "input", error: "recipe_import_id and a valid action are required" },
        400,
      );
    }

    const { data: recipeImport, error: recipeImportErr } = await supabase
      .from("recipe_imports")
      .select("id, restaurant_id")
      .eq("id", recipe_import_id)
      .single();
    if (recipeImportErr || !recipeImport) {
      return json({ ok: false, step: "load_recipe_import", error: recipeImportErr?.message ?? "not found" }, 404);
    }

    const { data: membership } = await supabase
      .from("memberships")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .eq("restaurant_id", recipeImport.restaurant_id)
      .maybeSingle();
    if (!membership) {
      return json({ ok: false, step: "auth", error: "not a member of this restaurant" }, 403);
    }

    const railwayRes = await fetch(`${OCR_SERVICE_URL}/recipe-import/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OCR_SERVICE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipe_import_id }),
    });
    const railwayBody = await railwayRes.json().catch(() => null);
    return json(railwayBody ?? { ok: false, error: "empty response from OCR service" }, railwayRes.status);
  } catch (e) {
    return json({ ok: false, step: "unexpected", error: String(e) }, 500);
  }
});
