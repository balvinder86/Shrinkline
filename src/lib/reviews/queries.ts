import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useRestaurantIds } from "@/lib/supabase/scope";

// A user can belong to more than one restaurant, but the dashboard
// today only ever shows one at a time — same simplification used
// throughout src/lib/boh/queries.ts.
function useCurrentRestaurantId(): string | undefined {
  return useRestaurantIds()[0];
}

export type ReviewStatus =
  | "drafted"
  | "approved_pending_post"
  | "posted"
  | "post_failed"
  | "dismissed";

export type Review = {
  id: string;
  reviewerName: string;
  starRating: number;
  reviewText: string | null;
  reviewFoundAt: string;
  reviewWrittenAt: string | null;
  aiDraftReply: string | null;
  editedReply: string | null;
  status: ReviewStatus;
  postedAt: string | null;
  postError: string | null;
};

export function useReviews() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["reviews", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<Review[]> => {
      // Sort by Google's real post date when we have it, newest first;
      // falls back to scrape time for rows where that didn't parse
      // (same reviewWrittenAt ?? reviewFoundAt precedence the UI
      // already displays), so newest-first holds either way.
      const { data, error } = await supabase
        .from("reviews")
        .select(
          "id, reviewer_name, star_rating, review_text, review_found_at, review_written_at, ai_draft_reply, edited_reply, status, posted_at, post_error",
        )
        .eq("restaurant_id", restaurantId!)
        .order("review_written_at", { ascending: false, nullsFirst: false })
        .order("review_found_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []).map((r) => ({
        id: r.id,
        reviewerName: r.reviewer_name,
        starRating: r.star_rating,
        reviewText: r.review_text,
        reviewFoundAt: r.review_found_at,
        reviewWrittenAt: r.review_written_at,
        aiDraftReply: r.ai_draft_reply,
        editedReply: r.edited_reply,
        status: r.status,
        postedAt: r.posted_at,
        postError: r.post_error,
      }));
      // Sorted by the real date the guest wrote the review where we have
      // it (review_written_at, parsed from Google's relative-date text),
      // falling back to when our scan first found it for older rows
      // imported before that column existed. Done client-side since
      // there's no clean way to express "order by coalesce(...)" through
      // the fluent query builder.
      return rows.sort((a, b) => {
        const aTime = new Date(a.reviewWrittenAt ?? a.reviewFoundAt).getTime();
        const bTime = new Date(b.reviewWrittenAt ?? b.reviewFoundAt).getTime();
        return bTime - aTime;
      });
    },
  });
}

export type ReviewAgentConnection = {
  businessName: string;
  businessDescription: string | null;
  replyContactEmail: string | null;
  searchQuery: string;
  businessProfileId: string;
  cookiesCapturedAt: string | null;
  cookiesValidAt: string | null;
  lastSyncedAt: string | null;
  autoSend5Star: boolean;
  // Set by the most recent scan — null until the first scan runs.
  // false means Google's own reviews panel is self-contradicting
  // (real nonzero review count, but no reviews render on the "All"
  // tab), a real Google-side bug, not something wrong with the
  // connection itself.
  lastScanGoogleReviewCount: number | null;
  lastScanPanelHealthy: boolean | null;
};

// null means "not connected yet" — no fake default state, the Agent
// tab shows a real "not connected" message rather than assuming a
// connection exists.
export function useReviewAgentConnection() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["review-agent-connection", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<ReviewAgentConnection | null> => {
      const { data: cred, error: credErr } = await supabase
        .from("review_agent_credentials")
        .select(
          "business_profile_id, search_query, cookies_captured_at, cookies_valid_at, last_synced_at, last_scan_google_review_count, last_scan_panel_healthy",
        )
        .eq("restaurant_id", restaurantId!)
        .eq("provider", "google")
        .maybeSingle();
      if (credErr) throw credErr;
      if (!cred) return null;

      const { data: settings, error: settingsErr } = await supabase
        .from("review_agent_settings")
        .select("business_name, business_description, reply_contact_email, auto_send_5_star")
        .eq("restaurant_id", restaurantId!)
        .maybeSingle();
      if (settingsErr) throw settingsErr;

      return {
        businessName: settings?.business_name ?? "",
        businessDescription: settings?.business_description ?? null,
        replyContactEmail: settings?.reply_contact_email ?? null,
        searchQuery: cred.search_query,
        businessProfileId: cred.business_profile_id,
        cookiesCapturedAt: cred.cookies_captured_at,
        cookiesValidAt: cred.cookies_valid_at,
        lastSyncedAt: cred.last_synced_at,
        autoSend5Star: settings?.auto_send_5_star ?? false,
        lastScanGoogleReviewCount: cred.last_scan_google_review_count,
        lastScanPanelHealthy: cred.last_scan_panel_healthy,
      };
    },
  });
}

// Direct tenant-scoped write (RLS-protected), not routed through the
// Railway service — this only flips a setting, it doesn't touch
// Google. Real behavior change though: when on, the next scan posts
// 5-star replies immediately instead of waiting for approval, so the
// UI keeps this behind an explicit confirm, not a bare click-to-toggle.
export function useSetAutoSend5Star() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { error } = await supabase
        .from("review_agent_settings")
        .update({ auto_send_5_star: enabled })
        .eq("restaurant_id", restaurantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-agent-connection"] });
    },
  });
}

// Calls the review-agent Edge Function's "scan" action — read-only on
// Google's side, drafts real Claude replies for any new unreplied
// review not already in `reviews`. This is what the "Check now" button
// calls, and reuses the exact same Railway endpoint the background
// sweep calls on its own timer.
export function usePreviewReviews() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ found: number; drafted: number; autoPosted: number }> => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("review-agent", {
        body: { action: "scan", restaurant_id: restaurantId },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "scan failed",
        );
      }
      return data as { found: number; drafted: number; autoPosted: number };
    },
    // onSettled, not onSuccess — a failed scan still updates
    // cookies_valid_at/last_synced_at server-side, and a failed post
    // still writes post_error, so the UI needs a refetch either way.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
      queryClient.invalidateQueries({ queryKey: ["review-agent-connection"] });
    },
  });
}

// Writes the (possibly-edited) reply text, then calls the review-agent
// Edge Function's "post" action, which actually posts the reply live
// to Google. There is no auto-post mode anywhere in this app — this
// mutation only ever runs from an explicit "Approve & post" click.
export function useApproveAndPost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ reviewId, replyText }: { reviewId: string; replyText: string }) => {
      const { error: updateErr } = await supabase
        .from("reviews")
        .update({ edited_reply: replyText, status: "approved_pending_post" })
        .eq("id", reviewId);
      if (updateErr) throw updateErr;

      const { data, error } = await supabase.functions.invoke("review-agent", {
        body: { action: "post", review_id: reviewId },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "post failed",
        );
      }
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
    },
  });
}

// Calls the review-agent Edge Function's "regenerate" action — asks
// Claude for a fresh draft of one review and writes it to
// ai_draft_reply server-side. Returns the new text directly so the
// open reply drawer can update its textarea without waiting on a
// refetch, but still invalidates ["reviews"] so the list stays
// consistent if the drawer is reopened later.
export function useRegenerateReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reviewId: string): Promise<{ draftReply: string }> => {
      const { data, error } = await supabase.functions.invoke("review-agent", {
        body: { action: "regenerate", review_id: reviewId },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "regenerate failed",
        );
      }
      return data as { draftReply: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reviews"] });
    },
  });
}

export function useDismissReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reviewId: string) => {
      const { error } = await supabase
        .from("reviews")
        .update({ status: "dismissed" })
        .eq("id", reviewId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reviews"] }),
  });
}

export type InsightsTheme = { theme: string; count: number };
export type StaffMention = { name: string; count: number };
export type InsightsResult = {
  insufficientData: boolean;
  praiseThemes: InsightsTheme[];
  complaintThemes: InsightsTheme[];
  staffMentions: StaffMention[];
  sampleSize: { positive: number; negative: number };
};

// Calls the analyze-review-insights Edge Function — real Claude
// analysis of actual review text, on-demand (not auto-run, not
// persisted). No new table: cheap enough to recompute each time given
// real review volumes, and this is a derived view, not source data.
export function useAnalyzeInsights() {
  const restaurantId = useCurrentRestaurantId();
  return useMutation({
    mutationFn: async (): Promise<InsightsResult> => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("analyze-review-insights", {
        body: { restaurant_id: restaurantId },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "analysis failed",
        );
      }
      return data as InsightsResult;
    },
  });
}
