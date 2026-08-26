// Real backend for Settings > Notifications (src/routes/settings.tsx's
// NotificationsSection) — sends one nightly digest email per
// restaurant, called from index.ts's pollExistingBatch right after
// that day's ai_recommendations are ingested. Piggybacks on the
// existing nightly cron rather than its own schedule: low-par data,
// ai_recommendations, and reviews are all things this service (or the
// review-agent's own writes to `reviews`) already produces daily.
//
// v1 is digest-only, no real-time triggers (invoice-processed,
// per-review alerts) — those need hooks into invoice-ocr/review-agent
// that are separate follow-up work. See db/phase2/77_notification_preferences.sql.

import { supabase } from "./supabase.js";
import { getAllLocations, getLowParForLocation, type LowParItem } from "./db.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_FROM = "Shrinkline <digest@mail.shrinkline.ai>";

type Recommendation = {
  tab: string;
  severity: string;
  headline: string;
  body: string;
};

type Review = {
  reviewer_name: string;
  star_rating: number;
  review_text: string | null;
  review_found_at: string;
};

type Membership = { user_id: string; role: string; permissions: Record<string, boolean> };

// Same contract as supabase/functions/chat/index.ts's hasAccess() —
// owners always see everything, everyone else needs the key granted.
function hasAccess(membership: Membership, key: string): boolean {
  if (membership.role === "owner") return true;
  return membership.permissions[key] === true;
}

async function alreadySentToday(restaurantId: string, businessDate: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("notification_digest_log")
    .select("business_date")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (error)
    throw new Error(`load notification_digest_log for ${restaurantId} failed: ${error.message}`);
  return data?.business_date === businessDate;
}

async function lastDigestSentAt(restaurantId: string): Promise<string> {
  const { data, error } = await supabase
    .from("notification_digest_log")
    .select("last_sent_at")
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (error)
    throw new Error(`load notification_digest_log for ${restaurantId} failed: ${error.message}`);
  // Never sent before — go back far enough that "new reviews since
  // last digest" effectively means "all real reviews," not nothing.
  return data?.last_sent_at ?? "2000-01-01T00:00:00Z";
}

function renderDigestHtml(opts: {
  restaurantName: string;
  lowPar: LowParItem[];
  recommendations: Recommendation[];
  reviews: Review[];
}): string {
  const { restaurantName, lowPar, recommendations, reviews } = opts;
  const negativeReviews = reviews.filter((r) => r.star_rating <= 3);

  const sections: string[] = [];
  if (lowPar.length > 0) {
    sections.push(
      `<h3>Low inventory (${lowPar.length})</h3><ul>` +
        lowPar
          .map(
            (i) =>
              `<li>${i.ingredient_name} — ${i.avg_daily_usage} used/day vs. ${i.par_quantity} par</li>`,
          )
          .join("") +
        `</ul>`,
    );
  }
  if (recommendations.length > 0) {
    sections.push(
      `<h3>AI recommendations (${recommendations.length})</h3><ul>` +
        recommendations.map((r) => `<li><strong>${r.headline}</strong> — ${r.body}</li>`).join("") +
        `</ul>`,
    );
  }
  if (reviews.length > 0) {
    sections.push(
      `<h3>New reviews (${reviews.length}${negativeReviews.length ? `, ${negativeReviews.length} ≤3★` : ""})</h3><ul>` +
        reviews
          .map(
            (r) =>
              `<li>${"★".repeat(r.star_rating)}${r.star_rating <= 3 ? " <strong>(needs attention)</strong>" : ""} ${r.reviewer_name}${r.review_text ? ` — "${r.review_text}"` : ""}</li>`,
          )
          .join("") +
        `</ul>`,
    );
  }

  const body =
    sections.length > 0 ? sections.join("") : `<p>Nothing new to report today — all quiet.</p>`;

  return `<h2>${restaurantName} — nightly digest</h2>${body}`;
}

// One send per opted-in recipient, permission-filtered per section
// (owners see everything; manager/staff need the matching key granted
// — same gate chat's own get_ai_recommendations/get_inventory_variance
// tools use). A recipient with every relevant toggle off, or no
// permission to any section, is skipped rather than sent an empty email.
export async function sendDigestEmails(restaurantId: string, businessDate: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error("[insights] RESEND_API_KEY not set — skipping digest send");
    return;
  }
  if (await alreadySentToday(restaurantId, businessDate)) {
    console.log(`[insights] ${restaurantId}: digest already sent for ${businessDate}`);
    return;
  }

  const [
    { data: restaurant, error: restaurantErr },
    allLocations,
    { data: memberships, error: memErr },
  ] = await Promise.all([
    supabase.from("restaurants").select("name").eq("id", restaurantId).single(),
    getAllLocations(),
    supabase
      .from("memberships")
      .select("user_id, role, permissions")
      .eq("restaurant_id", restaurantId),
  ]);
  if (restaurantErr)
    throw new Error(`load restaurant ${restaurantId} failed: ${restaurantErr.message}`);
  if (memErr) throw new Error(`load memberships for ${restaurantId} failed: ${memErr.message}`);
  if (!memberships || memberships.length === 0) return;

  const locationIds = allLocations.filter((l) => l.restaurant_id === restaurantId).map((l) => l.id);
  if (locationIds.length === 0) return;

  const sinceIso = await lastDigestSentAt(restaurantId);

  const [
    lowParByLocation,
    { data: recommendations, error: recErr },
    { data: reviews, error: reviewErr },
  ] = await Promise.all([
    Promise.all(locationIds.map((id) => getLowParForLocation(id))),
    supabase
      .from("ai_recommendations")
      .select("tab, severity, headline, body")
      .in("location_id", locationIds)
      .eq("business_date", businessDate),
    supabase
      .from("reviews")
      .select("reviewer_name, star_rating, review_text, review_found_at")
      .eq("restaurant_id", restaurantId)
      .gt("review_found_at", sinceIso)
      .order("review_found_at", { ascending: false }),
  ]);
  if (recErr)
    throw new Error(`load ai_recommendations for ${restaurantId} failed: ${recErr.message}`);
  if (reviewErr) throw new Error(`load reviews for ${restaurantId} failed: ${reviewErr.message}`);

  const lowPar = lowParByLocation.flat();
  const allRecommendations = recommendations ?? [];
  const allReviews = (reviews ?? []) as Review[];

  const userIds = (memberships as Membership[]).map((m) => m.user_id);
  const { data: prefRows, error: prefErr } = await supabase
    .from("notification_preferences")
    .select("user_id, event_key, email_enabled")
    .eq("restaurant_id", restaurantId)
    .in("user_id", userIds);
  if (prefErr)
    throw new Error(`load notification_preferences for ${restaurantId} failed: ${prefErr.message}`);

  const prefsByUser = new Map<string, Map<string, boolean>>();
  for (const row of prefRows ?? []) {
    if (!prefsByUser.has(row.user_id)) prefsByUser.set(row.user_id, new Map());
    prefsByUser.get(row.user_id)!.set(row.event_key, row.email_enabled);
  }
  const wantsEvent = (userId: string, eventKey: string) =>
    prefsByUser.get(userId)?.get(eventKey) ?? true;

  for (const membership of memberships as Membership[]) {
    const wantsLowPar =
      wantsEvent(membership.user_id, "low_inventory") && hasAccess(membership, "inventory");
    const wantsRecs =
      wantsEvent(membership.user_id, "ai_recommendations") && hasAccess(membership, "pnl");
    const wantsReviews =
      (wantsEvent(membership.user_id, "new_review") ||
        wantsEvent(membership.user_id, "negative_review")) &&
      hasAccess(membership, "reviews");

    if (!wantsLowPar && !wantsRecs && !wantsReviews) continue;

    const recipientLowPar = wantsLowPar ? lowPar : [];
    const recipientRecs = wantsRecs ? allRecommendations : [];
    const recipientReviews = wantsReviews
      ? wantsEvent(membership.user_id, "new_review")
        ? allReviews
        : allReviews.filter((r) => r.star_rating <= 3) // only opted into negative_review, not new_review
      : [];

    if (recipientLowPar.length === 0 && recipientRecs.length === 0 && recipientReviews.length === 0)
      continue;

    const { data: userRes, error: userErr } = await supabase.auth.admin.getUserById(
      membership.user_id,
    );
    if (userErr || !userRes?.user?.email) {
      console.error(
        `[insights] ${restaurantId}: could not resolve email for ${membership.user_id} (non-fatal)`,
      );
      continue;
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: DIGEST_FROM,
          to: userRes.user.email,
          subject: `${restaurant!.name} — nightly digest`,
          html: renderDigestHtml({
            restaurantName: restaurant!.name,
            lowPar: recipientLowPar,
            recommendations: recipientRecs,
            reviews: recipientReviews,
          }),
        }),
      });
      if (!res.ok) {
        console.error(
          `[insights] ${restaurantId}: digest send to ${userRes.user.email} failed: ${await res.text()}`,
        );
      }
    } catch (e) {
      // One recipient's send failure shouldn't block the rest — same
      // non-fatal-per-item pattern as submitTodaysBatch's per-location loop.
      console.error(
        `[insights] ${restaurantId}: digest send to ${userRes.user.email} failed (non-fatal): ${e}`,
      );
    }
  }

  const { error: logErr } = await supabase.from("notification_digest_log").upsert(
    {
      restaurant_id: restaurantId,
      business_date: businessDate,
      last_sent_at: new Date().toISOString(),
    },
    { onConflict: "restaurant_id" },
  );
  if (logErr)
    throw new Error(`update notification_digest_log for ${restaurantId} failed: ${logErr.message}`);
}
