// Real, text-grounded comparison between a tenant's own real reviews
// and a real competitor's scraped reviews (see review-agent's
// competitor_reviews action / competitor-reviews.ts) — Claude reads
// both real review sets and extracts genuine, actionable differences,
// same trust level as analyze-review-insights (never invents a theme
// not actually present in the text). Upserted so the comparison
// doesn't need re-scraping to view again, unlike competitor_scans'
// full append-only history — a stale comparison isn't useful once
// outdated, so this overwrites per (restaurant_id, competitor_name).
//
//   { restaurant_id, competitor_name, competitor_rating, competitor_review_count, competitor_reviews: [{stars, text}] }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { assertTierAccess } from "../_shared/tierGate.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MIN_REVIEWS_WITH_TEXT = 3;

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

type ScrapedReview = { stars: number; text: string };

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

    const {
      restaurant_id,
      competitor_name,
      competitor_rating,
      competitor_review_count,
      competitor_reviews,
    } = await req.json();
    if (!restaurant_id || !competitor_name || !Array.isArray(competitor_reviews)) {
      return json(
        {
          ok: false,
          error: "restaurant_id, competitor_name, and competitor_reviews are required",
        },
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
      await assertTierAccess(supabase, restaurant_id, "reviews");
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 402);
    }

    const { data: ownReviews, error: ownReviewsErr } = await supabase
      .from("reviews")
      .select("star_rating, review_text")
      .eq("restaurant_id", restaurant_id)
      .not("review_text", "is", null)
      .neq("status", "dismissed");
    if (ownReviewsErr) {
      return json({ ok: false, error: ownReviewsErr.message }, 500);
    }

    const ownTexts = (ownReviews ?? []).map((r) => `(${r.star_rating}★) ${r.review_text}`);
    const competitorTexts = (competitor_reviews as ScrapedReview[]).map(
      (r) => `(${r.stars}★) ${r.text}`,
    );

    if (ownTexts.length < MIN_REVIEWS_WITH_TEXT || competitorTexts.length < MIN_REVIEWS_WITH_TEXT) {
      return json(
        {
          ok: true,
          insufficientData: true,
          sampleSize: { ours: ownTexts.length, competitor: competitorTexts.length },
        },
        200,
      );
    }

    const userMessage = [
      `OUR REVIEWS:\n${ownTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
      `COMPETITOR ("${competitor_name}") REVIEWS:\n${competitorTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
    ].join("\n\n");

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
          'You compare two real restaurants\' real guest reviews and extract genuine, text-grounded differences — never invent a theme not actually present in the text of either set. Respond with ONLY valid JSON, no markdown, no commentary, matching exactly this shape: {"ourStrengths":[{"theme":string,"count":number}],"competitorStrengths":[{"theme":string,"count":number}],"opportunities":[string]}. ourStrengths = things guests praise about OUR restaurant that aren\'t a recurring theme in the competitor\'s reviews. competitorStrengths = things guests praise about the COMPETITOR that aren\'t a recurring theme in ours — this is the real "what are they doing better" answer. Each theme is a short 2-5 word phrase, count = how many reviews in that restaurant\'s set genuinely mention it. opportunities is 2-4 short, concrete, actionable sentences grounded only in the real text differences found (e.g. a specific complaint that\'s common for us but absent for them, or a specific praised feature they have that we don\'t) — never generic advice. Return empty arrays if there isn\'t real signal.',
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

    let parsed: {
      ourStrengths: { theme: string; count: number }[];
      competitorStrengths: { theme: string; count: number }[];
      opportunities: string[];
    };
    try {
      parsed = JSON.parse(stripJsonFences(rawText));
    } catch {
      return json(
        { ok: false, error: `Could not parse Claude's response as JSON: ${rawText}` },
        502,
      );
    }

    const sampleSize = { ours: ownTexts.length, competitor: competitorTexts.length };

    const { error: upsertErr } = await supabase.from("competitor_review_comparisons").upsert(
      {
        restaurant_id,
        competitor_name,
        competitor_rating: competitor_rating ?? null,
        competitor_review_count: competitor_review_count ?? null,
        our_strengths: parsed.ourStrengths ?? [],
        competitor_strengths: parsed.competitorStrengths ?? [],
        opportunities: parsed.opportunities ?? [],
        sample_size: sampleSize,
        scanned_at: new Date().toISOString(),
      },
      { onConflict: "restaurant_id,competitor_name" },
    );
    if (upsertErr) {
      return json({ ok: false, error: upsertErr.message }, 500);
    }

    return json(
      {
        ok: true,
        insufficientData: false,
        ourStrengths: parsed.ourStrengths ?? [],
        competitorStrengths: parsed.competitorStrengths ?? [],
        opportunities: parsed.opportunities ?? [],
        sampleSize,
      },
      200,
    );
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
