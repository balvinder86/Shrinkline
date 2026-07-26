import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useRestaurantIds } from "@/lib/supabase/scope";
import { type DateRange, isoDate } from "@/lib/date-range";

function useCurrentRestaurantId(): string | undefined {
  return useRestaurantIds()[0];
}

export type SearchConsoleConnection = {
  siteUrl: string;
  connectedEmail: string;
  connectedAt: string;
  lastSyncedAt: string | null;
};

// null means "not connected yet" — same pattern as
// useReviewAgentConnection in src/lib/reviews/queries.ts.
export function useSearchConsoleConnection() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["search-console-connection", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<SearchConsoleConnection | null> => {
      const { data, error } = await supabase
        .from("search_console_credentials")
        .select("site_url, connected_email, connected_at, last_synced_at")
        .eq("restaurant_id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        siteUrl: data.site_url,
        connectedEmail: data.connected_email,
        connectedAt: data.connected_at,
        lastSyncedAt: data.last_synced_at,
      };
    },
  });
}

// Calls search-console-oauth-start to get a real Google consent URL,
// then does a full browser redirect — this leaves the app entirely
// (same as any real "Connect with Google" button), so there's nothing
// to return on success; the callback Edge Function handles the rest
// and redirects back to /seo once done.
export function useConnectSearchConsole() {
  const restaurantId = useCurrentRestaurantId();
  return useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("search-console-oauth-start", {
        body: { restaurant_id: restaurantId },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ??
            error?.message ??
            "could not start connection",
        );
      }
      const { authUrl } = data as { authUrl: string };
      window.location.href = authUrl;
    },
  });
}

export type OverviewRow = {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type KeywordRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type PageRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

async function callSearchConsoleData<T>(
  restaurantId: string,
  view: "overview" | "keywords" | "pages" | "content-gaps",
  range?: DateRange,
): Promise<{ connected: boolean; rows: T[] }> {
  const { data, error } = await supabase.functions.invoke("search-console-data", {
    body: {
      restaurant_id: restaurantId,
      view,
      ...(range ? { start_date: isoDate(range.from), end_date: isoDate(range.to) } : undefined),
    },
  });
  if (error || !(data as { ok?: boolean } | null)?.ok) {
    throw new Error(
      (data as { error?: string } | null)?.error ??
        error?.message ??
        "could not load Search Console data",
    );
  }
  const body = data as { connected: boolean; rows?: T[] };
  return { connected: body.connected, rows: body.rows ?? [] };
}

// `range` is optional — omit it for the SEO page's own fixed 8-week
// overview chart; pass it to have the Edge Function honor a real
// arbitrary date range instead (used by Home's SEO module tile,
// driven by the global date-range filter).
export function useSearchConsoleOverview(enabled: boolean, range?: DateRange) {
  const restaurantId = useCurrentRestaurantId();
  const fromIso = range ? isoDate(range.from) : undefined;
  const toIso = range ? isoDate(range.to) : undefined;
  return useQuery({
    queryKey: ["search-console-overview", restaurantId, fromIso, toIso],
    enabled: enabled && !!restaurantId,
    queryFn: () => callSearchConsoleData<OverviewRow>(restaurantId!, "overview", range),
  });
}

export function useSearchConsoleKeywords(enabled: boolean) {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["search-console-keywords", restaurantId],
    enabled: enabled && !!restaurantId,
    queryFn: () => callSearchConsoleData<KeywordRow>(restaurantId!, "keywords"),
  });
}

export function useSearchConsolePages(enabled: boolean) {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["search-console-pages", restaurantId],
    enabled: enabled && !!restaurantId,
    queryFn: () => callSearchConsoleData<PageRow>(restaurantId!, "pages"),
  });
}

export type ContentGapRow = {
  query: string;
  totalClicks: number;
  totalImpressions: number;
  avgPosition: number;
  currentBestPage: string;
};

// Real queries with genuine impressions but a poor average position
// (past page 1) and no dedicated page — computed server-side purely
// from real Search Console numbers (query+page dimensions), no AI
// judgment involved in *finding* the gap, only in drafting a fix.
export function useSearchConsoleContentGaps(enabled: boolean) {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["search-console-content-gaps", restaurantId],
    enabled: enabled && !!restaurantId,
    queryFn: () => callSearchConsoleData<ContentGapRow>(restaurantId!, "content-gaps"),
  });
}

export type KeywordTrendPoint = {
  date: string;
  clicks: number;
  impressions: number;
  position: number;
};

export type KeywordDetail = {
  trend: KeywordTrendPoint[];
  currentBestPage: string | null;
  totalClicks: number;
  totalImpressions: number;
  avgPosition: number | null;
};

// Real 8-week trend + current best-ranking page for one specific real
// search query — same Search Console data as the Keywords tab list,
// filtered server-side to a single query via dimensionFilterGroups.
export function useSearchConsoleKeywordDetail(query: string | null) {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["search-console-keyword-detail", restaurantId, query],
    enabled: !!restaurantId && !!query,
    queryFn: async (): Promise<KeywordDetail> => {
      const { data, error } = await supabase.functions.invoke("search-console-data", {
        body: { restaurant_id: restaurantId, view: "keyword-detail", query },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ??
            error?.message ??
            "could not load keyword detail",
        );
      }
      const body = data as {
        trend: KeywordTrendPoint[];
        currentBestPage: string | null;
        totalClicks: number;
        totalImpressions: number;
        avgPosition: number | null;
      };
      return body;
    },
  });
}

export type PageSpeedResult = {
  url: string;
  scores: {
    performance: number | null;
    seo: number | null;
    accessibility: number | null;
    bestPractices: number | null;
  };
  coreWebVitals: {
    lcp: string | null;
    cls: string | null;
    inp: string | null;
  };
};

// On-demand only — a real audit takes 30-60+ seconds per URL, not
// something to run automatically across every page in the list.
export function usePageSpeedAudit() {
  return useMutation({
    mutationFn: async (url: string): Promise<PageSpeedResult> => {
      const { data, error } = await supabase.functions.invoke("pagespeed-audit", {
        body: { url },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "audit failed",
        );
      }
      return data as PageSpeedResult;
    },
  });
}

// After a real OAuth redirect back from /search-console-oauth-callback
// (?searchConsole=connected|error), refetch the connection status once
// so the UI reflects it without a manual page reload.
export function useRefetchSearchConsoleConnection() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["search-console-connection", restaurantId] });
  };
}

export type SeoSuggestions = {
  current: { title: string | null; description: string | null; schemaTypes: string[] };
  suggestions: {
    suggestedTitle: string;
    suggestedDescription: string;
    titleReasoning: string;
    descriptionReasoning: string;
    missingSchemaTypes: string[];
    suggestedSchemaJsonLd: string | null;
  };
};

// Real Claude-drafted title/description/schema suggestions for one
// real page — fetches the page's actual live HTML server-side, so
// this genuinely reflects what's really on the site right now. On
// demand only (~15s per call, real API cost), never automatic.
export function useGenerateSeoSuggestions() {
  const restaurantId = useCurrentRestaurantId();
  return useMutation({
    mutationFn: async (input: {
      url: string;
      clicks?: number;
      impressions?: number;
      position?: number;
    }): Promise<SeoSuggestions> => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("seo-ai-suggestions", {
        body: { restaurant_id: restaurantId, ...input },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ??
            error?.message ??
            "could not generate suggestions",
        );
      }
      return data as SeoSuggestions;
    },
  });
}

export type SchemaCheckPage = {
  url: string;
  schemaTypes: string[];
  error: string | null;
};

export type SchemaCheckResult = {
  pages: SchemaCheckPage[];
  summary: {
    typesFoundSitewide: string[];
    recommendedTypesMissingSitewide: string[];
    pagesScanned: number;
    pagesWithNoSchema: number;
  };
};

// Real, non-AI structured-data coverage scan — fetches each real
// page's actual live HTML and reports the JSON-LD @type values
// genuinely found. Fast/free, so it can cover several pages per call;
// drafting a fix for a gap is the AI Agent tab's job, not this one's.
export function useSchemaCheck() {
  const restaurantId = useCurrentRestaurantId();
  return useMutation({
    mutationFn: async (urls: string[]): Promise<SchemaCheckResult> => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("schema-check", {
        body: { restaurant_id: restaurantId, urls },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "scan failed",
        );
      }
      return data as SchemaCheckResult;
    },
  });
}

export type ContentBrief = {
  suggestedUrlSlug: string;
  suggestedTitle: string;
  suggestedH1: string;
  outline: string[];
  reasoning: string;
};

// Real Claude-drafted content brief for one real keyword gap —
// grounded in the actual HTML of whichever real page currently ranks
// best for that query, so it doesn't suggest duplicating it. On
// demand only (~15s per call, real API cost), never automatic.
export function useGenerateContentBrief() {
  const restaurantId = useCurrentRestaurantId();
  return useMutation({
    mutationFn: async (input: {
      keyword: string;
      clicks?: number;
      impressions?: number;
      position?: number;
      currentBestPage?: string;
    }): Promise<ContentBrief> => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("content-brief", {
        body: { restaurant_id: restaurantId, ...input },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ??
            error?.message ??
            "could not generate content brief",
        );
      }
      return (data as { brief: ContentBrief }).brief;
    },
  });
}

export type MonthlyPoint = { month: string; value: number };
export type MetricSeries = { total: number; label: string; series: MonthlyPoint[] };
export type PlatformBreakdownItem = { label: string; count: number; pct: number };
export type SearchTermItem = { term: string; count: number };

export type GbpInsights = {
  timePeriod: string | null;
  interactions: MetricSeries | null;
  profileViews: { total: number; byPlatform: PlatformBreakdownItem[] } | null;
  searchImpressions: { total: number; topSearchTerms: SearchTermItem[] } | null;
  calls: MetricSeries | null;
  bookings: MetricSeries | null;
  directions: MetricSeries | null;
  websiteClicks: MetricSeries | null;
};

// Real Google Business Profile Insights — reuses the same review-agent
// Google session cookies already connected on the Reviews page (no
// separate connect flow). A real Playwright scrape of Google's own
// Performance panel (~15-25s), so this is on-demand only via the
// existing review-agent Edge Function/Railway service, same shared
// infra as the review-reply agent.
export function useGenerateGbpInsights() {
  const restaurantId = useCurrentRestaurantId();
  return useMutation({
    mutationFn: async (): Promise<GbpInsights> => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("review-agent", {
        body: { action: "gbp_insights", restaurant_id: restaurantId },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ??
            error?.message ??
            "could not load Business Profile insights",
        );
      }
      return data as GbpInsights;
    },
  });
}

export type CitationProfile = {
  businessName: string;
  address: string | null;
  phone: string | null;
  website: string | null;
};

// The canonical NAP (name/address/phone) tenants compare each real
// directory listing against. Reuses review_agent_settings — same
// "real business info, not provider-specific" data the review-reply
// prompt already draws from. Null means no row yet (review agent
// never set up for this restaurant), not "fields are empty."
export function useCitationProfile() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["citation-profile", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<CitationProfile | null> => {
      const { data, error } = await supabase
        .from("review_agent_settings")
        .select("business_name, address, phone, website")
        .eq("restaurant_id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        businessName: data.business_name,
        address: data.address,
        phone: data.phone,
        website: data.website,
      };
    },
  });
}

export function useUpdateCitationProfile() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { address: string; phone: string; website: string }) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { error } = await supabase
        .from("review_agent_settings")
        .update({ address: input.address, phone: input.phone, website: input.website })
        .eq("restaurant_id", restaurantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["citation-profile", restaurantId] });
    },
  });
}

export type CitationDirectory =
  | "google"
  | "yelp"
  | "apple_maps"
  | "bing"
  | "tripadvisor"
  | "facebook";

export type CitationCheckStatus = "not_checked" | "matches" | "needs_fixing";

export type CitationCheck = {
  directory: CitationDirectory;
  status: CitationCheckStatus;
  note: string | null;
  checkedAt: string | null;
};

// Real, zero-automation citation checklist — no free API checks
// name/address/phone consistency across directories, so this just
// persists what the owner found after manually opening each real
// directory search themselves (see the "Search on X" links in the
// Citations tab).
export function useCitationChecks() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["citation-checks", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<CitationCheck[]> => {
      const { data, error } = await supabase
        .from("citation_checks")
        .select("directory, status, note, checked_at")
        .eq("restaurant_id", restaurantId!);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        directory: r.directory as CitationDirectory,
        status: r.status as CitationCheckStatus,
        note: r.note,
        checkedAt: r.checked_at,
      }));
    },
  });
}

export function useSetCitationCheck() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      directory: CitationDirectory;
      status: CitationCheckStatus;
      note: string | null;
    }) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { error } = await supabase.from("citation_checks").upsert(
        {
          restaurant_id: restaurantId,
          directory: input.directory,
          status: input.status,
          note: input.note,
          checked_at: input.status === "not_checked" ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "restaurant_id,directory" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["citation-checks", restaurantId] });
    },
  });
}

export type TrackedQuery = { id: string; query: string; createdAt: string };

// Plain config the tenant manages directly — no Google automation
// involved in tracking/untracking a query, only in scanning it.
export function useTrackedQueries() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["competitor-tracked-queries", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<TrackedQuery[]> => {
      const { data, error } = await supabase
        .from("competitor_tracked_queries")
        .select("id, query, created_at")
        .eq("restaurant_id", restaurantId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id, query: r.query, createdAt: r.created_at }));
    },
  });
}

export function useAddTrackedQuery() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (query: string) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { error } = await supabase
        .from("competitor_tracked_queries")
        .insert({ restaurant_id: restaurantId, query });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitor-tracked-queries", restaurantId] });
    },
  });
}

export function useDeleteTrackedQuery() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("competitor_tracked_queries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitor-tracked-queries", restaurantId] });
      queryClient.invalidateQueries({ queryKey: ["competitor-scans", restaurantId] });
    },
  });
}

export type LocalPackEntry = {
  position: number;
  name: string;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  address: string | null;
  isOwn: boolean;
};

export type OrganicResult = {
  position: number;
  title: string;
  url: string;
  domain: string;
  isOwn: boolean;
};

export type CompetitorScan = {
  id: string;
  trackedQueryId: string | null;
  query: string;
  scannedAt: string;
  localPack: LocalPackEntry[];
  ownInPack: boolean;
  ownPosition: number | null;
  organicResults: OrganicResult[];
};

// Real scan history — one row per real scan (append-only, like
// reviews), so a trend across repeated scans is possible. Fetches
// recent scans and reduces to the latest per tracked query
// client-side rather than a DISTINCT ON query.
export function useCompetitorScans() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["competitor-scans", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<CompetitorScan[]> => {
      const { data, error } = await supabase
        .from("competitor_scans")
        .select(
          "id, tracked_query_id, query, scanned_at, local_pack, own_in_pack, own_position, organic_results",
        )
        .eq("restaurant_id", restaurantId!)
        .order("scanned_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        trackedQueryId: r.tracked_query_id,
        query: r.query,
        scannedAt: r.scanned_at,
        localPack: r.local_pack as LocalPackEntry[],
        ownInPack: r.own_in_pack,
        ownPosition: r.own_position,
        organicResults: (r.organic_results as OrganicResult[] | null) ?? [],
      }));
    },
  });
}

// Real local-pack + organic scan for one tracked query — same Google
// session already connected for the review-reply agent and GBP
// Insights, no new credential flow. Takes a few seconds per scan.
export function useRunCompetitorScan() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      trackedQueryId: string,
    ): Promise<{
      localPack: LocalPackEntry[];
      ownInPack: boolean;
      ownPosition: number | null;
      organicResults: OrganicResult[];
    }> => {
      const { data, error } = await supabase.functions.invoke("review-agent", {
        body: { action: "competitor_scan", tracked_query_id: trackedQueryId },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "scan failed",
        );
      }
      return data as {
        localPack: LocalPackEntry[];
        ownInPack: boolean;
        ownPosition: number | null;
        organicResults: OrganicResult[];
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitor-scans", restaurantId] });
    },
  });
}

export type ReviewComparisonTheme = { theme: string; count: number };

export type CompetitorReviewComparison = {
  competitorName: string;
  competitorRating: number | null;
  competitorReviewCount: number | null;
  ourStrengths: ReviewComparisonTheme[];
  competitorStrengths: ReviewComparisonTheme[];
  opportunities: string[];
  sampleSize: { ours: number; competitor: number };
  scannedAt: string;
};

// Persisted comparisons (one per competitor, overwritten on re-scan) —
// lets an already-generated comparison show up without re-scraping.
export function useCompetitorReviewComparisons() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["competitor-review-comparisons", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<CompetitorReviewComparison[]> => {
      const { data, error } = await supabase
        .from("competitor_review_comparisons")
        .select(
          "competitor_name, competitor_rating, competitor_review_count, our_strengths, competitor_strengths, opportunities, sample_size, scanned_at",
        )
        .eq("restaurant_id", restaurantId!)
        .order("scanned_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        competitorName: r.competitor_name,
        competitorRating: r.competitor_rating,
        competitorReviewCount: r.competitor_review_count,
        ourStrengths: r.our_strengths as ReviewComparisonTheme[],
        competitorStrengths: r.competitor_strengths as ReviewComparisonTheme[],
        opportunities: r.opportunities as string[],
        sampleSize: r.sample_size as { ours: number; competitor: number },
        scannedAt: r.scanned_at,
      }));
    },
  });
}

// Chains the two real backend steps: scrape a competitor's real
// Google reviews, then have Claude compare them against the tenant's
// own real reviews. Two separate Edge Functions (see
// review-agent/index.ts and analyze-competitor-comparison/index.ts)
// because the comparison step needs the tenant's own `reviews` table,
// which only the Supabase-side function can cleanly read.
export function useGenerateCompetitorReviewComparison() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      competitorName: string,
    ): Promise<
      | CompetitorReviewComparison
      | { insufficientData: true; sampleSize: { ours: number; competitor: number } }
    > => {
      if (!restaurantId) throw new Error("no current restaurant");

      const { data: scanData, error: scanError } = await supabase.functions.invoke("review-agent", {
        body: {
          action: "competitor_reviews",
          restaurant_id: restaurantId,
          competitor_name: competitorName,
        },
      });
      const scan = scanData as {
        ok?: boolean;
        rating?: number | null;
        reviewCount?: number | null;
        reviews?: { stars: number; text: string }[];
        error?: string;
      } | null;
      if (scanError || !scan?.ok) {
        throw new Error(scan?.error ?? scanError?.message ?? "review scan failed");
      }

      const { data: compareData, error: compareError } = await supabase.functions.invoke(
        "analyze-competitor-comparison",
        {
          body: {
            restaurant_id: restaurantId,
            competitor_name: competitorName,
            competitor_rating: scan.rating,
            competitor_review_count: scan.reviewCount,
            competitor_reviews: scan.reviews,
          },
        },
      );
      const compare = compareData as {
        ok?: boolean;
        insufficientData?: boolean;
        ourStrengths?: ReviewComparisonTheme[];
        competitorStrengths?: ReviewComparisonTheme[];
        opportunities?: string[];
        sampleSize?: { ours: number; competitor: number };
        error?: string;
      } | null;
      if (compareError || !compare?.ok) {
        throw new Error(compare?.error ?? compareError?.message ?? "comparison failed");
      }
      if (compare.insufficientData) {
        return { insufficientData: true, sampleSize: compare.sampleSize! };
      }
      return {
        competitorName,
        competitorRating: scan.rating ?? null,
        competitorReviewCount: scan.reviewCount ?? null,
        ourStrengths: compare.ourStrengths ?? [],
        competitorStrengths: compare.competitorStrengths ?? [],
        opportunities: compare.opportunities ?? [],
        sampleSize: compare.sampleSize ?? { ours: 0, competitor: 0 },
        scannedAt: new Date().toISOString(),
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitor-review-comparisons", restaurantId] });
    },
  });
}

export type LinkCountItem = { label: string; count: number };

export type BacklinksReport = {
  externalLinksTotal: number | null;
  topLinkedPages: LinkCountItem[];
  topLinkingSites: LinkCountItem[];
  topLinkingText: string[];
  internalLinksTotal: number | null;
  topInternalLinkedPages: LinkCountItem[];
};

// Real backlink snapshot from Google Search Console's own "Links"
// report — not exposed by the official Search Console API, scraped
// from the real Search Console web UI with the same Google session
// already connected for the review-reply agent. No domain authority
// or spam score (that needs a paid tool's own crawl index) — only
// what Google's own index reports about the real site.
export function useGenerateBacklinks() {
  const restaurantId = useCurrentRestaurantId();
  return useMutation({
    mutationFn: async (): Promise<BacklinksReport> => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("review-agent", {
        body: { action: "backlinks", restaurant_id: restaurantId },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "scan failed",
        );
      }
      return data as BacklinksReport;
    },
  });
}
