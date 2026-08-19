// Real Claude-powered analysis of actual review text — finds recurring
// praise/complaint themes across a restaurant's reviews. Genuinely
// reads the text and extracts what's really there (same trust level
// as the reply-generation Claude already does), not a fabricated or
// hardcoded list. On-demand only (a button click), not persisted —
// cheap enough to recompute each time given real review volumes, and
// avoids a new table for something that's just a derived view.
//
//   { restaurant_id }
//
// Verifies the caller's session JWT, then verifies restaurant
// membership before touching anything (the service-role client below
// bypasses RLS).

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

type Theme = { theme: string; count: number };
type StaffMention = { name: string; count: number };

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

    const { restaurant_id } = await req.json();
    if (!restaurant_id) {
      return json({ ok: false, error: "restaurant_id is required" }, 400);
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

    const { data: reviews, error: reviewsErr } = await supabase
      .from("reviews")
      .select("star_rating, review_text")
      .eq("restaurant_id", restaurant_id)
      .not("review_text", "is", null)
      .neq("status", "dismissed");
    if (reviewsErr) {
      return json({ ok: false, error: reviewsErr.message }, 500);
    }

    const positive = (reviews ?? [])
      .filter((r) => r.star_rating >= 4)
      .map((r) => r.review_text as string);
    const negative = (reviews ?? [])
      .filter((r) => r.star_rating <= 2)
      .map((r) => r.review_text as string);

    if (positive.length + negative.length < MIN_REVIEWS_WITH_TEXT) {
      return json(
        {
          ok: true,
          insufficientData: true,
          sampleSize: { positive: positive.length, negative: negative.length },
        },
        200,
      );
    }

    const userMessage = [
      positive.length > 0
        ? `POSITIVE REVIEWS (4-5 star):\n${positive.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
        : "POSITIVE REVIEWS (4-5 star): none",
      negative.length > 0
        ? `NEGATIVE REVIEWS (1-2 star):\n${negative.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
        : "NEGATIVE REVIEWS (1-2 star): none",
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
        max_tokens: 1024,
        system:
          'You analyze real restaurant guest reviews and extract recurring themes actually present in the text. Respond with ONLY valid JSON, no markdown, no commentary, matching exactly this shape: {"praiseThemes":[{"theme":string,"count":number}],"complaintThemes":[{"theme":string,"count":number}],"staffMentions":[{"name":string,"count":number}]}. Each theme is a short 2-5 word phrase (e.g. "Friendly staff", "Slow service on weekends"). At most 5 themes per list, ordered by count descending. count = how many of the given reviews genuinely mention that theme — never invent a theme not actually reflected in the text, and return fewer than 5 (or an empty list) if there isn\'t real signal for more. staffMentions: scan ONLY the positive (4-5 star) reviews for actual employee/staff first names or full names the guest names by name (e.g. "Our server Maria was great", "ask for Jake at the bar") — a real person\'s name, not a generic role like "the waitress" or "our server". count = how many positive reviews name that person. At most 8 people, ordered by count descending, empty list if no one is named by name.',
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

    let parsed: { praiseThemes: Theme[]; complaintThemes: Theme[]; staffMentions: StaffMention[] };
    try {
      parsed = JSON.parse(stripJsonFences(rawText));
    } catch {
      return json(
        { ok: false, error: `Could not parse Claude's response as JSON: ${rawText}` },
        502,
      );
    }

    return json(
      {
        ok: true,
        insufficientData: false,
        praiseThemes: parsed.praiseThemes ?? [],
        complaintThemes: parsed.complaintThemes ?? [],
        staffMentions: parsed.staffMentions ?? [],
        sampleSize: { positive: positive.length, negative: negative.length },
      },
      200,
    );
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
