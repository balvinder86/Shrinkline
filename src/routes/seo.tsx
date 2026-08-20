import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  useSearchConsoleConnection,
  useConnectSearchConsole,
  useSearchConsoleOverview,
  useSearchConsoleKeywords,
  useSearchConsolePages,
  usePageSpeedAudit,
  useRefetchSearchConsoleConnection,
  useGenerateSeoSuggestions,
  useSchemaCheck,
  useSearchConsoleContentGaps,
  useGenerateContentBrief,
  useGenerateGbpInsights,
  useCitationProfile,
  useUpdateCitationProfile,
  useCitationChecks,
  useSetCitationCheck,
  useTrackedQueries,
  useAddTrackedQuery,
  useDeleteTrackedQuery,
  useCompetitorScans,
  useRunCompetitorScan,
  useGenerateBacklinks,
  useSearchConsoleKeywordDetail,
  useCompetitorReviewComparisons,
  useGenerateCompetitorReviewComparison,
  type PageSpeedResult,
  type SeoSuggestions,
  type SchemaCheckResult,
  type ContentBrief,
  type GbpInsights,
  type MetricSeries,
  type CitationDirectory,
  type CitationCheckStatus,
  type CompetitorScan,
  type BacklinksReport,
  type CompetitorReviewComparison,
} from "@/lib/seo/queries";
import { useReviewAgentConnection } from "@/lib/reviews/queries";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Gauge,
  Globe,
  Lightbulb,
  Link2,
  MapPin,
  MousePointerClick,
  PenSquare,
  Phone,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wand2,
  XCircle,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Topbar } from "@/components/dashboard/Topbar";
import { useDateRange } from "@/lib/date-range-context";
import { isoDate, formatDateRange } from "@/lib/date-range";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/seo")({
  head: () => ({
    meta: [
      { title: "SEO · Shrinkline" },
      {
        name: "description",
        content:
          "Local search rankings, Google Business health, keyword visibility and an AI SEO agent for restaurants.",
      },
    ],
  }),
  component: SeoPage,
});

// ---------- mock data ----------

const visibilitySeries = [
  { d: "Wk 1", visibility: 38, clicks: 410 },
  { d: "Wk 2", visibility: 42, clicks: 462 },
  { d: "Wk 3", visibility: 47, clicks: 540 },
  { d: "Wk 4", visibility: 51, clicks: 612 },
  { d: "Wk 5", visibility: 55, clicks: 668 },
  { d: "Wk 6", visibility: 58, clicks: 712 },
  { d: "Wk 7", visibility: 61, clicks: 790 },
  { d: "Wk 8", visibility: 64, clicks: 845 },
];

type Keyword = {
  id: string;
  term: string;
  intent: "Local" | "Brand" | "Dish" | "Event";
  rank: number;
  prev: number;
  volume: number;
  difficulty: number;
  url: string;
  opportunity: "Quick win" | "Watch" | "Stretch";
};

const keywords: Keyword[] = [
  {
    id: "k1",
    term: "italian restaurant near me",
    intent: "Local",
    rank: 4,
    prev: 7,
    volume: 4400,
    difficulty: 58,
    url: "/",
    opportunity: "Quick win",
  },
  {
    id: "k2",
    term: "best pasta hayes valley",
    intent: "Local",
    rank: 2,
    prev: 3,
    volume: 880,
    difficulty: 32,
    url: "/menu",
    opportunity: "Watch",
  },
  {
    id: "k3",
    term: "thrasher's pub",
    intent: "Brand",
    rank: 1,
    prev: 1,
    volume: 1300,
    difficulty: 8,
    url: "/",
    opportunity: "Watch",
  },
  {
    id: "k4",
    term: "truffle tagliatelle sf",
    intent: "Dish",
    rank: 6,
    prev: 11,
    volume: 320,
    difficulty: 24,
    url: "/menu/tagliatelle",
    opportunity: "Quick win",
  },
  {
    id: "k5",
    term: "private dining san francisco",
    intent: "Event",
    rank: 14,
    prev: 18,
    volume: 2100,
    difficulty: 64,
    url: "/events",
    opportunity: "Stretch",
  },
  {
    id: "k6",
    term: "wine bar near opera house",
    intent: "Local",
    rank: 9,
    prev: 13,
    volume: 590,
    difficulty: 38,
    url: "/wine",
    opportunity: "Quick win",
  },
  {
    id: "k7",
    term: "sunday brunch hayes valley",
    intent: "Event",
    rank: 5,
    prev: 8,
    volume: 720,
    difficulty: 41,
    url: "/brunch",
    opportunity: "Quick win",
  },
];

type Page = {
  id: string;
  path: string;
  title: string;
  score: number;
  issues: string[];
  status: "Healthy" | "Needs work" | "Critical";
};

const pages: Page[] = [
  {
    id: "p1",
    path: "/",
    title: "Thrasher's Pub — Modern Italian in Hayes Valley",
    score: 86,
    issues: ["Add FAQ schema"],
    status: "Healthy",
  },
  {
    id: "p2",
    path: "/menu",
    title: "Seasonal Tasting Menu | Thrasher's Pub",
    score: 72,
    issues: ["Meta description >160ch", "2 images missing alt"],
    status: "Needs work",
  },
  {
    id: "p3",
    path: "/menu/tagliatelle",
    title: "Truffle Tagliatelle",
    score: 64,
    issues: ["No H1", "Thin content (180 words)", "Missing Product schema"],
    status: "Needs work",
  },
  {
    id: "p4",
    path: "/events",
    title: "Private Events & Buyouts",
    score: 41,
    issues: ["Page slow (LCP 4.8s)", "Duplicate title", "No internal links in"],
    status: "Critical",
  },
  {
    id: "p5",
    path: "/reservations",
    title: "Reservations",
    score: 91,
    issues: [],
    status: "Healthy",
  },
];

// Real, zero-automation directory list for the Citations tab — no
// free API checks name/address/phone consistency across these, so
// each one links to that platform's own real search so the owner can
// check it themselves and record what they found.
const CITATION_DIRECTORIES: {
  id: CitationDirectory;
  label: string;
  searchUrl: (query: string) => string;
}[] = [
  {
    id: "google",
    label: "Google",
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "yelp",
    label: "Yelp",
    searchUrl: (q) => `https://www.yelp.com/search?find_desc=${encodeURIComponent(q)}`,
  },
  {
    id: "apple_maps",
    label: "Apple Maps",
    searchUrl: (q) => `https://maps.apple.com/?q=${encodeURIComponent(q)}`,
  },
  {
    id: "bing",
    label: "Bing",
    searchUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "tripadvisor",
    label: "Tripadvisor",
    searchUrl: (q) => `https://www.tripadvisor.com/Search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "facebook",
    label: "Facebook",
    searchUrl: (q) => `https://www.facebook.com/search/pages/?q=${encodeURIComponent(q)}`,
  },
];

// ---------- helpers ----------

function Kpi({
  label,
  value,
  delta,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta?: { value: string; up: boolean };
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className={`p-5 ${!delta ? "border-dashed" : ""}`}>
      <div className="flex items-start justify-between">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            delta ? "bg-accent/40" : "bg-muted"
          }`}
        >
          <Icon className={`h-5 w-5 ${delta ? "text-foreground/70" : "text-muted-foreground"}`} />
        </div>
        {delta && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              delta.up ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
            }`}
          >
            {delta.up ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {delta.value}
          </span>
        )}
      </div>
      <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-display text-3xl ${!delta ? "text-muted-foreground" : ""}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </Card>
  );
}

function rankDelta(rank: number, prev: number) {
  const diff = prev - rank; // positive = improved
  if (diff === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const up = diff > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        up ? "text-emerald-700" : "text-rose-700"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(diff)}
    </span>
  );
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function GbpKpi({
  icon: Icon,
  label,
  metric,
  total,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  metric?: MetricSeries | null;
  total?: number;
}) {
  const value = metric ? metric.total : total;
  return (
    <Card className={`p-5 ${value == null ? "border-dashed" : ""}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={`mt-2 font-display text-2xl ${value == null ? "text-muted-foreground" : ""}`}>
        {value != null ? value.toLocaleString() : "Not available"}
      </div>
    </Card>
  );
}

function GbpMiniTrend({ label, metric }: { label: string; metric?: MetricSeries | null }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-display text-lg">{metric ? metric.total.toLocaleString() : "—"}</span>
      </div>
      {metric && metric.series.length > 0 ? (
        <div className="mt-2 h-24">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={metric.series}>
              <XAxis dataKey="month" hide />
              <YAxis hide domain={[0, "dataMax"]} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--primary)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Not available from this scan.</p>
      )}
    </Card>
  );
}

// ---------- page ----------

function SeoPage() {
  // Real query text for the keyword drawer — null when closed. Not
  // the fake Keyword type; the drawer now fetches real Search Console
  // detail for whatever query string is selected.
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);
  const keywordDetail = useSearchConsoleKeywordDetail(selectedQuery);
  const [drawerBrief, setDrawerBrief] = useState<ContentBrief | null>(null);

  // Same global range as every other page — set once in the Topbar,
  // applies here to every real Search Console report (Overview,
  // Keywords, Pages, Content gaps). The rest of this page (Technical,
  // Schema, GBP Insights, Citations, Backlinks, Competitors, Agent)
  // is on-demand tools/config, not a time-series report, so it's
  // deliberately left out of range scoping.
  const { dateRange } = useDateRange();
  const rangeLabel = useMemo(() => formatDateRange(dateRange), [dateRange]);

  const { data: scConnection, isLoading: scConnectionLoading } = useSearchConsoleConnection();
  const connectSearchConsole = useConnectSearchConsole();
  const isConnected = !!scConnection;
  const overview = useSearchConsoleOverview(isConnected, dateRange);
  const scKeywords = useSearchConsoleKeywords(isConnected, dateRange);
  const scPages = useSearchConsolePages(isConnected, dateRange);
  const contentGaps = useSearchConsoleContentGaps(isConnected, dateRange);
  const pageSpeedAudit = usePageSpeedAudit();
  const refetchConnection = useRefetchSearchConsoleConnection();
  const generateSeoSuggestions = useGenerateSeoSuggestions();
  const schemaCheck = useSchemaCheck();
  const generateContentBrief = useGenerateContentBrief();
  const { data: reviewAgentConnection, isLoading: reviewAgentConnectionLoading } =
    useReviewAgentConnection();
  const generateGbpInsights = useGenerateGbpInsights();
  const { data: citationProfile, isLoading: citationProfileLoading } = useCitationProfile();
  const updateCitationProfile = useUpdateCitationProfile();
  const { data: citationChecks } = useCitationChecks();
  const setCitationCheck = useSetCitationCheck();
  const { data: trackedQueries } = useTrackedQueries();
  const addTrackedQuery = useAddTrackedQuery();
  const deleteTrackedQuery = useDeleteTrackedQuery();
  const { data: competitorScans } = useCompetitorScans();
  const runCompetitorScan = useRunCompetitorScan();
  const generateBacklinks = useGenerateBacklinks();
  const { data: reviewComparisons } = useCompetitorReviewComparisons();
  const generateReviewComparison = useGenerateCompetitorReviewComparison();

  const [callbackBanner, setCallbackBanner] = useState<{
    status: "connected" | "error";
    message?: string;
  } | null>(null);
  const [auditedUrl, setAuditedUrl] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<PageSpeedResult | null>(null);
  const [suggestingUrl, setSuggestingUrl] = useState<string | null>(null);
  const [suggestionsByUrl, setSuggestionsByUrl] = useState<Record<string, SeoSuggestions>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [schemaCheckResult, setSchemaCheckResult] = useState<SchemaCheckResult | null>(null);
  const [briefingQuery, setBriefingQuery] = useState<string | null>(null);
  const [briefsByQuery, setBriefsByQuery] = useState<Record<string, ContentBrief>>({});
  const [gbpInsights, setGbpInsights] = useState<GbpInsights | null>(null);
  const [profileForm, setProfileForm] = useState({ address: "", phone: "", website: "" });
  const [profileFormDirty, setProfileFormDirty] = useState(false);
  const [citationNotes, setCitationNotes] = useState<Record<string, string>>({});
  const [newQueryText, setNewQueryText] = useState("");
  const [scanningQueryId, setScanningQueryId] = useState<string | null>(null);
  const [backlinksReport, setBacklinksReport] = useState<BacklinksReport | null>(null);
  const [comparingCompetitor, setComparingCompetitor] = useState<string | null>(null);
  const [freshComparison, setFreshComparison] = useState<
    | CompetitorReviewComparison
    | { insufficientData: true; sampleSize: { ours: number; competitor: number } }
    | null
  >(null);

  useEffect(() => {
    setFreshComparison(null);
    generateReviewComparison.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparingCompetitor]);

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField((f) => (f === fieldId ? null : f)), 1500);
    });
  };

  const latestScanByQueryId = useMemo(() => {
    const map = new Map<string, CompetitorScan>();
    for (const scan of competitorScans ?? []) {
      if (scan.trackedQueryId && !map.has(scan.trackedQueryId)) {
        map.set(scan.trackedQueryId, scan);
      }
    }
    return map;
  }, [competitorScans]);

  const reviewComparisonByName = useMemo(() => {
    const map = new Map<string, CompetitorReviewComparison>();
    for (const c of reviewComparisons ?? []) map.set(c.competitorName, c);
    return map;
  }, [reviewComparisons]);

  // Real values for the top KPI row — each backed by a real feature
  // built later this session, replacing what were originally honest
  // "not built" placeholders.
  const latestCompetitorScan = competitorScans?.[0] ?? null;

  const avgSearchPosition = useMemo(() => {
    const rows = overview.data?.rows;
    if (!rows || rows.length === 0) return null;
    return rows.reduce((sum, r) => sum + r.position, 0) / rows.length;
  }, [overview.data]);

  const gbpActionsTotal = useMemo(() => {
    if (
      !gbpInsights ||
      (!gbpInsights.calls && !gbpInsights.directions && !gbpInsights.websiteClicks)
    ) {
      return null;
    }
    return (
      (gbpInsights.calls?.total ?? 0) +
      (gbpInsights.directions?.total ?? 0) +
      (gbpInsights.websiteClicks?.total ?? 0)
    );
  }, [gbpInsights]);

  const aiTasksShippedCount =
    Object.keys(suggestionsByUrl).length + Object.keys(briefsByQuery).length;

  useEffect(() => {
    setDrawerBrief(null);
    generateContentBrief.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuery]);

  useEffect(() => {
    if (citationProfile && !profileFormDirty) {
      setProfileForm({
        address: citationProfile.address ?? "",
        phone: citationProfile.phone ?? "",
        website: citationProfile.website ?? "",
      });
    }
  }, [citationProfile, profileFormDirty]);

  // The OAuth callback (search-console-oauth-callback) redirects back
  // here with ?searchConsole=connected|error — a full page load, not a
  // client-side navigation, so this only needs to run once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("searchConsole");
    if (status === "connected" || status === "error") {
      setCallbackBanner({ status, message: params.get("message") ?? undefined });
      refetchConnection();
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Topbar eyebrow="Discovery" title="SEO & local search" />

      <div className="space-y-6 px-6 py-6">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {scConnectionLoading ? (
              "Checking Search Console connection…"
            ) : isConnected ? (
              <>
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                Search Console connected as {scConnection.connectedEmail}
                {scConnection.lastSyncedAt && <> · Synced {timeAgo(scConnection.lastSyncedAt)}</>}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2 gap-2"
                  onClick={() => {
                    overview.refetch();
                    scKeywords.refetch();
                    scPages.refetch();
                  }}
                  disabled={overview.isFetching || scKeywords.isFetching || scPages.isFetching}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      overview.isFetching || scKeywords.isFetching || scPages.isFetching
                        ? "animate-spin"
                        : ""
                    }`}
                  />
                  Refresh
                </Button>
                {/* Refresh above only re-runs the same queries — if the
                    stored Google token itself has expired or been
                    revoked, every one of those calls fails the same way
                    forever. This re-runs the full OAuth flow to replace
                    the stored token, the only way to actually recover. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => connectSearchConsole.mutate()}
                  disabled={connectSearchConsole.isPending}
                >
                  <Link2 className="h-3.5 w-3.5" /> Reconnect
                </Button>
              </>
            ) : (
              <>
                <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                Search Console not connected — visibility, keywords, and pages below are examples,
                not real data
                <Button
                  size="sm"
                  className="ml-2 gap-2"
                  onClick={() => connectSearchConsole.mutate()}
                  disabled={connectSearchConsole.isPending}
                >
                  <Link2 className="h-3.5 w-3.5" /> Connect Search Console
                </Button>
              </>
            )}
          </div>
        </div>

        {callbackBanner && (
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-sm ${
              callbackBanner.status === "connected"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-destructive/30 bg-destructive/5 text-destructive"
            }`}
          >
            <span>
              {callbackBanner.status === "connected"
                ? "Search Console connected."
                : `Couldn't connect Search Console${callbackBanner.message ? `: ${callbackBanner.message}` : "."}`}
            </span>
            <button className="text-xs underline" onClick={() => setCallbackBanner(null)}>
              Dismiss
            </button>
          </div>
        )}
        {connectSearchConsole.isError && (
          <p className="text-xs text-destructive">
            {(connectSearchConsole.error as Error).message}
          </p>
        )}

        {/* KPI row */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Local pack rank"
            value={
              !latestCompetitorScan
                ? "—"
                : latestCompetitorScan.ownInPack
                  ? `#${latestCompetitorScan.ownPosition}`
                  : "Not in pack"
            }
            hint={
              latestCompetitorScan
                ? `Real, for "${latestCompetitorScan.query}" · Competitors tab`
                : "Track a real search on the Competitors tab"
            }
            icon={MapPin}
          />
          <Kpi
            label="Search visibility"
            value={avgSearchPosition != null ? `Avg. #${avgSearchPosition.toFixed(1)}` : "—"}
            hint={
              avgSearchPosition != null
                ? `Real avg. position, ${rangeLabel} (Search Console)`
                : "Connect Search Console on the Pages tab"
            }
            icon={Eye}
          />
          <Kpi
            label="GBP actions"
            value={gbpActionsTotal != null ? gbpActionsTotal.toLocaleString() : "—"}
            hint={
              gbpActionsTotal != null
                ? "Real calls + directions + website clicks, last scan"
                : "Scan on the Google Business tab"
            }
            icon={MousePointerClick}
          />
          <Kpi
            label="AI tasks shipped"
            value={aiTasksShippedCount > 0 ? String(aiTasksShippedCount) : "—"}
            hint={
              aiTasksShippedCount > 0
                ? "Real suggestions + content briefs generated this session"
                : "Generate suggestions on the AI Agent tab"
            }
            icon={Sparkles}
          />
        </div>

        {/* Hero chart + agent strip */}
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <Card className="p-6">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {isConnected ? "Real clicks — Google Search Console" : "Visibility & clicks"}
                </div>
                <h2 className="mt-1 font-display text-2xl">
                  {isConnected ? rangeLabel : "Example data · not connected"}
                </h2>
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary" className="rounded-full">
                  {isConnected ? "Clicks" : "Visibility"}
                </Badge>
                {!isConnected && (
                  <Badge variant="outline" className="rounded-full">
                    Organic clicks
                  </Badge>
                )}
              </div>
            </div>
            <div className="mt-4 h-64">
              {!isConnected ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={visibilitySeries}>
                    <defs>
                      <linearGradient id="vis" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="d" stroke="var(--muted-foreground)" fontSize={12} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="visibility"
                      stroke="var(--primary)"
                      fill="url(#vis)"
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="clicks"
                      stroke="var(--foreground)"
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : overview.isLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Loading real Search Console data…
                </div>
              ) : overview.isError ? (
                <div className="flex h-full items-center justify-center text-sm text-destructive">
                  {(overview.error as Error).message}
                </div>
              ) : !overview.data?.rows.length ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No Search Console data for this period yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={overview.data.rows}>
                    <defs>
                      <linearGradient id="vis" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      tickFormatter={(d) =>
                        new Date(d).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      }
                    />
                    <YAxis stroke="var(--muted-foreground)" fontSize={12} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(d) => new Date(d).toLocaleDateString()}
                      formatter={(value: number, name: string, item) => {
                        if (name === "clicks") {
                          const impressions = (item.payload as { impressions: number }).impressions;
                          return [`${value} clicks · ${impressions} impressions`, "Clicks"];
                        }
                        return [value, name];
                      }}
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="clicks"
                      stroke="var(--primary)"
                      fill="url(#vis)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card className="flex flex-col gap-3 border-dashed bg-card/50 p-6">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              AI SEO agent
            </div>
            <h2 className="font-display text-2xl text-muted-foreground">Not built yet</h2>
            <p className="text-sm text-muted-foreground">
              Would draft meta title/description rewrites, schema markup fixes, and alt text from
              the real keyword and page data above, and hold every change for your review — no
              auto-apply mode. Nothing here is real yet.
            </p>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="keywords">
          <TabsList className="flex h-auto flex-wrap gap-1 bg-card">
            <TabsTrigger value="keywords" className="gap-2">
              <Target className="h-4 w-4" /> Keywords
            </TabsTrigger>
            <TabsTrigger value="pages" className="gap-2">
              <FileText className="h-4 w-4" /> Pages
            </TabsTrigger>
            <TabsTrigger value="technical" className="gap-2">
              <Gauge className="h-4 w-4" /> Technical
            </TabsTrigger>
            <TabsTrigger value="schema" className="gap-2">
              <Code2 className="h-4 w-4" /> Schema
            </TabsTrigger>
            <TabsTrigger value="content" className="gap-2">
              <PenSquare className="h-4 w-4" /> Content
            </TabsTrigger>
            <TabsTrigger value="gbp" className="gap-2">
              <Building2 className="h-4 w-4" /> Google Business
            </TabsTrigger>
            <TabsTrigger value="citations" className="gap-2">
              <Link2 className="h-4 w-4" /> Citations
            </TabsTrigger>
            <TabsTrigger value="backlinks" className="gap-2">
              <Share2 className="h-4 w-4" /> Backlinks
            </TabsTrigger>
            <TabsTrigger value="competitors" className="gap-2">
              <Globe className="h-4 w-4" /> Competitors
            </TabsTrigger>
            <TabsTrigger value="agent" className="gap-2">
              <Bot className="h-4 w-4" /> AI agent
            </TabsTrigger>
          </TabsList>

          {/* KEYWORDS */}
          <TabsContent value="keywords" className="mt-4">
            {!isConnected ? (
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="Search keywords…" className="h-9 w-64 pl-9" disabled />
                    </div>
                    <Badge variant="outline" className="rounded-full">
                      Example data
                    </Badge>
                  </div>
                  <Button size="sm" className="gap-2" onClick={() => connectSearchConsole.mutate()}>
                    <Link2 className="h-4 w-4" /> Connect Search Console
                  </Button>
                </div>
                <div className="grid grid-cols-[1.6fr_0.7fr_0.5fr_0.5fr_0.7fr_0.9fr_0.7fr] gap-3 border-b border-border/70 bg-muted/30 px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <div>Keyword</div>
                  <div>Intent</div>
                  <div>Rank</div>
                  <div>Δ</div>
                  <div>Volume</div>
                  <div>Difficulty</div>
                  <div>Opportunity</div>
                </div>
                <div>
                  {/* Example preview only — connect Search Console for
                      real, clickable rows with a real detail drawer. */}
                  {keywords.map((k) => (
                    <div
                      key={k.id}
                      className="grid w-full grid-cols-[1.6fr_0.7fr_0.5fr_0.5fr_0.7fr_0.9fr_0.7fr] items-center gap-3 border-b border-border/50 px-4 py-3 text-left text-sm last:border-0"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{k.term}</div>
                        <div className="truncate text-xs text-muted-foreground">{k.url}</div>
                      </div>
                      <div>
                        <Badge variant="secondary" className="rounded-full text-[11px]">
                          {k.intent}
                        </Badge>
                      </div>
                      <div className="font-display text-lg">#{k.rank}</div>
                      <div>{rankDelta(k.rank, k.prev)}</div>
                      <div className="tabular-nums">{k.volume.toLocaleString()}</div>
                      <div className="flex items-center gap-2">
                        <Progress value={k.difficulty} className="h-1.5 w-20" />
                        <span className="text-xs text-muted-foreground">{k.difficulty}</span>
                      </div>
                      <div>
                        <Badge
                          className={`rounded-full ${
                            k.opportunity === "Quick win"
                              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                              : k.opportunity === "Watch"
                                ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                                : "bg-muted text-foreground/70 hover:bg-muted"
                          }`}
                        >
                          {k.opportunity}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-4">
                  <div className="text-sm text-muted-foreground">
                    Real search queries from Google Search Console · {rangeLabel}, top{" "}
                    {scKeywords.data?.rows.length ?? 0} by clicks
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => scKeywords.refetch()}
                    disabled={scKeywords.isFetching}
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${scKeywords.isFetching ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </Button>
                </div>
                <div className="grid grid-cols-[2fr_0.8fr_0.8fr_0.7fr_0.7fr] gap-3 border-b border-border/70 bg-muted/30 px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <div>Search query</div>
                  <div>Clicks</div>
                  <div>Impressions</div>
                  <div>CTR</div>
                  <div>Avg. position</div>
                </div>
                {scKeywords.isLoading ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    Loading real keyword data…
                  </div>
                ) : scKeywords.isError ? (
                  <div className="p-6 text-center text-sm text-destructive">
                    {(scKeywords.error as Error).message}
                  </div>
                ) : !scKeywords.data?.rows.length ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No search queries found for this period yet.
                  </div>
                ) : (
                  <div>
                    {scKeywords.data.rows.map((k) => (
                      <button
                        key={k.query}
                        onClick={() => setSelectedQuery(k.query)}
                        className="grid w-full grid-cols-[2fr_0.8fr_0.8fr_0.7fr_0.7fr] items-center gap-3 border-b border-border/50 px-4 py-3 text-left text-sm transition hover:bg-accent/30 last:border-0"
                      >
                        <div className="truncate font-medium">{k.query}</div>
                        <div className="tabular-nums">{k.clicks.toLocaleString()}</div>
                        <div className="tabular-nums">{k.impressions.toLocaleString()}</div>
                        <div className="tabular-nums">{(k.ctr * 100).toFixed(1)}%</div>
                        <div className="tabular-nums">{k.position.toFixed(1)}</div>
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </TabsContent>

          {/* PAGES */}
          <TabsContent value="pages" className="mt-4">
            {!isConnected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="rounded-full">
                    Example data
                  </Badge>
                  <Button size="sm" className="gap-2" onClick={() => connectSearchConsole.mutate()}>
                    <Link2 className="h-4 w-4" /> Connect Search Console
                  </Button>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {pages.map((p) => (
                    <Card key={p.id} className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Globe className="h-3.5 w-3.5" /> {p.path}
                          </div>
                          <h3 className="mt-1 truncate font-display text-lg">{p.title}</h3>
                        </div>
                        <div className="text-right">
                          <div className="font-display text-3xl">{p.score}</div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            Score
                          </div>
                        </div>
                      </div>
                      <Progress value={p.score} className="mt-3 h-1.5" />
                      <div className="mt-4 space-y-2">
                        {p.issues.length === 0 ? (
                          <div className="flex items-center gap-2 text-sm text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" /> No outstanding issues
                          </div>
                        ) : (
                          p.issues.map((issue) => (
                            <div
                              key={issue}
                              className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm"
                            >
                              <span>{issue}</span>
                              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                                <Wand2 className="h-3 w-3" /> Fix with AI
                              </Button>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="mt-4 flex items-center justify-between">
                        <Badge
                          variant="outline"
                          className={`rounded-full ${
                            p.status === "Healthy"
                              ? "border-emerald-200 text-emerald-700"
                              : p.status === "Needs work"
                                ? "border-amber-200 text-amber-700"
                                : "border-rose-200 text-rose-700"
                          }`}
                        >
                          {p.status}
                        </Badge>
                        <Button variant="ghost" size="sm" className="gap-1 text-xs">
                          Open page <ExternalLink className="h-3 w-3" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Real pages from Google Search Console · {rangeLabel}, top{" "}
                    {scPages.data?.rows.length ?? 0} by clicks. Click "Audit" for a real PageSpeed
                    technical check on any page (takes up to a minute — it's a real Lighthouse run,
                    not a lookup).
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => scPages.refetch()}
                    disabled={scPages.isFetching}
                  >
                    <RefreshCw className={`h-4 w-4 ${scPages.isFetching ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
                {scPages.isLoading ? (
                  <p className="text-center text-sm text-muted-foreground">
                    Loading real page data…
                  </p>
                ) : scPages.isError ? (
                  <p className="text-center text-sm text-destructive">
                    {(scPages.error as Error).message}
                  </p>
                ) : !scPages.data?.rows.length ? (
                  <p className="text-center text-sm text-muted-foreground">
                    No pages found for this period yet.
                  </p>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {scPages.data.rows.map((p) => {
                      const isThisRowAuditing = pageSpeedAudit.isPending && auditedUrl === p.page;
                      const hasResult = auditResult && auditedUrl === p.page;
                      return (
                        <Card key={p.page} className="p-5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Globe className="h-3.5 w-3.5" />
                                <span className="truncate">{p.page}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>{p.clicks.toLocaleString()} clicks</span>
                                <span>{p.impressions.toLocaleString()} impressions</span>
                                <span>{(p.ctr * 100).toFixed(1)}% CTR</span>
                                <span>Avg. position {p.position.toFixed(1)}</span>
                              </div>
                            </div>
                          </div>

                          {hasResult ? (
                            <div className="mt-4 space-y-3">
                              <div className="grid grid-cols-4 gap-2 text-center">
                                {(
                                  [
                                    ["Performance", auditResult.scores.performance],
                                    ["SEO", auditResult.scores.seo],
                                    ["Accessibility", auditResult.scores.accessibility],
                                    ["Best practices", auditResult.scores.bestPractices],
                                  ] as const
                                ).map(([label, score]) => (
                                  <div key={label} className="rounded-lg bg-muted/40 p-2">
                                    <div
                                      className={`font-display text-xl ${
                                        score == null
                                          ? "text-muted-foreground"
                                          : score >= 90
                                            ? "text-emerald-700"
                                            : score >= 50
                                              ? "text-amber-700"
                                              : "text-rose-700"
                                      }`}
                                    >
                                      {score ?? "—"}
                                    </div>
                                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                      {label}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                {auditResult.coreWebVitals.lcp && (
                                  <span>LCP {auditResult.coreWebVitals.lcp}</span>
                                )}
                                {auditResult.coreWebVitals.cls && (
                                  <span>CLS {auditResult.coreWebVitals.cls}</span>
                                )}
                                {auditResult.coreWebVitals.inp && (
                                  <span>INP {auditResult.coreWebVitals.inp}</span>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-4">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                disabled={isThisRowAuditing}
                                onClick={() => {
                                  setAuditedUrl(p.page);
                                  setAuditResult(null);
                                  pageSpeedAudit.mutate(p.page, {
                                    onSuccess: (result) => setAuditResult(result),
                                  });
                                }}
                              >
                                <Gauge
                                  className={`h-3.5 w-3.5 ${isThisRowAuditing ? "animate-spin" : ""}`}
                                />
                                {isThisRowAuditing ? "Auditing…" : "Audit page speed"}
                              </Button>
                              {pageSpeedAudit.isError && auditedUrl === p.page && (
                                <p className="mt-2 text-xs text-destructive">
                                  {(pageSpeedAudit.error as Error).message}
                                </p>
                              )}
                            </div>
                          )}

                          <div className="mt-4 flex items-center justify-between">
                            <a
                              href={p.page}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              Open page <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* GBP */}
          <TabsContent value="gbp" className="mt-4">
            {reviewAgentConnectionLoading ? (
              <p className="text-center text-sm text-muted-foreground">Checking connection…</p>
            ) : !reviewAgentConnection ? (
              <Card className="border-dashed bg-card/50 p-10 text-center">
                <p className="font-display text-lg text-muted-foreground">
                  Connect Google Business Profile first
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Insights reuse the same Google connection as the review-reply agent on the Reviews
                  page — connect there first, then come back here.
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="text-sm text-muted-foreground">
                    Real Google Business Profile performance — profile interactions, views, search
                    impressions, calls, directions, and website clicks, scraped live from Google's
                    own Performance panel. Takes 15-25 seconds per scan; not automatic.
                  </div>
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={generateGbpInsights.isPending}
                    onClick={() =>
                      generateGbpInsights.mutate(undefined, {
                        onSuccess: (data) => setGbpInsights(data),
                      })
                    }
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${generateGbpInsights.isPending ? "animate-spin" : ""}`}
                    />
                    {generateGbpInsights.isPending
                      ? "Scanning Google…"
                      : gbpInsights
                        ? "Rescan"
                        : "Scan Business Profile"}
                  </Button>
                </div>

                {generateGbpInsights.isError && (
                  <p className="text-sm text-destructive">
                    {(generateGbpInsights.error as Error).message}
                  </p>
                )}

                {!gbpInsights ? (
                  <p className="text-center text-sm text-muted-foreground">
                    Click "Scan Business Profile" for real, current numbers from Google.
                  </p>
                ) : (
                  <>
                    {gbpInsights.timePeriod && (
                      <Badge variant="outline" className="rounded-full">
                        {gbpInsights.timePeriod}
                      </Badge>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <GbpKpi
                        icon={Building2}
                        label="Interactions"
                        metric={gbpInsights.interactions}
                      />
                      <GbpKpi
                        icon={Eye}
                        label="Profile views"
                        total={gbpInsights.profileViews?.total}
                      />
                      <GbpKpi
                        icon={Search}
                        label="Search impressions"
                        total={gbpInsights.searchImpressions?.total}
                      />
                      <GbpKpi icon={Phone} label="Calls" metric={gbpInsights.calls} />
                      <GbpKpi icon={MapPin} label="Directions" metric={gbpInsights.directions} />
                      <GbpKpi
                        icon={MousePointerClick}
                        label="Website clicks"
                        metric={gbpInsights.websiteClicks}
                      />
                      <GbpKpi icon={Calendar} label="Bookings" metric={gbpInsights.bookings} />
                    </div>

                    {gbpInsights.interactions && gbpInsights.interactions.series.length > 0 && (
                      <Card className="p-6">
                        <div className="text-sm font-medium">
                          {gbpInsights.interactions.label || "Business Profile interactions"}
                        </div>
                        <div className="mt-4 h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={gbpInsights.interactions.series}>
                              <defs>
                                <linearGradient id="gbpInteractions" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid
                                stroke="var(--border)"
                                strokeDasharray="3 3"
                                vertical={false}
                              />
                              <XAxis
                                dataKey="month"
                                stroke="var(--muted-foreground)"
                                fontSize={11}
                              />
                              <YAxis
                                stroke="var(--muted-foreground)"
                                fontSize={12}
                                allowDecimals={false}
                              />
                              <Tooltip
                                contentStyle={{
                                  background: "var(--card)",
                                  border: "1px solid var(--border)",
                                  borderRadius: 12,
                                  fontSize: 12,
                                }}
                              />
                              <Area
                                type="monotone"
                                dataKey="value"
                                stroke="var(--primary)"
                                fill="url(#gbpInteractions)"
                                strokeWidth={2}
                                isAnimationActive={false}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}

                    <div className="grid gap-4 lg:grid-cols-2">
                      {gbpInsights.profileViews && (
                        <Card className="p-6">
                          <div className="text-sm font-medium">How people found your profile</div>
                          <div className="mt-4 space-y-3">
                            {gbpInsights.profileViews.byPlatform.map((p) => (
                              <div key={p.label}>
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">{p.label}</span>
                                  <span className="font-medium">
                                    {p.count.toLocaleString()} · {p.pct}%
                                  </span>
                                </div>
                                <Progress value={p.pct} className="mt-1 h-1.5" />
                              </div>
                            ))}
                          </div>
                        </Card>
                      )}

                      {gbpInsights.searchImpressions && (
                        <Card className="p-6">
                          <div className="text-sm font-medium">
                            Top real search terms that showed your profile
                          </div>
                          <div className="mt-4 space-y-2">
                            {gbpInsights.searchImpressions.topSearchTerms.map((t, i) => (
                              <div
                                key={t.term}
                                className="flex items-center justify-between text-sm"
                              >
                                <span className="truncate text-muted-foreground">
                                  {i + 1}. {t.term}
                                </span>
                                <span className="shrink-0 font-medium">
                                  {t.count.toLocaleString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        </Card>
                      )}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <GbpMiniTrend label="Calls" metric={gbpInsights.calls} />
                      <GbpMiniTrend label="Directions" metric={gbpInsights.directions} />
                      <GbpMiniTrend label="Website clicks" metric={gbpInsights.websiteClicks} />
                      <GbpMiniTrend label="Bookings" metric={gbpInsights.bookings} />
                    </div>
                  </>
                )}
              </div>
            )}
          </TabsContent>

          {/* CITATIONS */}
          <TabsContent value="citations" className="mt-4">
            {citationProfileLoading ? (
              <p className="text-center text-sm text-muted-foreground">Loading business info…</p>
            ) : !citationProfile ? (
              <Card className="border-dashed bg-card/50 p-10 text-center">
                <p className="font-display text-lg text-muted-foreground">
                  Set up your business profile first
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Citation checks compare each directory against your real name, address, and phone
                  — set up the business profile on the Reviews page first, then come back here.
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                <Card className="p-6">
                  <div className="text-sm font-medium">Your canonical business info</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This is what you're comparing every directory listing against below. No free API
                    checks consistency across directories — you open each one's real search and
                    record what you find.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Business name</Label>
                      <p className="mt-1 text-sm font-medium">{citationProfile.businessName}</p>
                    </div>
                    <div>
                      <Label htmlFor="citation-website" className="text-xs text-muted-foreground">
                        Website
                      </Label>
                      <Input
                        id="citation-website"
                        className="mt-1"
                        placeholder="https://yourrestaurant.com"
                        value={profileForm.website}
                        onChange={(e) => {
                          setProfileFormDirty(true);
                          setProfileForm((f) => ({ ...f, website: e.target.value }));
                        }}
                      />
                    </div>
                    <div>
                      <Label htmlFor="citation-address" className="text-xs text-muted-foreground">
                        Address
                      </Label>
                      <Input
                        id="citation-address"
                        className="mt-1"
                        placeholder="123 Main St, City, ST 00000"
                        value={profileForm.address}
                        onChange={(e) => {
                          setProfileFormDirty(true);
                          setProfileForm((f) => ({ ...f, address: e.target.value }));
                        }}
                      />
                    </div>
                    <div>
                      <Label htmlFor="citation-phone" className="text-xs text-muted-foreground">
                        Phone
                      </Label>
                      <Input
                        id="citation-phone"
                        className="mt-1"
                        placeholder="(555) 555-5555"
                        value={profileForm.phone}
                        onChange={(e) => {
                          setProfileFormDirty(true);
                          setProfileForm((f) => ({ ...f, phone: e.target.value }));
                        }}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <Button
                      size="sm"
                      disabled={!profileFormDirty || updateCitationProfile.isPending}
                      onClick={() =>
                        updateCitationProfile.mutate(profileForm, {
                          onSuccess: () => setProfileFormDirty(false),
                        })
                      }
                    >
                      {updateCitationProfile.isPending ? "Saving…" : "Save"}
                    </Button>
                    {updateCitationProfile.isError && (
                      <span className="text-xs text-destructive">
                        {(updateCitationProfile.error as Error).message}
                      </span>
                    )}
                  </div>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                  {CITATION_DIRECTORIES.map((dir) => {
                    const check = citationChecks?.find((c) => c.directory === dir.id);
                    const status: CitationCheckStatus = check?.status ?? "not_checked";
                    const noteValue = citationNotes[dir.id] ?? check?.note ?? "";
                    const searchQuery = [citationProfile.businessName, citationProfile.address]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <Card key={dir.id} className="p-5">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">{dir.label}</div>
                          <a
                            href={dir.searchUrl(searchQuery)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            Search on {dir.label} <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>

                        <div className="mt-3 flex gap-1.5">
                          {(
                            [
                              ["not_checked", "Not checked"],
                              ["matches", "Matches"],
                              ["needs_fixing", "Needs fixing"],
                            ] as const
                          ).map(([value, label]) => (
                            <Button
                              key={value}
                              size="sm"
                              variant="outline"
                              className={`h-7 rounded-full text-xs ${
                                status === value
                                  ? value === "matches"
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                    : value === "needs_fixing"
                                      ? "border-amber-300 bg-amber-50 text-amber-800"
                                      : "border-foreground/30 bg-muted"
                                  : ""
                              }`}
                              disabled={setCitationCheck.isPending}
                              onClick={() =>
                                setCitationCheck.mutate({
                                  directory: dir.id,
                                  status: value,
                                  note: noteValue || null,
                                })
                              }
                            >
                              {label}
                            </Button>
                          ))}
                        </div>

                        <Textarea
                          className="mt-3 text-xs"
                          rows={2}
                          placeholder="What did you find? (optional)"
                          value={noteValue}
                          onChange={(e) =>
                            setCitationNotes((prev) => ({ ...prev, [dir.id]: e.target.value }))
                          }
                          onBlur={() => {
                            if (noteValue !== (check?.note ?? "")) {
                              setCitationCheck.mutate({
                                directory: dir.id,
                                status,
                                note: noteValue || null,
                              });
                            }
                          }}
                        />

                        {check?.checkedAt && (
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Checked {timeAgo(check.checkedAt)}
                          </p>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
          </TabsContent>

          {/* COMPETITORS */}
          <TabsContent value="competitors" className="mt-4">
            <div className="space-y-4">
              <Card className="p-6">
                <div className="text-sm font-medium">Real local-pack tracking</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  For a real search you pick (e.g. "sports bar bothell wa"), this scans Google's
                  actual local 3-pack — the real businesses, ratings, and review counts Google shows
                  for that search, and whether you're in it. Keyword-level comparison (which
                  keywords a competitor outranks you on) still needs a paid rank-tracking tool like
                  Semrush or Ahrefs — Search Console only reports your own site's data, so that part
                  genuinely can't be built here.
                </p>
                <div className="mt-4 flex gap-2">
                  <Input
                    placeholder="e.g. sports bar bothell wa"
                    value={newQueryText}
                    onChange={(e) => setNewQueryText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newQueryText.trim()) {
                        addTrackedQuery.mutate(newQueryText.trim(), {
                          onSuccess: () => setNewQueryText(""),
                        });
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!newQueryText.trim() || addTrackedQuery.isPending}
                    onClick={() =>
                      addTrackedQuery.mutate(newQueryText.trim(), {
                        onSuccess: () => setNewQueryText(""),
                      })
                    }
                  >
                    Track
                  </Button>
                </div>
                {addTrackedQuery.isError && (
                  <p className="mt-2 text-xs text-destructive">
                    {(addTrackedQuery.error as Error).message}
                  </p>
                )}
              </Card>

              {!trackedQueries?.length ? (
                <p className="text-center text-sm text-muted-foreground">
                  No tracked searches yet — add one above (try a search real customers might use,
                  like "[cuisine] restaurant near [your city]").
                </p>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {trackedQueries.map((tq) => {
                    const scan = latestScanByQueryId.get(tq.id);
                    const isScanning = runCompetitorScan.isPending && scanningQueryId === tq.id;

                    return (
                      <Card key={tq.id} className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <Search className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="truncate">{tq.query}</span>
                            </div>
                            {scan ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {scan.ownInPack
                                  ? `You're #${scan.ownPosition} in the local pack`
                                  : "Not in the local pack for this search"}{" "}
                                · scanned {timeAgo(scan.scannedAt)}
                              </p>
                            ) : (
                              <p className="mt-1 text-xs text-muted-foreground">Not scanned yet</p>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteTrackedQuery.mutate(tq.id)}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3 gap-2"
                          disabled={isScanning}
                          onClick={() => {
                            setScanningQueryId(tq.id);
                            runCompetitorScan.mutate(tq.id);
                          }}
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${isScanning ? "animate-spin" : ""}`}
                          />
                          {isScanning ? "Scanning Google…" : scan ? "Rescan" : "Scan now"}
                        </Button>
                        {runCompetitorScan.isError && scanningQueryId === tq.id && (
                          <p className="mt-2 text-xs text-destructive">
                            {(runCompetitorScan.error as Error).message}
                          </p>
                        )}

                        {scan && scan.localPack.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {scan.localPack.map((entry) => (
                              <div
                                key={entry.position}
                                className={`rounded-lg border p-3 ${
                                  entry.isOwn
                                    ? "border-primary/40 bg-primary/5"
                                    : "border-border bg-muted/20"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                                      {entry.position}
                                    </span>
                                    <span className="truncate text-sm font-medium">
                                      {entry.name}
                                    </span>
                                    {entry.isOwn && (
                                      <Badge variant="outline" className="rounded-full text-[10px]">
                                        You
                                      </Badge>
                                    )}
                                  </div>
                                  {entry.rating != null && (
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      {entry.rating}★ ({entry.reviewCount?.toLocaleString()})
                                    </span>
                                  )}
                                </div>
                                {(entry.category || entry.address) && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {[entry.category, entry.address].filter(Boolean).join(" · ")}
                                  </p>
                                )}
                                {!entry.isOwn && (
                                  <div className="mt-2 flex items-center justify-between gap-2">
                                    {reviewComparisonByName.get(entry.name) ? (
                                      <p className="text-[11px] text-muted-foreground">
                                        Compared{" "}
                                        {timeAgo(reviewComparisonByName.get(entry.name)!.scannedAt)}
                                      </p>
                                    ) : (
                                      <span />
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 gap-1.5 px-2 text-[11px]"
                                      onClick={() => setComparingCompetitor(entry.name)}
                                    >
                                      <Sparkles className="h-3 w-3" />
                                      {reviewComparisonByName.get(entry.name)
                                        ? "View comparison"
                                        : "Compare reviews"}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {scan && scan.organicResults.length > 0 && (
                          <div className="mt-4">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                              <Search className="h-3 w-3" /> Organic results
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {scan.organicResults.map((entry) => (
                                <div
                                  key={entry.position}
                                  className={`flex items-center gap-2 rounded-md border p-2 text-xs ${
                                    entry.isOwn
                                      ? "border-primary/40 bg-primary/5"
                                      : "border-border bg-muted/20"
                                  }`}
                                >
                                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-medium">
                                    {entry.position}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                                  <span className="shrink-0 text-muted-foreground">
                                    {entry.domain}
                                  </span>
                                  {entry.isOwn && (
                                    <Badge
                                      variant="outline"
                                      className="shrink-0 rounded-full text-[9px]"
                                    >
                                      You
                                    </Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          {/* AGENT */}
          <TabsContent value="agent" className="mt-4">
            {!isConnected ? (
              <Card className="border-dashed bg-card/50 p-10 text-center">
                <p className="font-display text-lg text-muted-foreground">
                  Connect Search Console first
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  The AI agent drafts suggestions for your real pages, ranked by real Search Console
                  performance — connect on the Pages tab to pick which pages to improve.
                </p>
                <Button
                  size="sm"
                  className="mx-auto mt-4 gap-2"
                  onClick={() => connectSearchConsole.mutate()}
                >
                  <Link2 className="h-4 w-4" /> Connect Search Console
                </Button>
              </Card>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="text-sm text-muted-foreground">
                    Claude drafts a real meta title, description, and structured data for one real
                    page at a time — it fetches the page's actual live HTML, so this reflects what's
                    really on the site right now. Nothing is applied automatically; copy what you
                    want into your own site's SEO settings. Each run takes ~15 seconds and calls a
                    real AI model.
                  </div>
                </div>
                {scPages.isLoading ? (
                  <p className="text-center text-sm text-muted-foreground">
                    Loading real page data…
                  </p>
                ) : scPages.isError ? (
                  <p className="text-center text-sm text-destructive">
                    {(scPages.error as Error).message}
                  </p>
                ) : !scPages.data?.rows.length ? (
                  <p className="text-center text-sm text-muted-foreground">
                    No pages found for this period yet.
                  </p>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {scPages.data.rows.map((p) => {
                      const isThisRowGenerating =
                        generateSeoSuggestions.isPending && suggestingUrl === p.page;
                      const result = suggestionsByUrl[p.page];
                      const genError =
                        generateSeoSuggestions.isError && suggestingUrl === p.page
                          ? (generateSeoSuggestions.error as Error).message
                          : null;

                      return (
                        <Card key={p.page} className="p-5">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Globe className="h-3.5 w-3.5" />
                              <span className="truncate">{p.page}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>{p.clicks.toLocaleString()} clicks</span>
                              <span>{p.impressions.toLocaleString()} impressions</span>
                              <span>Avg. position {p.position.toFixed(1)}</span>
                            </div>
                          </div>

                          {!result ? (
                            <div className="mt-4">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                disabled={isThisRowGenerating}
                                onClick={() => {
                                  setSuggestingUrl(p.page);
                                  generateSeoSuggestions.mutate(
                                    {
                                      url: p.page,
                                      clicks: p.clicks,
                                      impressions: p.impressions,
                                      position: p.position,
                                    },
                                    {
                                      onSuccess: (data) =>
                                        setSuggestionsByUrl((prev) => ({
                                          ...prev,
                                          [p.page]: data,
                                        })),
                                    },
                                  );
                                }}
                              >
                                <Sparkles
                                  className={`h-3.5 w-3.5 ${isThisRowGenerating ? "animate-pulse" : ""}`}
                                />
                                {isThisRowGenerating
                                  ? "Drafting with AI…"
                                  : "Generate AI suggestions"}
                              </Button>
                              {genError && (
                                <p className="mt-2 text-xs text-destructive">{genError}</p>
                              )}
                            </div>
                          ) : (
                            <div className="mt-4 space-y-4">
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                                    Current title
                                  </span>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {result.current.title || "(none found)"}
                                </p>
                                <div className="flex items-start justify-between gap-2 rounded-lg bg-muted/40 p-2.5">
                                  <p className="text-sm">{result.suggestions.suggestedTitle}</p>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 shrink-0"
                                    onClick={() =>
                                      copyToClipboard(
                                        result.suggestions.suggestedTitle,
                                        `${p.page}-title`,
                                      )
                                    }
                                  >
                                    {copiedField === `${p.page}-title` ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {result.suggestions.titleReasoning}
                                </p>
                              </div>

                              <div className="space-y-1.5">
                                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                                  Current description
                                </span>
                                <p className="text-sm text-muted-foreground">
                                  {result.current.description || "(none found)"}
                                </p>
                                <div className="flex items-start justify-between gap-2 rounded-lg bg-muted/40 p-2.5">
                                  <p className="text-sm">
                                    {result.suggestions.suggestedDescription}
                                  </p>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 shrink-0"
                                    onClick={() =>
                                      copyToClipboard(
                                        result.suggestions.suggestedDescription,
                                        `${p.page}-desc`,
                                      )
                                    }
                                  >
                                    {copiedField === `${p.page}-desc` ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {result.suggestions.descriptionReasoning}
                                </p>
                              </div>

                              <div className="space-y-1.5">
                                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                                  Structured data
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                  {result.current.schemaTypes.map((t) => (
                                    <Badge
                                      key={t}
                                      variant="outline"
                                      className="rounded-full text-xs"
                                    >
                                      <CheckCircle2 className="mr-1 h-3 w-3" /> {t}
                                    </Badge>
                                  ))}
                                  {result.suggestions.missingSchemaTypes.map((t) => (
                                    <Badge
                                      key={t}
                                      variant="outline"
                                      className="rounded-full border-amber-200 text-xs text-amber-700"
                                    >
                                      Missing: {t}
                                    </Badge>
                                  ))}
                                  {result.current.schemaTypes.length === 0 &&
                                    result.suggestions.missingSchemaTypes.length === 0 && (
                                      <span className="text-xs text-muted-foreground">
                                        No structured data detected or suggested.
                                      </span>
                                    )}
                                </div>
                                {result.suggestions.suggestedSchemaJsonLd && (
                                  <div className="mt-2 space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <Code2 className="h-3 w-3" /> Suggested JSON-LD
                                      </span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 gap-1 text-xs"
                                        onClick={() =>
                                          copyToClipboard(
                                            result.suggestions.suggestedSchemaJsonLd!,
                                            `${p.page}-schema`,
                                          )
                                        }
                                      >
                                        {copiedField === `${p.page}-schema` ? (
                                          <Check className="h-3 w-3" />
                                        ) : (
                                          <Copy className="h-3 w-3" />
                                        )}
                                        Copy
                                      </Button>
                                    </div>
                                    <pre className="max-h-48 overflow-auto rounded-lg bg-muted/40 p-2.5 text-[11px] leading-relaxed">
                                      {result.suggestions.suggestedSchemaJsonLd}
                                    </pre>
                                  </div>
                                )}
                              </div>

                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-2 text-xs"
                                disabled={isThisRowGenerating}
                                onClick={() => {
                                  setSuggestingUrl(p.page);
                                  generateSeoSuggestions.mutate(
                                    {
                                      url: p.page,
                                      clicks: p.clicks,
                                      impressions: p.impressions,
                                      position: p.position,
                                    },
                                    {
                                      onSuccess: (data) =>
                                        setSuggestionsByUrl((prev) => ({
                                          ...prev,
                                          [p.page]: data,
                                        })),
                                    },
                                  );
                                }}
                              >
                                <RefreshCw
                                  className={`h-3 w-3 ${isThisRowGenerating ? "animate-spin" : ""}`}
                                />
                                Regenerate
                              </Button>
                            </div>
                          )}

                          <div className="mt-4 flex items-center justify-between">
                            <a
                              href={p.page}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              Open page <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </TabsContent>
          {/* TECHNICAL */}
          <TabsContent value="technical" className="mt-4">
            <Card className="border-dashed bg-card/50 p-10 text-center">
              <p className="font-display text-lg text-muted-foreground">
                Per-page scores are already real — see the Pages tab
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Click "Audit page speed" on any page in the Pages tab for a real, on-demand
                Performance/SEO/Accessibility/Best-practices score and Core Web Vitals via Google
                PageSpeed Insights. A site-wide crawl/indexing view (sitemap coverage, robots.txt,
                canonical tags) would need additional Search Console API scopes — not built yet.
              </p>
            </Card>
          </TabsContent>

          {/* SCHEMA */}
          <TabsContent value="schema" className="mt-4">
            {!isConnected ? (
              <Card className="border-dashed bg-card/50 p-10 text-center">
                <p className="font-display text-lg text-muted-foreground">
                  Connect Search Console first
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  This scans structured data on your real pages, ranked by real Search Console
                  performance — connect on the Pages tab to pick which pages to scan.
                </p>
                <Button
                  size="sm"
                  className="mx-auto mt-4 gap-2"
                  onClick={() => connectSearchConsole.mutate()}
                >
                  <Link2 className="h-4 w-4" /> Connect Search Console
                </Button>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="text-sm text-muted-foreground">
                    Fetches each real page's actual live HTML and reports the structured data
                    (JSON-LD) genuinely found — no AI call, just a real scan. Use the AI Agent tab
                    to draft a fix for any gap found here.
                  </div>
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={schemaCheck.isPending || !scPages.data?.rows.length}
                    onClick={() => {
                      const urls = (scPages.data?.rows ?? []).map((p) => p.page);
                      schemaCheck.mutate(urls, {
                        onSuccess: (data) => setSchemaCheckResult(data),
                      });
                    }}
                  >
                    <Code2 className={`h-4 w-4 ${schemaCheck.isPending ? "animate-pulse" : ""}`} />
                    {schemaCheck.isPending
                      ? "Scanning…"
                      : schemaCheckResult
                        ? "Rescan pages"
                        : "Scan pages for structured data"}
                  </Button>
                </div>

                {schemaCheck.isError && (
                  <p className="text-sm text-destructive">{(schemaCheck.error as Error).message}</p>
                )}

                {!schemaCheckResult ? (
                  scPages.isLoading ? (
                    <p className="text-center text-sm text-muted-foreground">
                      Loading real page data…
                    </p>
                  ) : !scPages.data?.rows.length ? (
                    <p className="text-center text-sm text-muted-foreground">
                      No pages found for this period yet.
                    </p>
                  ) : (
                    <p className="text-center text-sm text-muted-foreground">
                      {scPages.data.rows.length} real page
                      {scPages.data.rows.length === 1 ? "" : "s"} ready to scan.
                    </p>
                  )
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <Card className="p-5">
                        <div className="font-display text-3xl">
                          {schemaCheckResult.summary.pagesScanned}
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          Pages scanned
                        </div>
                      </Card>
                      <Card className="p-5">
                        <div className="font-display text-3xl">
                          {schemaCheckResult.summary.typesFoundSitewide.length}
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          Schema types found sitewide
                        </div>
                      </Card>
                      <Card
                        className={`p-5 ${schemaCheckResult.summary.pagesWithNoSchema > 0 ? "border-amber-200" : ""}`}
                      >
                        <div
                          className={`font-display text-3xl ${schemaCheckResult.summary.pagesWithNoSchema > 0 ? "text-amber-700" : ""}`}
                        >
                          {schemaCheckResult.summary.pagesWithNoSchema}
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          Pages with no schema
                        </div>
                      </Card>
                      <Card className="p-5">
                        <div className="font-display text-3xl">
                          {schemaCheckResult.summary.recommendedTypesMissingSitewide.length}
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          Common types missing
                        </div>
                      </Card>
                    </div>

                    {schemaCheckResult.summary.recommendedTypesMissingSitewide.length > 0 && (
                      <Card className="border-amber-200 bg-amber-50/50 p-4">
                        <p className="text-sm">
                          Not found on any scanned page:{" "}
                          {schemaCheckResult.summary.recommendedTypesMissingSitewide.map((t, i) => (
                            <span key={t}>
                              {i > 0 && ", "}
                              <Badge
                                variant="outline"
                                className="rounded-full border-amber-300 text-amber-800"
                              >
                                {t}
                              </Badge>
                            </span>
                          ))}
                        </p>
                      </Card>
                    )}

                    <div className="grid gap-4 lg:grid-cols-2">
                      {schemaCheckResult.pages.map((p) => (
                        <Card key={p.url} className="p-5">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Globe className="h-3.5 w-3.5" />
                            <span className="truncate">{p.url}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {p.error ? (
                              <span className="flex items-center gap-1 text-xs text-destructive">
                                <XCircle className="h-3.5 w-3.5" /> {p.error}
                              </span>
                            ) : p.schemaTypes.length === 0 ? (
                              <span className="text-xs text-amber-700">
                                No structured data found
                              </span>
                            ) : (
                              p.schemaTypes.map((t) => (
                                <Badge key={t} variant="outline" className="rounded-full text-xs">
                                  <CheckCircle2 className="mr-1 h-3 w-3" /> {t}
                                </Badge>
                              ))
                            )}
                          </div>
                          <div className="mt-4 flex items-center justify-between">
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              Open page <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </TabsContent>

          {/* CONTENT */}
          <TabsContent value="content" className="mt-4">
            {!isConnected ? (
              <Card className="border-dashed bg-card/50 p-10 text-center">
                <p className="font-display text-lg text-muted-foreground">
                  Connect Search Console first
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Content gaps are computed from real queries and pages in your Search Console data
                  — connect to find them.
                </p>
                <Button
                  size="sm"
                  className="mx-auto mt-4 gap-2"
                  onClick={() => connectSearchConsole.mutate()}
                >
                  <Link2 className="h-4 w-4" /> Connect Search Console
                </Button>
              </Card>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Real search queries ({rangeLabel}) that earn impressions but rank past page 1,
                  computed purely from your Search Console numbers — no page currently targets them
                  well. Claude drafts a content brief for any gap you want to pursue.
                </div>
                {contentGaps.isLoading ? (
                  <p className="text-center text-sm text-muted-foreground">
                    Finding real content gaps…
                  </p>
                ) : contentGaps.isError ? (
                  <p className="text-center text-sm text-destructive">
                    {(contentGaps.error as Error).message}
                  </p>
                ) : !contentGaps.data?.rows.length ? (
                  <p className="text-center text-sm text-muted-foreground">
                    No real content gaps found in this period — every query earning meaningful
                    impressions is already ranking on page 1.
                  </p>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {contentGaps.data.rows.map((g) => {
                      const isThisRowBriefing =
                        generateContentBrief.isPending && briefingQuery === g.query;
                      const brief = briefsByQuery[g.query];
                      const briefError =
                        generateContentBrief.isError && briefingQuery === g.query
                          ? (generateContentBrief.error as Error).message
                          : null;

                      return (
                        <Card key={g.query} className="p-5">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Search className="h-3.5 w-3.5" />
                              <span className="truncate font-medium text-foreground">
                                {g.query}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span>{g.totalImpressions.toLocaleString()} impressions</span>
                              <span>{g.totalClicks.toLocaleString()} clicks</span>
                              <span>Avg. position {g.avgPosition.toFixed(1)}</span>
                            </div>
                            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                              Currently best served by:
                              <a
                                href={g.currentBestPage}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate underline decoration-dotted hover:text-foreground"
                              >
                                {g.currentBestPage}
                              </a>
                            </div>
                          </div>

                          {!brief ? (
                            <div className="mt-4">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                disabled={isThisRowBriefing}
                                onClick={() => {
                                  setBriefingQuery(g.query);
                                  generateContentBrief.mutate(
                                    {
                                      keyword: g.query,
                                      clicks: g.totalClicks,
                                      impressions: g.totalImpressions,
                                      position: g.avgPosition,
                                      currentBestPage: g.currentBestPage,
                                    },
                                    {
                                      onSuccess: (data) =>
                                        setBriefsByQuery((prev) => ({ ...prev, [g.query]: data })),
                                    },
                                  );
                                }}
                              >
                                <Sparkles
                                  className={`h-3.5 w-3.5 ${isThisRowBriefing ? "animate-pulse" : ""}`}
                                />
                                {isThisRowBriefing ? "Drafting brief…" : "Draft content brief"}
                              </Button>
                              {briefError && (
                                <p className="mt-2 text-xs text-destructive">{briefError}</p>
                              )}
                            </div>
                          ) : (
                            <div className="mt-4 space-y-3">
                              <div className="space-y-1">
                                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                                  Suggested page
                                </span>
                                <div className="flex items-start justify-between gap-2 rounded-lg bg-muted/40 p-2.5">
                                  <div>
                                    <p className="text-sm font-medium">{brief.suggestedTitle}</p>
                                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                                      {brief.suggestedUrlSlug}
                                    </p>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                      H1: {brief.suggestedH1}
                                    </p>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 shrink-0"
                                    onClick={() =>
                                      copyToClipboard(
                                        `${brief.suggestedTitle}\n${brief.suggestedUrlSlug}\nH1: ${brief.suggestedH1}`,
                                        `${g.query}-title`,
                                      )
                                    }
                                  >
                                    {copiedField === `${g.query}-title` ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </div>
                              </div>

                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                                    Outline
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 gap-1 text-xs"
                                    onClick={() =>
                                      copyToClipboard(
                                        brief.outline.map((o, i) => `${i + 1}. ${o}`).join("\n"),
                                        `${g.query}-outline`,
                                      )
                                    }
                                  >
                                    {copiedField === `${g.query}-outline` ? (
                                      <Check className="h-3 w-3" />
                                    ) : (
                                      <Copy className="h-3 w-3" />
                                    )}
                                    Copy
                                  </Button>
                                </div>
                                <ol className="list-decimal space-y-0.5 pl-4 text-sm">
                                  {brief.outline.map((o, i) => (
                                    <li key={i}>{o}</li>
                                  ))}
                                </ol>
                              </div>

                              <p className="text-xs text-muted-foreground">{brief.reasoning}</p>

                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-2 text-xs"
                                disabled={isThisRowBriefing}
                                onClick={() => {
                                  setBriefingQuery(g.query);
                                  generateContentBrief.mutate(
                                    {
                                      keyword: g.query,
                                      clicks: g.totalClicks,
                                      impressions: g.totalImpressions,
                                      position: g.avgPosition,
                                      currentBestPage: g.currentBestPage,
                                    },
                                    {
                                      onSuccess: (data) =>
                                        setBriefsByQuery((prev) => ({ ...prev, [g.query]: data })),
                                    },
                                  );
                                }}
                              >
                                <RefreshCw
                                  className={`h-3 w-3 ${isThisRowBriefing ? "animate-spin" : ""}`}
                                />
                                Regenerate
                              </Button>
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* BACKLINKS */}
          <TabsContent value="backlinks" className="mt-4">
            {!isConnected ? (
              <Card className="border-dashed bg-card/50 p-10 text-center">
                <p className="font-display text-lg text-muted-foreground">
                  Connect Search Console first
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  This real backlink snapshot comes from Search Console's own Links report — connect
                  on the Pages tab first.
                </p>
                <Button
                  size="sm"
                  className="mx-auto mt-4 gap-2"
                  onClick={() => connectSearchConsole.mutate()}
                >
                  <Link2 className="h-4 w-4" /> Connect Search Console
                </Button>
              </Card>
            ) : reviewAgentConnectionLoading ? (
              <p className="text-center text-sm text-muted-foreground">Checking connection…</p>
            ) : !reviewAgentConnection ? (
              <Card className="border-dashed bg-card/50 p-10 text-center">
                <p className="font-display text-lg text-muted-foreground">
                  Connect Google Business Profile first
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  This report is scraped from Search Console's real Links page, which needs the same
                  Google session already connected for the review-reply agent — connect on the
                  Reviews page first, then come back here.
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="text-sm text-muted-foreground">
                    Real backlink data from Search Console's own Links report (not exposed by
                    Google's official API, scraped from the real page). No domain authority or spam
                    score here — that genuinely needs a paid tool (Ahrefs, Semrush, Moz) with its
                    own crawl index; this is only what Google's own index reports about your real
                    site.
                  </div>
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={generateBacklinks.isPending}
                    onClick={() =>
                      generateBacklinks.mutate(undefined, {
                        onSuccess: (data) => setBacklinksReport(data),
                      })
                    }
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${generateBacklinks.isPending ? "animate-spin" : ""}`}
                    />
                    {generateBacklinks.isPending
                      ? "Scanning…"
                      : backlinksReport
                        ? "Rescan"
                        : "Scan backlinks"}
                  </Button>
                </div>

                {generateBacklinks.isError && (
                  <p className="text-sm text-destructive">
                    {(generateBacklinks.error as Error).message}
                  </p>
                )}

                {!backlinksReport ? (
                  <p className="text-center text-sm text-muted-foreground">
                    Click "Scan backlinks" for a real snapshot from Search Console.
                  </p>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Card className="p-5">
                        <div className="font-display text-3xl">
                          {backlinksReport.externalLinksTotal ?? "—"}
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          External links
                        </div>
                      </Card>
                      <Card className="p-5">
                        <div className="font-display text-3xl">
                          {backlinksReport.internalLinksTotal ?? "—"}
                        </div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                          Internal links
                        </div>
                      </Card>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card className="p-5">
                        <div className="text-sm font-medium">Top linking sites</div>
                        {backlinksReport.topLinkingSites.length === 0 ? (
                          <p className="mt-2 text-xs text-muted-foreground">None found.</p>
                        ) : (
                          <div className="mt-3 space-y-1.5">
                            {backlinksReport.topLinkingSites.map((s) => (
                              <div
                                key={s.label}
                                className="flex items-center justify-between text-sm"
                              >
                                <span className="truncate text-muted-foreground">{s.label}</span>
                                <span className="shrink-0 font-medium">{s.count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>

                      <Card className="p-5">
                        <div className="text-sm font-medium">Top linked pages</div>
                        {backlinksReport.topLinkedPages.length === 0 ? (
                          <p className="mt-2 text-xs text-muted-foreground">None found.</p>
                        ) : (
                          <div className="mt-3 space-y-1.5">
                            {backlinksReport.topLinkedPages.map((p) => (
                              <div
                                key={p.label}
                                className="flex items-center justify-between gap-2 text-sm"
                              >
                                <span className="truncate text-muted-foreground">{p.label}</span>
                                <span className="shrink-0 font-medium">{p.count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>

                      <Card className="p-5">
                        <div className="text-sm font-medium">Top linking text</div>
                        {backlinksReport.topLinkingText.length === 0 ? (
                          <p className="mt-2 text-xs text-muted-foreground">None found.</p>
                        ) : (
                          <div className="mt-3 space-y-1.5">
                            {backlinksReport.topLinkingText.map((t, i) => (
                              <div key={i} className="truncate text-sm text-muted-foreground">
                                {t || <em>(empty)</em>}
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>

                      <Card className="p-5">
                        <div className="text-sm font-medium">Top internal linked pages</div>
                        {backlinksReport.topInternalLinkedPages.length === 0 ? (
                          <p className="mt-2 text-xs text-muted-foreground">None found.</p>
                        ) : (
                          <div className="mt-3 space-y-1.5">
                            {backlinksReport.topInternalLinkedPages.map((p) => (
                              <div
                                key={p.label}
                                className="flex items-center justify-between gap-2 text-sm"
                              >
                                <span className="truncate text-muted-foreground">{p.label}</span>
                                <span className="shrink-0 font-medium">{p.count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>
                    </div>
                  </>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Keyword drawer — real Search Console detail for one real query */}
      <Sheet open={!!selectedQuery} onOpenChange={(o) => !o && setSelectedQuery(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selectedQuery && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-2xl">{selectedQuery}</SheetTitle>
                <SheetDescription>
                  {keywordDetail.isLoading
                    ? "Loading real Search Console data…"
                    : keywordDetail.isError
                      ? (keywordDetail.error as Error).message
                      : keywordDetail.data
                        ? `Avg. position ${keywordDetail.data.avgPosition?.toFixed(1) ?? "—"} · ${keywordDetail.data.totalClicks.toLocaleString()} clicks · ${keywordDetail.data.totalImpressions.toLocaleString()} impressions, last 8 weeks`
                        : null}
                </SheetDescription>
              </SheetHeader>

              {keywordDetail.data?.currentBestPage && (
                <a
                  href={keywordDetail.data.currentBestPage}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Globe className="h-3 w-3" /> {keywordDetail.data.currentBestPage}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}

              {keywordDetail.data && keywordDetail.data.trend.length > 0 && (
                <div className="mt-6 h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={keywordDetail.data.trend}>
                      <CartesianGrid
                        stroke="var(--border)"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        stroke="var(--muted-foreground)"
                        fontSize={11}
                        tickFormatter={(d) =>
                          new Date(d).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })
                        }
                      />
                      <YAxis
                        stroke="var(--muted-foreground)"
                        fontSize={11}
                        reversed
                        allowDecimals={false}
                      />
                      <Tooltip
                        labelFormatter={(d) => new Date(d).toLocaleDateString()}
                        formatter={(value: number) => [value.toFixed(1), "Position"]}
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="position"
                        stroke="var(--primary)"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="mt-6 space-y-3">
                {!drawerBrief ? (
                  <Button
                    className="w-full gap-2"
                    disabled={generateContentBrief.isPending || !keywordDetail.data}
                    onClick={() => {
                      const d = keywordDetail.data!;
                      generateContentBrief.mutate(
                        {
                          keyword: selectedQuery,
                          clicks: d.totalClicks,
                          impressions: d.totalImpressions,
                          position: d.avgPosition ?? undefined,
                          currentBestPage: d.currentBestPage ?? undefined,
                        },
                        { onSuccess: (data) => setDrawerBrief(data) },
                      );
                    }}
                  >
                    <Sparkles
                      className={`h-4 w-4 ${generateContentBrief.isPending ? "animate-pulse" : ""}`}
                    />
                    {generateContentBrief.isPending
                      ? "Drafting with AI…"
                      : "Draft AI recommendation"}
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border/70 p-4">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Sparkles className="h-3.5 w-3.5" /> AI recommendation
                      </div>
                      <p className="mt-2 text-sm font-medium">{drawerBrief.suggestedTitle}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {drawerBrief.suggestedUrlSlug}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        H1: {drawerBrief.suggestedH1}
                      </p>
                      <ol className="mt-3 list-decimal space-y-0.5 pl-4 text-sm">
                        {drawerBrief.outline.map((o, i) => (
                          <li key={i}>{o}</li>
                        ))}
                      </ol>
                      <p className="mt-3 text-xs text-muted-foreground">{drawerBrief.reasoning}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-xs"
                      onClick={() =>
                        copyToClipboard(
                          `${drawerBrief.suggestedTitle}\n${drawerBrief.suggestedUrlSlug}\nH1: ${drawerBrief.suggestedH1}\n\n${drawerBrief.outline.map((o, i) => `${i + 1}. ${o}`).join("\n")}`,
                          `drawer-${selectedQuery}`,
                        )
                      }
                    >
                      {copiedField === `drawer-${selectedQuery}` ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      Copy brief
                    </Button>
                  </div>
                )}
                {generateContentBrief.isError && (
                  <p className="text-xs text-destructive">
                    {(generateContentBrief.error as Error).message}
                  </p>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!comparingCompetitor} onOpenChange={(o) => !o && setComparingCompetitor(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {comparingCompetitor &&
            (() => {
              const active =
                freshComparison ?? reviewComparisonByName.get(comparingCompetitor) ?? null;
              const activeReal =
                active && !("insufficientData" in active)
                  ? (active as CompetitorReviewComparison)
                  : null;
              const insufficientData = active && "insufficientData" in active ? active : null;

              return (
                <>
                  <SheetHeader>
                    <SheetTitle className="font-display text-2xl">{comparingCompetitor}</SheetTitle>
                    <SheetDescription>
                      {activeReal
                        ? `${activeReal.competitorRating ?? "—"}★ (${activeReal.competitorReviewCount?.toLocaleString() ?? "—"} reviews) · compared ${timeAgo(activeReal.scannedAt)}`
                        : "Real reviews from this competitor, compared against your own real reviews by Claude."}
                    </SheetDescription>
                  </SheetHeader>

                  <div className="mt-6 space-y-4">
                    {generateReviewComparison.isPending && (
                      <p className="text-center text-sm text-muted-foreground">
                        Scraping real reviews from Google and comparing with Claude — this can take
                        a minute…
                      </p>
                    )}

                    {generateReviewComparison.isError && (
                      <p className="text-sm text-destructive">
                        {(generateReviewComparison.error as Error).message}
                      </p>
                    )}

                    {insufficientData && (
                      <p className="text-sm text-muted-foreground">
                        Not enough review text yet to compare ({insufficientData.sampleSize.ours} of
                        your reviews, {insufficientData.sampleSize.competitor} of theirs have text)
                        — need at least 3 on each side.
                      </p>
                    )}

                    {activeReal && (
                      <>
                        <div className="rounded-xl border border-border/70 p-4">
                          <div className="flex items-center gap-2 text-xs font-medium">
                            <TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> What you do
                            better
                          </div>
                          {activeReal.ourStrengths.length === 0 ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              No clear real signal in the text yet.
                            </p>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {activeReal.ourStrengths.map((s) => (
                                <Badge
                                  key={s.theme}
                                  variant="outline"
                                  className="rounded-full text-xs"
                                >
                                  {s.theme} · {s.count}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="rounded-xl border border-border/70 p-4">
                          <div className="flex items-center gap-2 text-xs font-medium">
                            <TrendingDown className="h-3.5 w-3.5 text-amber-600" /> What they do
                            better
                          </div>
                          {activeReal.competitorStrengths.length === 0 ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              No clear real signal in the text yet.
                            </p>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {activeReal.competitorStrengths.map((s) => (
                                <Badge
                                  key={s.theme}
                                  variant="outline"
                                  className="rounded-full text-xs"
                                >
                                  {s.theme} · {s.count}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        {activeReal.opportunities.length > 0 && (
                          <div className="rounded-xl border border-border/70 p-4">
                            <div className="flex items-center gap-2 text-xs font-medium">
                              <Lightbulb className="h-3.5 w-3.5 text-primary" /> Opportunities
                            </div>
                            <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
                              {activeReal.opportunities.map((o, i) => (
                                <li key={i}>{o}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <p className="text-[11px] text-muted-foreground">
                          Based on {activeReal.sampleSize.ours} of your real reviews and{" "}
                          {activeReal.sampleSize.competitor} of theirs.
                        </p>
                      </>
                    )}

                    <Button
                      className="w-full gap-2"
                      variant={activeReal || insufficientData ? "outline" : "default"}
                      disabled={generateReviewComparison.isPending}
                      onClick={() => {
                        generateReviewComparison.mutate(comparingCompetitor, {
                          onSuccess: (data) => setFreshComparison(data),
                        });
                      }}
                    >
                      <Sparkles
                        className={`h-4 w-4 ${generateReviewComparison.isPending ? "animate-pulse" : ""}`}
                      />
                      {generateReviewComparison.isPending
                        ? "Comparing…"
                        : activeReal || insufficientData
                          ? "Refresh comparison"
                          : "Compare reviews now"}
                    </Button>
                  </div>
                </>
              );
            })()}
        </SheetContent>
      </Sheet>

      {/* Agent task drawer */}
    </div>
  );
}
