// Real structured-data coverage check across a tenant's real pages —
// fetches each page's actual live HTML and reports the JSON-LD @type
// values genuinely found. No AI call (cheap, fast, so this can scan
// several pages per request); drafting a fix for a gap is the AI
// Agent tab's job, not this one's.
//
//   { restaurant_id, urls: string[] }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { fetchPageMeta } from "../_shared/page-meta.ts";
import { assertTierAccess } from "../_shared/tierGate.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// Common, genuinely useful schema.org types for a restaurant site —
// used only to flag which of these were found nowhere across the
// scanned pages, never asserted as present without real evidence.
const RECOMMENDED_TYPES = ["Restaurant", "LocalBusiness", "Menu", "FAQPage", "BreadcrumbList"];

const MAX_URLS = 15;

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

    const { restaurant_id, urls } = await req.json();
    if (!restaurant_id || !Array.isArray(urls) || urls.length === 0) {
      return json(
        { ok: false, error: "restaurant_id and a non-empty urls array are required" },
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

    try {
      await assertTierAccess(supabase, restaurant_id, "seo");
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 402);
    }

    const targetUrls: string[] = [...new Set(urls)].slice(0, MAX_URLS);

    const pages = await Promise.all(
      targetUrls.map(async (url) => {
        try {
          const meta = await fetchPageMeta(url);
          return { url, schemaTypes: meta.schemaTypes, error: null as string | null };
        } catch (e) {
          return {
            url,
            schemaTypes: [] as string[],
            error: String(e instanceof Error ? e.message : e),
          };
        }
      }),
    );

    const typesFoundSitewide = [...new Set(pages.flatMap((p) => p.schemaTypes))];
    const recommendedTypesMissingSitewide = RECOMMENDED_TYPES.filter(
      (t) => !typesFoundSitewide.includes(t),
    );

    return json(
      {
        ok: true,
        pages,
        summary: {
          typesFoundSitewide,
          recommendedTypesMissingSitewide,
          pagesScanned: pages.length,
          pagesWithNoSchema: pages.filter((p) => !p.error && p.schemaTypes.length === 0).length,
        },
      },
      200,
    );
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
