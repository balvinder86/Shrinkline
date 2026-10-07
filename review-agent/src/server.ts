// Real Google review-reply agent — multi-tenant port of
// ~/dev/restaurant-review-agent (single-tenant, already posted a real
// reply for Thrasher's). Runs as a persistent HTTP server, same shape
// as ocr/server.ts: token-authenticated on-demand endpoints plus a
// background sweep in the same process, since Playwright/Google
// review scraping needs both an on-demand "Check now" trigger and
// periodic freshness without anyone having the page open.
//
// Not a public-facing service: the frontend calls Supabase's
// review-agent Edge Function, which verifies the caller's session JWT
// and restaurant membership, then proxies here with a shared secret.

import { createServer } from "node:http";
import {
  getReviewAgentConfigs,
  getCredentialsForRestaurant,
  getGoogleCookies,
  markCookiesValid,
  recordPanelHealth,
  findExistingReview,
  insertDraftReview,
  getReviewForPosting,
  markReviewPosted,
  markReviewPostFailed,
  getReviewForRegenerate,
  updateDraftReply,
  getTrackedQuery,
  insertCompetitorScan,
  getSearchConsoleSiteUrl,
  type RestaurantReviewConfig,
} from "./db.js";
import { scanUnrepliedReviews, postReplyToReview } from "./browser.js";
import { generateReply } from "./claude.js";
import { scanGbpInsights } from "./gbp-insights.js";
import { scanLocalPack, scanOrganicResults } from "./competitor-scan.js";
import { scanBacklinks } from "./backlinks.js";
import { scanCompetitorReviews } from "./competitor-reviews.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const SERVICE_TOKEN = process.env.REVIEW_AGENT_SERVICE_TOKEN;
if (!SERVICE_TOKEN) throw new Error("REVIEW_AGENT_SERVICE_TOKEN must be set");

async function readJsonBody(
  req: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

async function scanConfig(config: RestaurantReviewConfig) {
  const cookies = await getGoogleCookies(config.vaultSecretName);

  const { found, extracted, googleReviewCount, panelHealthy } = await scanUnrepliedReviews(
    cookies,
    config.businessProfileId,
    config.searchQuery,
    (reviewerName, starRating, comment) =>
      generateReply(reviewerName, starRating, comment, config.settings),
    async (review) =>
      (await findExistingReview(
        config.restaurantId,
        review.reviewerName,
        review.starRating,
        review.comment,
      )) !== null,
    config.maxRepliesPerRun,
    config.autoSend5Star,
  );

  await markCookiesValid(config.credentialId, new Date());
  await recordPanelHealth(config.credentialId, googleReviewCount, panelHealthy);

  let drafted = 0;
  let autoPosted = 0;
  for (const review of extracted) {
    // One review failing to save (a dedup-check edge case, a transient
    // DB error) used to throw here and abort the whole scan, dropping
    // every review still left in the batch — log and move on instead.
    try {
      const existingId = await findExistingReview(
        config.restaurantId,
        review.reviewerName,
        review.starRating,
        review.comment,
      );
      if (existingId) continue;
      await insertDraftReview({
        restaurantId: config.restaurantId,
        reviewerName: review.reviewerName,
        starRating: review.starRating,
        reviewText: review.comment,
        aiDraftReply: review.replyText,
        reviewWrittenAt: review.writtenAt,
        autoPosted: review.autoPosted,
        autoPostError: review.autoPostError,
      });
      drafted++;
      if (review.autoPosted) autoPosted++;
    } catch (e) {
      console.error(`[scan] failed to save review by "${review.reviewerName}":`, e);
    }
  }

  return { found, drafted, autoPosted };
}

async function handleScan(restaurantId: string) {
  const config = await getCredentialsForRestaurant(restaurantId);
  const { found, drafted, autoPosted } = await scanConfig(config);
  return { found, drafted, autoPosted };
}

async function handlePost(reviewId: string) {
  const review = await getReviewForPosting(reviewId);

  // A review already marked posted means an earlier call already did
  // the real work — whatever triggered this call again (a client
  // retry, a double-submitted request), re-running Playwright against
  // Google would either fail safely (the review's no longer
  // "Unreplied") or, worse, risk acting on the wrong row if timing
  // shifted the list. Short-circuit before touching Google at all.
  if (review.status === "posted") {
    return { posted: true, alreadyPosted: true };
  }

  const config = await getCredentialsForRestaurant(review.restaurantId);
  const cookies = await getGoogleCookies(config.vaultSecretName);

  try {
    await postReplyToReview(
      cookies,
      config.businessProfileId,
      config.searchQuery,
      review.reviewerName,
      review.reviewText,
      review.replyText,
    );
    await markReviewPosted(reviewId, new Date());
    return { posted: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Re-check status before recording failure — if a concurrent call
    // already posted this review successfully while this one was
    // in-flight, don't clobber that real success with a misleading
    // "failed" state.
    const current = await getReviewForPosting(reviewId);
    if (current.status !== "posted") {
      await markReviewPostFailed(reviewId, message);
    }
    throw new Error(message);
  }
}

async function handleGbpInsights(restaurantId: string) {
  const config = await getCredentialsForRestaurant(restaurantId);
  const cookies = await getGoogleCookies(config.vaultSecretName);
  const insights = await scanGbpInsights(cookies, config.businessProfileId);
  await markCookiesValid(config.credentialId, new Date());
  return insights;
}

// search_console_credentials.site_url is either a domain-property
// ("sc-domain:example.com") or a URL-prefix property
// ("https://example.com/") — normalize both to a bare domain for
// comparing against a scraped organic result's hostname.
function siteUrlToDomain(siteUrl: string | null): string | null {
  if (!siteUrl) return null;
  if (siteUrl.startsWith("sc-domain:")) return siteUrl.slice("sc-domain:".length);
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function handleCompetitorScan(restaurantId: string, trackedQueryId: string) {
  const tracked = await getTrackedQuery(restaurantId, trackedQueryId);
  const config = await getCredentialsForRestaurant(restaurantId);
  const cookies = await getGoogleCookies(config.vaultSecretName);
  const ownDomain = siteUrlToDomain(await getSearchConsoleSiteUrl(restaurantId));

  const [localPack, organicResults] = await Promise.all([
    scanLocalPack(cookies, tracked.query, config.settings.businessName),
    scanOrganicResults(cookies, tracked.query, ownDomain),
  ]);
  const own = localPack.find((e) => e.isOwn) ?? null;

  await insertCompetitorScan({
    restaurantId,
    trackedQueryId: tracked.id,
    query: tracked.query,
    localPack,
    ownInPack: !!own,
    ownPosition: own?.position ?? null,
    organicResults,
  });

  return { localPack, ownInPack: !!own, ownPosition: own?.position ?? null, organicResults };
}

async function handleCompetitorReviews(restaurantId: string, competitorName: string) {
  const config = await getCredentialsForRestaurant(restaurantId);
  const cookies = await getGoogleCookies(config.vaultSecretName);
  return scanCompetitorReviews(cookies, competitorName);
}

async function handleBacklinks(restaurantId: string) {
  const siteUrl = await getSearchConsoleSiteUrl(restaurantId);
  if (!siteUrl) throw new Error("Search Console isn't connected for this restaurant yet");
  const config = await getCredentialsForRestaurant(restaurantId);
  const cookies = await getGoogleCookies(config.vaultSecretName);
  return scanBacklinks(cookies, siteUrl);
}

async function handleRegenerate(reviewId: string) {
  const review = await getReviewForRegenerate(reviewId);
  const config = await getCredentialsForRestaurant(review.restaurantId);
  const draftReply = await generateReply(
    review.reviewerName,
    review.starRating,
    review.reviewText,
    config.settings,
  );
  await updateDraftReply(reviewId, draftReply);
  return { draftReply };
}

const server = createServer(async (req, res) => {
  const respond = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.headers.authorization !== `Bearer ${SERVICE_TOKEN}`) {
    respond(401, { ok: false, error: "unauthorized" });
    return;
  }

  try {
    const body = await readJsonBody(req);

    if (req.url === "/scan" && req.method === "POST") {
      const restaurantId = body.restaurant_id;
      if (typeof restaurantId !== "string") {
        respond(400, { ok: false, error: "restaurant_id is required" });
        return;
      }
      respond(200, { ok: true, ...(await handleScan(restaurantId)) });
      return;
    }

    if (req.url === "/post" && req.method === "POST") {
      const reviewId = body.review_id;
      if (typeof reviewId !== "string") {
        respond(400, { ok: false, error: "review_id is required" });
        return;
      }
      respond(200, { ok: true, ...(await handlePost(reviewId)) });
      return;
    }

    if (req.url === "/gbp-insights" && req.method === "POST") {
      const restaurantId = body.restaurant_id;
      if (typeof restaurantId !== "string") {
        respond(400, { ok: false, error: "restaurant_id is required" });
        return;
      }
      respond(200, { ok: true, ...(await handleGbpInsights(restaurantId)) });
      return;
    }

    if (req.url === "/competitor-scan" && req.method === "POST") {
      const restaurantId = body.restaurant_id;
      const trackedQueryId = body.tracked_query_id;
      if (typeof restaurantId !== "string" || typeof trackedQueryId !== "string") {
        respond(400, { ok: false, error: "restaurant_id and tracked_query_id are required" });
        return;
      }
      respond(200, { ok: true, ...(await handleCompetitorScan(restaurantId, trackedQueryId)) });
      return;
    }

    if (req.url === "/competitor-reviews" && req.method === "POST") {
      const restaurantId = body.restaurant_id;
      const competitorName = body.competitor_name;
      if (typeof restaurantId !== "string" || typeof competitorName !== "string") {
        respond(400, { ok: false, error: "restaurant_id and competitor_name are required" });
        return;
      }
      respond(200, { ok: true, ...(await handleCompetitorReviews(restaurantId, competitorName)) });
      return;
    }

    if (req.url === "/backlinks" && req.method === "POST") {
      const restaurantId = body.restaurant_id;
      if (typeof restaurantId !== "string") {
        respond(400, { ok: false, error: "restaurant_id is required" });
        return;
      }
      respond(200, { ok: true, ...(await handleBacklinks(restaurantId)) });
      return;
    }

    if (req.url === "/regenerate" && req.method === "POST") {
      const reviewId = body.review_id;
      if (typeof reviewId !== "string") {
        respond(400, { ok: false, error: "review_id is required" });
        return;
      }
      respond(200, { ok: true, ...(await handleRegenerate(reviewId)) });
      return;
    }

    respond(404, { ok: false, error: "not found" });
  } catch (e) {
    console.error(`[${req.method} ${req.url}] failed:`, e);
    respond(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, () => console.log(`review-agent service listening on :${PORT}`));

// Background sweep — keeps the Reviews page populated even if nobody
// opens it, replacing the old hourly Railway-cron trigger the source
// repo used. Playwright browser launches are heavy, so this stays at
// the same ~10-15 min cadence as the other Railway services in this
// project rather than polling tighter.
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

async function sweepAllRestaurants() {
  let configs: RestaurantReviewConfig[];
  try {
    configs = await getReviewAgentConfigs();
  } catch (e) {
    console.error("[background-sweep] failed to list review agent configs:", e);
    return;
  }
  for (const config of configs) {
    try {
      const { found, drafted, autoPosted } = await scanConfig(config);
      console.log(
        `[background-sweep] restaurant ${config.restaurantId}: found ${found}, drafted ${drafted}, autoPosted ${autoPosted}`,
      );
    } catch (e) {
      console.error(`[background-sweep] restaurant ${config.restaurantId} failed:`, e);
    }
  }
}

setInterval(sweepAllRestaurants, SWEEP_INTERVAL_MS);
sweepAllRestaurants();
