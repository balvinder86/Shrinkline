// Real Google Search Console data — actual keyword rankings, clicks,
// impressions, and page performance for the restaurant's real site.
// Replaces seo.tsx's fully-mock visibilitySeries/keywords/pages
// sections. No persistence: Search Console's own API already serves
// historical date-range queries, so there's nothing to snapshot here.
//
//   { restaurant_id, view: "overview" | "keywords" | "pages" | "content-gaps" | "keyword-detail", query? }
//
// Verifies the caller's session JWT, then verifies restaurant
// membership before touching anything (the service-role client below
// bypasses RLS).

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// GOOGLE_WEB_CLIENT_ID/SECRET, not GMAIL_CLIENT_ID/SECRET — the
// refresh token stored for this tenant was issued by the "Web
// application" type OAuth client (search-console-oauth-start/
// callback), and a refresh token only works with the exact client
// that issued it. Using the wrong client here fails with
// "unauthorized_client", not a helpful error.
const GOOGLE_WEB_CLIENT_ID = Deno.env.get("GOOGLE_WEB_CLIENT_ID")!;
const GOOGLE_WEB_CLIENT_SECRET = Deno.env.get("GOOGLE_WEB_CLIENT_SECRET")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_WEB_CLIENT_ID,
      client_secret: GOOGLE_WEB_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`refresh access token failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type SearchAnalyticsRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

async function queryDimensions(
  accessToken: string,
  siteUrl: string,
  dimensions: Array<"date" | "query" | "page">,
  startDate: string,
  endDate: string,
  rowLimit: number,
  exactQueryFilter?: string,
): Promise<SearchAnalyticsRow[]> {
  const body: Record<string, unknown> = { startDate, endDate, dimensions, rowLimit };
  if (exactQueryFilter) {
    body.dimensionFilterGroups = [
      { filters: [{ dimension: "query", operator: "equals", expression: exactQueryFilter }] },
    ];
  }
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const parsed = await res.json();
  if (!res.ok) {
    throw new Error(`Search Console API error (${res.status}): ${JSON.stringify(parsed)}`);
  }
  return parsed.rows ?? [];
}

function queryOneDimension(
  accessToken: string,
  siteUrl: string,
  dimension: "date" | "query" | "page",
  startDate: string,
  endDate: string,
  rowLimit: number,
): Promise<SearchAnalyticsRow[]> {
  return queryDimensions(accessToken, siteUrl, [dimension], startDate, endDate, rowLimit);
}

// A real content gap: a search query that genuinely earns impressions
// but isn't ranking well (avg position past page 1) — computed purely
// from real Search Console numbers, no AI judgment involved. The
// "current best page" is whichever real page actually earned the most
// clicks for that query in the period (ties broken by impressions).
const GAP_MIN_IMPRESSIONS = 15;
const GAP_MIN_POSITION = 10;

function computeContentGaps(rows: SearchAnalyticsRow[]) {
  const byQuery = new Map<
    string,
    {
      totalClicks: number;
      totalImpressions: number;
      positionSum: number;
      positionCount: number;
      bestPage: string;
      bestPageClicks: number;
      bestPageImpressions: number;
    }
  >();
  for (const r of rows) {
    const [query, page] = r.keys;
    const entry = byQuery.get(query) ?? {
      totalClicks: 0,
      totalImpressions: 0,
      positionSum: 0,
      positionCount: 0,
      bestPage: page,
      bestPageClicks: -1,
      bestPageImpressions: -1,
    };
    entry.totalClicks += r.clicks;
    entry.totalImpressions += r.impressions;
    entry.positionSum += r.position * r.impressions;
    entry.positionCount += r.impressions;
    if (
      r.clicks > entry.bestPageClicks ||
      (r.clicks === entry.bestPageClicks && r.impressions > entry.bestPageImpressions)
    ) {
      entry.bestPage = page;
      entry.bestPageClicks = r.clicks;
      entry.bestPageImpressions = r.impressions;
    }
    byQuery.set(query, entry);
  }

  return [...byQuery.entries()]
    .map(([query, e]) => ({
      query,
      totalClicks: e.totalClicks,
      totalImpressions: e.totalImpressions,
      avgPosition: e.positionCount > 0 ? e.positionSum / e.positionCount : 0,
      currentBestPage: e.bestPage,
    }))
    .filter((g) => g.totalImpressions >= GAP_MIN_IMPRESSIONS && g.avgPosition > GAP_MIN_POSITION)
    .sort((a, b) => b.totalImpressions - a.totalImpressions)
    .slice(0, 20);
}

// Explicit start/end from the caller (the global date-range filter,
// shared by Home's SEO tile and the dedicated /seo page) wins over the
// view's own default lookback window — but never past the real ~3-day
// GSC data lag (`maxEnd`), so a range including "today" doesn't
// silently ask for days Google hasn't indexed yet.
function resolveRange(
  requestedStartDate: string | undefined,
  requestedEndDate: string | undefined,
  maxEnd: Date,
  defaultLookbackDays: number,
): { start: Date; end: Date } {
  const requestedEnd = requestedEndDate ? new Date(requestedEndDate) : null;
  const end = requestedEnd && requestedEnd < maxEnd ? requestedEnd : maxEnd;
  const start = requestedStartDate
    ? new Date(requestedStartDate)
    : (() => {
        const d = new Date(end);
        d.setDate(d.getDate() - defaultLookbackDays);
        return d;
      })();
  return { start, end };
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

    const {
      restaurant_id,
      view,
      query: queryFilter,
      start_date: requestedStartDate,
      end_date: requestedEndDate,
    } = await req.json();
    if (!restaurant_id) {
      return json({ ok: false, error: "restaurant_id is required" }, 400);
    }
    if (!["overview", "keywords", "pages", "content-gaps", "keyword-detail"].includes(view)) {
      return json(
        {
          ok: false,
          error:
            "view must be 'overview', 'keywords', 'pages', 'content-gaps', or 'keyword-detail'",
        },
        400,
      );
    }
    if (view === "keyword-detail" && !queryFilter) {
      return json({ ok: false, error: "query is required for view 'keyword-detail'" }, 400);
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

    const { data: cred, error: credErr } = await supabase
      .from("search_console_credentials")
      .select("id, site_url, vault_secret_name")
      .eq("restaurant_id", restaurant_id)
      .maybeSingle();
    if (credErr) {
      return json({ ok: false, error: credErr.message }, 500);
    }
    if (!cred) {
      return json({ ok: true, connected: false }, 200);
    }

    const { data: secretRaw, error: secretErr } = await supabase.rpc("get_pos_secret", {
      secret_name: cred.vault_secret_name,
    });
    if (secretErr || !secretRaw) {
      return json({ ok: false, error: `vault secret not found: ${secretErr?.message ?? ""}` }, 500);
    }
    const { refreshToken } = JSON.parse(secretRaw);
    const googleAccessToken = await refreshAccessToken(refreshToken);

    // Search Console's own data typically lags 2-3 days behind real
    // time, so "today" isn't a useful endDate — back off 3 days.
    const end = new Date();
    end.setDate(end.getDate() - 3);

    if (view === "overview") {
      const { start, end: effectiveEnd } = resolveRange(
        requestedStartDate,
        requestedEndDate,
        end,
        56, // 8 weeks, default window
      );
      const rows = await queryOneDimension(
        googleAccessToken,
        cred.site_url,
        "date",
        isoDate(start),
        isoDate(effectiveEnd),
        // Real row cap: one row per calendar day in the queried range,
        // plus slack for the 8-week default.
        Math.max(
          56,
          Math.round((effectiveEnd.getTime() - start.getTime()) / 86_400_000) + 1,
        ),
      );
      await supabase
        .from("search_console_credentials")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", cred.id);
      return json(
        {
          ok: true,
          connected: true,
          rows: rows.map((r) => ({
            date: r.keys[0],
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          })),
        },
        200,
      );
    }

    if (view === "keywords") {
      const { start, end: effectiveEnd } = resolveRange(
        requestedStartDate,
        requestedEndDate,
        end,
        28,
      );
      const rows = await queryOneDimension(
        googleAccessToken,
        cred.site_url,
        "query",
        isoDate(start),
        isoDate(effectiveEnd),
        25,
      );
      return json(
        {
          ok: true,
          connected: true,
          rows: rows
            .sort((a, b) => b.clicks - a.clicks)
            .map((r) => ({
              query: r.keys[0],
              clicks: r.clicks,
              impressions: r.impressions,
              ctr: r.ctr,
              position: r.position,
            })),
        },
        200,
      );
    }

    if (view === "content-gaps") {
      const { start, end: effectiveEnd } = resolveRange(
        requestedStartDate,
        requestedEndDate,
        end,
        28,
      );
      const rows = await queryDimensions(
        googleAccessToken,
        cred.site_url,
        ["query", "page"],
        isoDate(start),
        isoDate(effectiveEnd),
        500,
      );
      return json({ ok: true, connected: true, rows: computeContentGaps(rows) }, 200);
    }

    if (view === "keyword-detail") {
      const trendStart = new Date(end);
      trendStart.setDate(trendStart.getDate() - 56); // 8 weeks, matches the Overview chart
      const pageStart = new Date(end);
      pageStart.setDate(pageStart.getDate() - 28);

      const [trendRows, pageRows] = await Promise.all([
        queryDimensions(
          googleAccessToken,
          cred.site_url,
          ["date"],
          isoDate(trendStart),
          isoDate(end),
          56,
          queryFilter,
        ),
        queryDimensions(
          googleAccessToken,
          cred.site_url,
          ["page"],
          isoDate(pageStart),
          isoDate(end),
          10,
          queryFilter,
        ),
      ]);

      const bestPage = [...pageRows].sort((a, b) => b.clicks - a.clicks)[0] ?? null;
      const totalClicks = trendRows.reduce((s, r) => s + r.clicks, 0);
      const totalImpressions = trendRows.reduce((s, r) => s + r.impressions, 0);
      const positionSum = trendRows.reduce((s, r) => s + r.position * r.impressions, 0);

      return json(
        {
          ok: true,
          connected: true,
          trend: trendRows.map((r) => ({
            date: r.keys[0],
            clicks: r.clicks,
            impressions: r.impressions,
            position: r.position,
          })),
          currentBestPage: bestPage ? bestPage.keys[0] : null,
          totalClicks,
          totalImpressions,
          avgPosition: totalImpressions > 0 ? positionSum / totalImpressions : null,
        },
        200,
      );
    }

    // view === "pages"
    const { start, end: effectiveEnd } = resolveRange(
      requestedStartDate,
      requestedEndDate,
      end,
      28,
    );
    const rows = await queryOneDimension(
      googleAccessToken,
      cred.site_url,
      "page",
      isoDate(start),
      isoDate(effectiveEnd),
      25,
    );
    return json(
      {
        ok: true,
        connected: true,
        rows: rows
          .sort((a, b) => b.clicks - a.clicks)
          .map((r) => ({
            page: r.keys[0],
            clicks: r.clicks,
            impressions: r.impressions,
            ctr: r.ctr,
            position: r.position,
          })),
      },
      200,
    );
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
