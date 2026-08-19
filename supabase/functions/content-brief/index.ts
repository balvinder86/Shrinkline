// Real, Claude-drafted content brief for one real keyword gap — a
// search query that genuinely earns Search Console impressions but
// isn't ranking well and has no page dedicated to it. Grounded in the
// real HTML of whichever page currently ranks best for that query
// (so Claude knows what's already covered and doesn't suggest
// duplicating it) plus real business info. Like seo-ai-suggestions,
// this never invents facts — bracketed placeholders for anything not
// actually known.
//
//   { restaurant_id, keyword, clicks, impressions, position, currentBestPage }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { fetchPageMeta } from "../_shared/page-meta.ts";
import { assertTierAccess } from "../_shared/tierGate.ts";

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

    const { restaurant_id, keyword, clicks, impressions, position, currentBestPage } =
      await req.json();
    if (!restaurant_id || !keyword) {
      return json({ ok: false, error: "restaurant_id and keyword are required" }, 400);
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

    let currentPageSummary = "(no page data available)";
    if (currentBestPage) {
      try {
        const meta = await fetchPageMeta(currentBestPage);
        currentPageSummary = `Title: ${meta.title ?? "(none)"}\nDescription: ${meta.description ?? "(none)"}\nVisible text sample: """${meta.bodyTextSample.slice(0, 1200) || "(none)"}"""`;
      } catch (e) {
        currentPageSummary = `(could not fetch: ${String(e instanceof Error ? e.message : e)})`;
      }
    }

    const { data: settings } = await supabase
      .from("review_agent_settings")
      .select("business_name, business_description")
      .eq("restaurant_id", restaurant_id)
      .maybeSingle();

    const userMessage = `Business name: ${settings?.business_name ?? "(unknown)"}
Business description: ${settings?.business_description ?? "(unknown)"}

Real search query with a content gap: "${keyword}"
Real Google Search Console performance (last 28 days): ${impressions ?? "?"} impressions, ${clicks ?? "?"} clicks, average position ${position != null ? Number(position).toFixed(1) : "?"} (not ranking on page 1).

Currently, the page that ranks best for this query is: ${currentBestPage ?? "(unknown)"}
${currentPageSummary}

Draft a content brief for a new or substantially improved page that could genuinely target this real query well, without duplicating what the current best-ranking page above already covers.`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1200,
        system:
          'You are an SEO content strategist drafting a real content brief for one real restaurant, targeting one real search query with a genuine ranking gap. Respond with ONLY valid JSON, no markdown, no commentary, matching exactly this shape: {"suggestedUrlSlug":string,"suggestedTitle":string,"suggestedH1":string,"outline":[string],"reasoning":string}. Rules: suggestedUrlSlug is a short lowercase-hyphenated path starting with "/" (e.g. "/sunday-brunch-mountlake-terrace"), not a full URL. suggestedTitle is 50-60 characters. outline is 4-7 section headers (not full paragraphs) that would genuinely help this page rank for the query and serve a real visitor, in order. reasoning is 1-3 sentences explaining why this fills a real gap, referencing the real query/position/current-page data given. Base everything only on the real data given — never invent facts (address, phone, prices, hours, menu items, event days) that weren\'t provided; if a section would need such a fact, phrase the outline entry generically (e.g. "Weekly specials schedule") rather than inventing specifics.',
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

    let brief;
    try {
      brief = JSON.parse(stripJsonFences(rawText));
    } catch {
      return json(
        { ok: false, error: `Could not parse Claude's response as JSON: ${rawText}` },
        502,
      );
    }

    return json({ ok: true, brief }, 200);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
