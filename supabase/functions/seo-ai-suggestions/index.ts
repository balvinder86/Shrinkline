// Real AI-drafted SEO suggestions for one real page — fetches the
// page's actual live HTML, extracts its current title/meta
// description/structured data, and asks Claude to draft improvements
// grounded in that real content plus real Search Console performance
// for the page. This app doesn't control the tenant's website (Wix,
// Squarespace, custom — varies per restaurant), so there's no
// "auto-apply": every suggestion is copy-paste-ready text for the
// owner to paste into their own site's SEO settings. Claude is
// explicitly told to use bracketed placeholders for any real-world
// fact we don't actually have data for (address, phone), never invent
// one — the original Lovable mock fabricated a fake San Francisco
// address for this exact business, which is the mistake this guards
// against.
//
//   { restaurant_id, url, clicks?, impressions?, position? }

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

    const { restaurant_id, url, clicks, impressions, position } = await req.json();
    if (!restaurant_id || !url) {
      return json({ ok: false, error: "restaurant_id and url are required" }, 400);
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

    let meta;
    try {
      meta = await fetchPageMeta(url);
    } catch (e) {
      return json({ ok: false, error: String(e instanceof Error ? e.message : e) }, 502);
    }

    const { data: settings } = await supabase
      .from("review_agent_settings")
      .select("business_name, business_description")
      .eq("restaurant_id", restaurant_id)
      .maybeSingle();

    const performanceLine =
      clicks != null && impressions != null && position != null
        ? `Real Google Search Console performance (last 28 days): ${clicks} clicks, ${impressions} impressions, average position ${Number(position).toFixed(1)}.`
        : "No Search Console performance data available for this page yet.";

    const userMessage = `Page URL: ${url}
Business name: ${settings?.business_name ?? "(unknown)"}
Business description: ${settings?.business_description ?? "(unknown)"}

Current <title>: ${meta.title ?? "(none found)"}
Current meta description: ${meta.description ?? "(none found)"}
Structured data types currently on page: ${meta.schemaTypes.length > 0 ? meta.schemaTypes.join(", ") : "(none found)"}

${performanceLine}

Real visible page text (for grounding only — do not invent facts not present here or in the business info above):
"""
${meta.bodyTextSample || "(could not extract page text)"}
"""

Draft SEO improvements for this real page.`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1500,
        system:
          'You are an SEO assistant drafting real, ready-to-paste suggestions for one real restaurant web page. Respond with ONLY valid JSON, no markdown, no commentary, matching exactly this shape: {"suggestedTitle":string,"suggestedDescription":string,"titleReasoning":string,"descriptionReasoning":string,"missingSchemaTypes":[string],"suggestedSchemaJsonLd":string|null}. Rules: suggestedTitle must be 50-60 characters. suggestedDescription must be 150-160 characters and include a natural call to action. Base everything only on the real page text, business info, and performance data given — never invent facts (address, phone, prices, hours) that weren\'t provided; if structured data would need a fact you don\'t have, use a bracketed placeholder like [YOUR ADDRESS] instead of inventing one. missingSchemaTypes lists schema.org types this page should have but doesn\'t (e.g. "Restaurant", "Menu", "FAQPage") based on what the page actually contains — empty array if current schema already covers it. suggestedSchemaJsonLd is a complete, valid JSON-LD script body (as a string, ready to wrap in a <script type="application/ld+json"> tag) for the single most valuable missing type, or null if nothing is missing.',
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

    let suggestions;
    try {
      suggestions = JSON.parse(stripJsonFences(rawText));
    } catch {
      return json(
        { ok: false, error: `Could not parse Claude's response as JSON: ${rawText}` },
        502,
      );
    }

    return json(
      {
        ok: true,
        current: {
          title: meta.title,
          description: meta.description,
          schemaTypes: meta.schemaTypes,
        },
        suggestions,
      },
      200,
    );
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
