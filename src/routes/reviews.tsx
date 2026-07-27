import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import {
  useReviews,
  useReviewAgentConnection,
  usePreviewReviews,
  useApproveAndPost,
  useDismissReview,
  useRegenerateReply,
  useSetAutoSend5Star,
  useAnalyzeInsights,
  type Review,
  type ReviewStatus,
  type InsightsResult,
} from "@/lib/reviews/queries";
import { dateInRange } from "@/lib/boh/queries";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
  Link2,
  MessageSquare,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Wand2,
  type LucideIcon,
} from "lucide-react";

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
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/reviews")({
  head: () => ({
    meta: [
      { title: "Reviews · Thrasher's Pub" },
      {
        name: "description",
        content:
          "Real Google reviews with an AI reply agent — every reply is human-approved before it posts.",
      },
    ],
  }),
  component: ReviewsPage,
});

const MIN_SAMPLE_FOR_RATING = 5;
const MIN_SAMPLE_FOR_RESPONSE_TIME = 3;
const REVIEWS_PAGE_SIZE = 25;

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i < value ? "fill-primary text-primary" : "text-muted-foreground/40"}`}
        />
      ))}
    </div>
  );
}

const STATUS_STYLE: Record<ReviewStatus, { label: string; chip: string; accent: string }> = {
  drafted: {
    label: "Needs reply",
    chip: "bg-primary/10 text-primary border-primary/20",
    accent: "border-l-primary",
  },
  approved_pending_post: {
    label: "Posting…",
    chip: "bg-accent text-accent-foreground border-border",
    accent: "border-l-accent-foreground/40",
  },
  posted: {
    label: "Posted",
    chip: "bg-success/10 text-success border-success/20",
    accent: "border-l-success",
  },
  post_failed: {
    label: "Failed to post",
    chip: "bg-destructive/10 text-destructive border-destructive/20",
    accent: "border-l-destructive",
  },
  dismissed: {
    label: "Dismissed",
    chip: "bg-muted text-muted-foreground border-border",
    accent: "border-l-border",
  },
};

function StatusChip({ status }: { status: ReviewStatus }) {
  const { label, chip } = STATUS_STYLE[status];
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${chip}`}
    >
      {label}
    </span>
  );
}

// Derived purely from the star rating — not text-based sentiment
// analysis (that would need real NLP, not built). Same 1–2/3/4–5
// buckets as the rating filter buttons, so the label on a card always
// agrees with which filter surfaces it.
type Sentiment = "positive" | "neutral" | "negative";

function sentimentFromRating(starRating: number): Sentiment {
  if (starRating >= 4) return "positive";
  if (starRating === 3) return "neutral";
  return "negative";
}

const SENTIMENT_STYLE: Record<Sentiment, { label: string; cls: string; icon: LucideIcon }> = {
  positive: {
    label: "Positive",
    cls: "bg-success/10 text-success border-success/20",
    icon: ThumbsUp,
  },
  neutral: {
    label: "Neutral",
    cls: "bg-muted text-muted-foreground border-border",
    icon: MessageSquare,
  },
  negative: {
    label: "Negative",
    cls: "bg-destructive/10 text-destructive border-destructive/20",
    icon: ThumbsDown,
  },
};

function SentimentChip({ starRating }: { starRating: number }) {
  const { label, cls, icon: Icon } = SENTIMENT_STYLE[sentimentFromRating(starRating)];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  attention = false,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  attention?: boolean;
}) {
  return (
    <Card
      className={`rounded-2xl border p-5 shadow-soft transition ${
        attention ? "border-primary/30 bg-primary/[0.03]" : "border-border/70 bg-card"
      }`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
            attention ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      </div>
      <div className="mt-3 font-display text-3xl">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
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

// A guardrail row that isn't wired to anything real yet — kept visible
// (per the original design) so the roadmap stays obvious, but shown
// firmly off/disabled rather than pretending it does something.
function PlannedToggleRow({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-background/60 p-3">
      <Switch checked={false} disabled />
      <div>
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div className="text-xs text-muted-foreground/80">{description}</div>
      </div>
    </div>
  );
}

function EmptyInsightCard({ title, description }: { title: string; description: string }) {
  return (
    <Card className="rounded-2xl border-dashed border-border bg-card/50 p-6">
      <h3 className="font-display text-lg text-muted-foreground">{title}</h3>
      <p className="mt-3 text-sm text-muted-foreground/80">{description}</p>
    </Card>
  );
}

function ThemeListCard({
  title,
  emptyHint,
  noResultsHint = "No clear recurring theme yet — reviews are too varied so far.",
  mutation,
  pick,
  badgeVariant,
}: {
  title: string;
  emptyHint: string;
  noResultsHint?: string;
  mutation: UseMutationResult<InsightsResult, Error, void, unknown>;
  pick: (data: InsightsResult) => { label: string; count: number }[];
  badgeVariant: "positive" | "negative";
}) {
  const badgeCls =
    badgeVariant === "positive"
      ? "bg-success/10 text-success border-success/20"
      : "bg-destructive/10 text-destructive border-destructive/20";

  return (
    <Card className="rounded-2xl border-border/70 bg-card p-6 shadow-soft">
      <h3 className="font-display text-lg">{title}</h3>

      {mutation.isIdle && (
        <p className="mt-3 text-sm text-muted-foreground">
          {emptyHint} Click "Analyze reviews" above to run this for real.
        </p>
      )}

      {mutation.isPending && (
        <p className="mt-3 text-sm text-muted-foreground">Reading your reviews…</p>
      )}

      {mutation.isError && (
        <p className="mt-3 text-sm text-destructive">{mutation.error.message}</p>
      )}

      {mutation.isSuccess && mutation.data.insufficientData && (
        <p className="mt-3 text-sm text-muted-foreground">
          Not enough reviews with written text yet ({mutation.data.sampleSize.positive} positive,{" "}
          {mutation.data.sampleSize.negative} negative) — need at least a few to find real patterns.
        </p>
      )}

      {mutation.isSuccess && !mutation.data.insufficientData && (
        <>
          {pick(mutation.data).length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{noResultsHint}</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {pick(mutation.data).map((t) => (
                <li key={t.label} className="flex items-center gap-3">
                  <span className="flex-1">{t.label}</span>
                  <Badge variant="secondary" className={`rounded-full border ${badgeCls}`}>
                    {t.count}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function ReviewsPage() {
  const { data: reviews = [], isLoading, error } = useReviews();
  const { data: connection } = useReviewAgentConnection();
  const preview = usePreviewReviews();
  const approveAndPost = useApproveAndPost();
  const dismiss = useDismissReview();
  const regenerate = useRegenerateReply();
  const setAutoSend5Star = useSetAutoSend5Star();
  const analyzeInsights = useAnalyzeInsights();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirmingAutoSend, setConfirmingAutoSend] = useState(false);
  const [ratingFilter, setRatingFilter] = useState<"all" | "low" | "mid" | "high">("all");
  const [search, setSearch] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState("inbox");

  // Same global range as every other page — set once in the Topbar.
  // Only the retrospective metrics (avg rating, avg response time, the
  // volume trend chart) respect it; the Inbox list and the "Needs
  // reply"/"AI replies posted" KPIs deliberately stay unfiltered — a
  // real still-unanswered old review shouldn't disappear from the
  // backlog just because it falls outside the selected period, same
  // "live current-state fact, not a historical window" reasoning
  // Home's own real-backlog panel already documents for this exact
  // "reviews awaiting reply" count (src/routes/index.tsx).
  const { dateRange: globalDateRange } = useDateRange();
  const dateRange = useMemo(
    () => ({ from: isoDate(globalDateRange.from), to: isoDate(globalDateRange.to) }),
    [globalDateRange],
  );
  const rangeLabel = useMemo(() => formatDateRange(globalDateRange), [globalDateRange]);
  const dateFilteredReviews = useMemo(
    () => reviews.filter((r) => dateInRange(r.reviewWrittenAt ?? r.reviewFoundAt, dateRange)),
    [reviews, dateRange],
  );

  const active = reviews.find((r) => r.id === activeId) ?? null;

  const openReview = (r: Review) => {
    setActiveId(r.id);
    setReplyDraft(r.editedReply ?? r.aiDraftReply ?? "");
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dateFilteredReviews.filter((r) => {
      if (r.status === "dismissed") return false;
      if (ratingFilter === "low" && r.starRating > 2) return false;
      if (ratingFilter === "mid" && r.starRating !== 3) return false;
      if (ratingFilter === "high" && r.starRating < 4) return false;
      if (q) {
        const haystack = `${r.reviewerName} ${r.reviewText ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [dateFilteredReviews, ratingFilter, search]);

  // Any change to what's being filtered should land back on page 1 —
  // otherwise a narrower filter can strand you on a now-empty page.
  useEffect(() => {
    setPage(1);
  }, [ratingFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / REVIEWS_PAGE_SIZE));
  const pagedReviews = useMemo(
    () => filtered.slice((page - 1) * REVIEWS_PAGE_SIZE, page * REVIEWS_PAGE_SIZE),
    [filtered, page],
  );

  const kpis = useMemo(() => {
    // Every KPI here scopes to the selected global range — same as
    // Invoices' "Pending review" count, which is the precedent this
    // page follows (not Home's separate always-live backlog widget,
    // which has no equivalent full list/page underneath it to stay
    // consistent with).
    const needsReply = dateFilteredReviews.filter(
      (r) => r.status === "drafted" || r.status === "approved_pending_post",
    ).length;
    const datePosted = dateFilteredReviews.filter((r) => r.status === "posted");
    const postedCount = datePosted.length;

    const avgRating =
      dateFilteredReviews.length >= MIN_SAMPLE_FOR_RATING
        ? dateFilteredReviews.reduce((s, r) => s + r.starRating, 0) / dateFilteredReviews.length
        : null;

    const responseTimes = datePosted
      .filter((r) => r.postedAt)
      .map((r) => new Date(r.postedAt!).getTime() - new Date(r.reviewFoundAt).getTime());
    const avgResponseMs =
      responseTimes.length >= MIN_SAMPLE_FOR_RESPONSE_TIME
        ? responseTimes.reduce((s, ms) => s + ms, 0) / responseTimes.length
        : null;

    return { needsReply, postedCount, avgRating, avgResponseMs };
  }, [dateFilteredReviews]);

  // Real review volume + avg rating over the selected global range —
  // day-bucketed for a short range, week-bucketed (Monday-start) for a
  // longer one, same >21-day threshold useLaborCostTrend/useItemTrend
  // already use elsewhere in this app. Sparse buckets are shown as
  // real zeros, not hidden, same honesty pattern as every other trend
  // chart in this app.
  const ratingTrend = useMemo(() => {
    const days =
      Math.round((globalDateRange.to.getTime() - globalDateRange.from.getTime()) / 86_400_000) +
      1;
    const useWeekly = days > 21;
    const bucketMs = useWeekly ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

    const rangeStart = new Date(globalDateRange.from);
    rangeStart.setHours(0, 0, 0, 0);
    const firstBucketStart = useWeekly
      ? (() => {
          const d = new Date(rangeStart);
          const diff = (d.getDay() + 6) % 7; // days since Monday
          d.setDate(d.getDate() - diff);
          return d;
        })()
      : rangeStart;

    const rangeEnd = new Date(globalDateRange.to);
    rangeEnd.setHours(23, 59, 59, 999);

    const buckets: { start: Date; end: Date; count: number; ratingSum: number }[] = [];
    for (let cursor = new Date(firstBucketStart); cursor <= rangeEnd; ) {
      const end = new Date(cursor.getTime() + bucketMs);
      buckets.push({ start: new Date(cursor), end, count: 0, ratingSum: 0 });
      cursor = end;
    }

    for (const r of dateFilteredReviews) {
      if (r.status === "dismissed") continue;
      const written = new Date(r.reviewWrittenAt ?? r.reviewFoundAt);
      const bucket = buckets.find((b) => written >= b.start && written < b.end);
      if (bucket) {
        bucket.count++;
        bucket.ratingSum += r.starRating;
      }
    }

    return buckets.map((b) => ({
      week: b.start.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      count: b.count,
      avgRating: b.count > 0 ? b.ratingSum / b.count : null,
    }));
  }, [dateFilteredReviews, globalDateRange]);

  const formatResponseTime = (ms: number) => {
    const hours = ms / 3_600_000;
    if (hours < 1) return `${Math.round(ms / 60_000)} min`;
    if (hours < 48) return `${hours.toFixed(1)} hr`;
    return `${Math.round(hours / 24)} days`;
  };

  const handleApproveAndPost = () => {
    if (!active) return;
    approveAndPost.mutate(
      { reviewId: active.id, replyText: replyDraft },
      { onSuccess: () => setActiveId(null) },
    );
  };

  return (
    <>
      <Topbar eyebrow="Guest sentiment" title="Reviews" />
      <main className="space-y-8 px-6 py-8">
        {connection?.lastScanPanelHealthy === false && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Google's reviews panel isn't showing its own reviews</p>
              <p className="mt-1 text-amber-800">
                Google reports {connection.lastScanGoogleReviewCount?.toLocaleString()} real reviews
                for this business, but its own reviews panel is rendering none — a bug on Google's
                side, confirmed by direct inspection, not something wrong with your connection. New
                reviews may not get drafted and approved replies may fail to post until this clears.
                Nothing to do here; this banner will disappear once Google's panel recovers.
              </p>
            </div>
          </div>
        )}

        {/* KPI row */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Needs reply"
            value={String(kpis.needsReply)}
            hint={`${rangeLabel} — AI has a draft ready for each`}
            icon={Inbox}
            attention={kpis.needsReply > 0}
          />
          <KpiCard
            label="AI replies posted"
            value={String(kpis.postedCount)}
            hint={rangeLabel}
            icon={CheckCircle2}
          />
          <KpiCard
            label="Avg rating (tracked)"
            value={kpis.avgRating != null ? kpis.avgRating.toFixed(1) : "—"}
            hint={
              kpis.avgRating != null
                ? `${rangeLabel} — not Google's public rating`
                : "Not enough data yet"
            }
            icon={Star}
          />
          <KpiCard
            label="Avg response time"
            value={kpis.avgResponseMs != null ? formatResponseTime(kpis.avgResponseMs) : "—"}
            hint={
              kpis.avgResponseMs != null
                ? `${rangeLabel} — found to posted`
                : "Not enough data yet"
            }
            icon={Clock}
          />
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-card">
            <TabsTrigger value="inbox" className="gap-2">
              <Inbox className="h-3.5 w-3.5" /> Inbox
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Bot className="h-3.5 w-3.5" /> AI Agent
            </TabsTrigger>
            <TabsTrigger value="insights" className="gap-2">
              <Sparkles className="h-3.5 w-3.5" /> Insights
            </TabsTrigger>
            <TabsTrigger value="generate" className="gap-2">
              <QrCode className="h-3.5 w-3.5" /> Get reviews
            </TabsTrigger>
            <TabsTrigger value="platforms" className="gap-2">
              <Link2 className="h-3.5 w-3.5" /> Platforms
            </TabsTrigger>
          </TabsList>

          {/* INBOX */}
          <TabsContent value="inbox" className="mt-6 space-y-4">
            <Card className="flex flex-wrap items-center gap-2 rounded-2xl border-border/70 bg-card p-3 shadow-soft">
              <span className="px-2 text-xs text-muted-foreground">Filter</span>
              {(
                [
                  ["all", "All reviews", null],
                  ["high", "Positive", ThumbsUp],
                  ["mid", "Neutral", MessageSquare],
                  ["low", "Negative", ThumbsDown],
                ] as const
              ).map(([key, label, Icon]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={ratingFilter === key ? "default" : "ghost"}
                  className="h-8 gap-1.5 rounded-full text-xs"
                  onClick={() => setRatingFilter(key)}
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {label}
                </Button>
              ))}
              <Badge
                variant="secondary"
                className="rounded-full text-[10px] uppercase tracking-wider"
              >
                Source: Google
              </Badge>
              <div className="ml-auto flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search guest or review text…"
                  className="w-40 bg-transparent text-xs outline-none placeholder:text-muted-foreground sm:w-56"
                />
              </div>
            </Card>

            {isLoading && <p className="text-sm text-muted-foreground">Loading reviews…</p>}
            {error && (
              <Card className="rounded-2xl border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
                Couldn't load reviews: {(error as Error).message}
              </Card>
            )}

            <div className="space-y-3">
              {pagedReviews.map((r) => (
                <Card
                  key={r.id}
                  className={`group cursor-pointer rounded-2xl border-border/70 border-l-4 bg-card p-5 shadow-soft transition hover:shadow-card ${STATUS_STYLE[r.status].accent}`}
                  onClick={() => openReview(r)}
                >
                  <div className="flex items-start gap-4">
                    <Avatar className="h-10 w-10 border border-border">
                      <AvatarFallback className="bg-secondary text-xs font-medium">
                        {r.reviewerName
                          .split(" ")
                          .map((s) => s[0])
                          .join("")
                          .slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{r.reviewerName}</span>
                        <Badge
                          variant="secondary"
                          className="rounded-full px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                        >
                          Google
                        </Badge>
                        <Stars value={r.starRating} />
                        <span className="text-xs text-muted-foreground">
                          · {timeAgo(r.reviewWrittenAt ?? r.reviewFoundAt)}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          <SentimentChip starRating={r.starRating} />
                          <StatusChip status={r.status} />
                        </div>
                      </div>
                      {r.reviewText && (
                        <p className="mt-2 text-sm leading-relaxed text-foreground/90">
                          {r.reviewText}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {r.aiDraftReply && r.status === "drafted" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent/60 px-2 py-1 text-xs text-accent-foreground">
                            <Wand2 className="h-3 w-3" /> AI draft ready
                          </span>
                        )}
                        {r.status === "post_failed" && r.postError && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-xs text-destructive"
                            title={r.postError}
                          >
                            <AlertTriangle className="h-3 w-3" /> {r.postError}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
              {!isLoading && filtered.length === 0 && (
                <Card className="rounded-2xl border-dashed bg-card/50 p-10 text-center text-sm text-muted-foreground">
                  {reviews.length === 0
                    ? 'No reviews yet — click "Check now" on the AI Agent tab to look for real Google reviews.'
                    : "No reviews match this filter."}
                </Card>
              )}
              {filtered.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm shadow-soft">
                  <span className="text-muted-foreground">
                    Showing {(page - 1) * REVIEWS_PAGE_SIZE + 1}–
                    {Math.min(page * REVIEWS_PAGE_SIZE, filtered.length)} of {filtered.length}{" "}
                    review{filtered.length === 1 ? "" : "s"}
                  </span>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Page {page} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          {/* AI AGENT */}
          <TabsContent value="ai" className="mt-6 grid gap-4 lg:grid-cols-3">
            <Card className="rounded-2xl border-border/70 bg-card p-6 shadow-soft lg:col-span-2">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg">Reply agent</h3>
                  <p className="text-xs text-muted-foreground">
                    Every reply is drafted by AI and held for your approval — nothing posts to
                    Google automatically.
                  </p>
                </div>
              </div>

              <Separator className="my-5" />

              {connection ? (
                <>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Connected business
                      </div>
                      <div className="mt-1 text-sm">{connection.businessName || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        Profile ID {connection.businessProfileId}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Session
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-sm">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            connection.cookiesValidAt ? "bg-success" : "bg-muted-foreground/40"
                          }`}
                        />
                        {connection.cookiesValidAt ? "Working" : "Not checked yet"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {connection.lastSyncedAt
                          ? `Last checked ${timeAgo(connection.lastSyncedAt)}`
                          : "Never checked"}
                      </div>
                    </div>
                  </div>

                  <Separator className="my-5" />

                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Brand voice
                    </div>
                    <p className="mt-2 text-sm text-foreground/90">
                      {connection.businessDescription ||
                        "No business description set — replies fall back to a generic tone."}
                    </p>
                    <div className="mt-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                      Reply contact: {connection.replyContactEmail || "—"}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Tone is chosen automatically from the star rating (warm for 5★, empathetic for
                      1–2★). A manual tone override isn't built yet.
                    </p>
                  </div>

                  <Button
                    className="mt-5 gap-2"
                    onClick={() => preview.mutate()}
                    disabled={preview.isPending}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${preview.isPending ? "animate-spin" : ""}`}
                    />
                    {preview.isPending ? "Checking…" : "Check now"}
                  </Button>
                  {preview.isSuccess && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Found {preview.data.found} unreplied review
                      {preview.data.found === 1 ? "" : "s"} on Google, drafted{" "}
                      {preview.data.drafted} new one{preview.data.drafted === 1 ? "" : "s"}
                      {preview.data.autoPosted > 0
                        ? `, auto-sent ${preview.data.autoPosted} of them (5★)`
                        : ""}
                      .
                    </p>
                  )}
                  {preview.isError && (
                    <p className="mt-2 text-xs text-destructive">
                      {(preview.error as Error).message}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No Google review agent connected for this restaurant yet. Connecting one requires
                  a one-time local setup step — ask your developer to run the session login script.
                </p>
              )}

              <Separator className="my-5" />

              <div className="space-y-3">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Guardrails
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
                  <Switch checked disabled />
                  <div>
                    <div className="text-sm font-medium">Every reply requires your approval</div>
                    <div className="text-xs text-muted-foreground">
                      {connection?.autoSend5Star
                        ? "Applies to every rating except 5★ — those post automatically (see below)."
                        : "There is no auto-send mode. Every AI draft is held here until you approve it."}
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-border bg-background p-3">
                  <Switch
                    checked={connection?.autoSend5Star ?? false}
                    disabled={!connection || setAutoSend5Star.isPending}
                    onCheckedChange={(checked) => {
                      if (checked) setConfirmingAutoSend(true);
                      else setAutoSend5Star.mutate(false);
                    }}
                  />
                  <div>
                    <div className="text-sm font-medium">Auto-send 5★ replies</div>
                    <div className="text-xs text-muted-foreground">
                      When on, 5★ reviews post their AI-drafted reply immediately during the next
                      scan — no approval click. Every other rating still always waits for you.
                    </div>
                    {setAutoSend5Star.isError && (
                      <div className="mt-1 text-xs text-destructive">
                        {(setAutoSend5Star.error as Error).message}
                      </div>
                    )}
                  </div>
                </div>
                <PlannedToggleRow
                  label="Offer recovery on negative reviews"
                  description="Not built yet — would suggest a comp or invite-back when a review reads negative."
                />
                <PlannedToggleRow
                  label="Never promise refunds"
                  description="Not built yet — would flag refund language and route it to a manager instead of posting."
                />
              </div>

              <AlertDialog open={confirmingAutoSend} onOpenChange={setConfirmingAutoSend}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Turn on auto-send for 5★ replies?</AlertDialogTitle>
                    <AlertDialogDescription>
                      From now on, when a scan finds a new 5★ review, its AI-drafted reply posts to
                      Google immediately — you won't see it in the Inbox first. Every review rated
                      1–4★ still always waits for your explicit approval. You can turn this back off
                      anytime.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setAutoSend5Star.mutate(true);
                        setConfirmingAutoSend(false);
                      }}
                    >
                      Turn on auto-send
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </Card>

            <Card className="rounded-2xl border-border/70 bg-card p-6 shadow-soft">
              <h3 className="font-display text-lg">Training</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                This agent doesn't learn from your edits yet. Every reply is generated fresh from
                the brand voice settings above, not from a memory of past replies. An
                indexing/training pipeline isn't built.
              </p>
            </Card>
          </TabsContent>

          {/* INSIGHTS */}
          <TabsContent value="insights" className="mt-6 space-y-4">
            <Card className="rounded-2xl border-border/70 bg-card p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Trend
                  </div>
                  <h3 className="mt-1 font-display text-xl">Review volume · {rangeLabel}</h3>
                </div>
              </div>
              {reviews.length === 0 ? (
                <div className="mt-4 flex h-[220px] items-center justify-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
                  No reviews yet — click "Check now" on the AI Agent tab to look for real Google
                  reviews.
                </div>
              ) : activeTab !== "insights" ? (
                <div className="mt-4 h-[220px]" />
              ) : (
                <div className="mt-4 h-[220px]">
                  {/* Only mounted once this tab is actually active — Radix
                      keeps inactive TabsContent in the DOM (hidden, not
                      unmounted), and ResponsiveContainer measures 0 width
                      if it mounts while its parent is display:none. */}
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ratingTrend}>
                      <CartesianGrid
                        stroke="var(--border)"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis dataKey="week" stroke="var(--muted-foreground)" fontSize={11} />
                      <YAxis stroke="var(--muted-foreground)" fontSize={11} allowDecimals={false} />
                      <Tooltip
                        formatter={(value: number, name: string, item) => {
                          if (name === "count") {
                            const avg = (item.payload as { avgRating: number | null }).avgRating;
                            return [
                              `${value} review${value === 1 ? "" : "s"}${avg != null ? ` · avg ${avg.toFixed(1)}★` : ""}`,
                              "This week",
                            ];
                          }
                          return [value, name];
                        }}
                        contentStyle={{ borderRadius: 10, border: "1px solid var(--border)" }}
                      />
                      <Bar
                        dataKey="count"
                        fill="var(--primary)"
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-border/70 bg-card p-4 shadow-soft">
              <div>
                <div className="text-sm font-medium">Trending praise & complaints</div>
                <p className="text-xs text-muted-foreground">
                  Real Claude analysis of your actual review text — reads what guests wrote and
                  finds recurring themes. Not run automatically; click to analyze.
                </p>
              </div>
              <Button
                size="sm"
                className="gap-2"
                onClick={() => analyzeInsights.mutate()}
                disabled={analyzeInsights.isPending}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${analyzeInsights.isPending ? "animate-spin" : ""}`}
                />
                {analyzeInsights.isPending ? "Analyzing…" : "Analyze reviews"}
              </Button>
            </Card>

            <div className="grid gap-4 lg:grid-cols-3">
              <ThemeListCard
                title="Trending praise"
                emptyHint="Would surface the dishes, staff, and details guests mention most in positive reviews."
                mutation={analyzeInsights}
                pick={(d) => d.praiseThemes.map((t) => ({ label: t.theme, count: t.count }))}
                badgeVariant="positive"
              />
              <ThemeListCard
                title="Trending complaints"
                emptyHint="Would surface recurring themes in critical reviews — wait times, temperature, billing, etc."
                mutation={analyzeInsights}
                pick={(d) => d.complaintThemes.map((t) => ({ label: t.theme, count: t.count }))}
                badgeVariant="negative"
              />
              <ThemeListCard
                title="Staff leaderboard"
                emptyHint="Reads your positive reviews for guests naming staff by name (e.g. 'ask for Jake at the bar')."
                noResultsHint="No one named by name in positive reviews yet."
                mutation={analyzeInsights}
                pick={(d) => d.staffMentions.map((s) => ({ label: s.name, count: s.count }))}
                badgeVariant="positive"
              />
            </div>
          </TabsContent>

          {/* GENERATE */}
          <TabsContent value="generate" className="mt-6 grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl border-border/70 bg-card p-6 shadow-soft">
              <h3 className="font-display text-lg">Ask happy guests for reviews</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Automatic after-visit asks, routed to Google based on guest history. None of this is
                built yet — no messaging pipeline exists.
              </p>
              <div className="mt-5 space-y-3">
                <PlannedToggleRow
                  label="SMS after dinner (4h delay)"
                  description="Not built yet — no SMS provider is connected."
                />
                <PlannedToggleRow
                  label="Email next morning"
                  description="Not built yet — would reuse the email pipeline already used for vendor invoices."
                />
                <PlannedToggleRow
                  label="QR card on check folio"
                  description="Not built yet — would print a QR code guests can scan at the table."
                />
              </div>
            </Card>
            <Card className="rounded-2xl border-border/70 bg-card p-6 shadow-soft">
              <h3 className="font-display text-lg">Last 30 days</h3>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl bg-secondary p-4">
                  <div className="font-display text-2xl text-muted-foreground">—</div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Asks sent
                  </div>
                </div>
                <div className="rounded-xl bg-secondary p-4">
                  <div className="font-display text-2xl text-muted-foreground">—</div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    New reviews
                  </div>
                </div>
                <div className="rounded-xl bg-secondary p-4">
                  <div className="font-display text-2xl text-muted-foreground">—</div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Avg rating
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                No review-request campaigns have run yet — this card will fill in once that's built.
              </p>
            </Card>
          </TabsContent>

          {/* PLATFORMS */}
          <TabsContent value="platforms" className="mt-6">
            <Card className="rounded-2xl border-border/70 bg-card p-2 shadow-soft">
              <div className="grid grid-cols-12 gap-4 px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                <div className="col-span-5">Platform</div>
                <div className="col-span-2">Rating</div>
                <div className="col-span-2">Reviews</div>
                <div className="col-span-3 text-right">Status</div>
              </div>

              <div className="grid grid-cols-12 items-center gap-4 border-t border-border/60 px-4 py-4">
                <div className="col-span-5 flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
                    <span className="inline-block h-2 w-2 rounded-full bg-[oklch(0.7_0.15_85)]" />
                  </span>
                  <div>
                    <div className="text-sm font-medium">Google</div>
                    <div className="text-[11px] text-muted-foreground">
                      Native reply agent · two-way replies
                    </div>
                  </div>
                </div>
                <div className="col-span-2 inline-flex items-center gap-1 text-sm">
                  {kpis.avgRating != null ? (
                    <>
                      <Star className="h-3.5 w-3.5 fill-primary text-primary" />{" "}
                      {kpis.avgRating.toFixed(1)}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                <div className="col-span-2 text-sm">{reviews.length || "—"}</div>
                <div className="col-span-3 flex items-center justify-end gap-2">
                  {connection ? (
                    <Badge variant="secondary" className="rounded-full text-success">
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not connected</span>
                  )}
                </div>
              </div>

              {(["Yelp", "Tripadvisor", "OpenTable", "DoorDash"] as const).map((p) => (
                <div
                  key={p}
                  className="grid grid-cols-12 items-center gap-4 border-t border-border/60 px-4 py-4 opacity-60"
                >
                  <div className="col-span-5 flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
                      <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
                    </span>
                    <div>
                      <div className="text-sm font-medium">{p}</div>
                      <div className="text-[11px] text-muted-foreground">
                        No integration built yet
                      </div>
                    </div>
                  </div>
                  <div className="col-span-2 text-sm text-muted-foreground">—</div>
                  <div className="col-span-2 text-sm text-muted-foreground">—</div>
                  <div className="col-span-3 flex items-center justify-end">
                    <span className="text-xs text-muted-foreground">Not available</span>
                  </div>
                </div>
              ))}
            </Card>
            <p className="mt-3 px-1 text-xs text-muted-foreground">
              Only Google has a working reply agent today. Yelp, Tripadvisor, OpenTable and DoorDash
              would each need their own integration built before they could appear here for real.
            </p>
          </TabsContent>
        </Tabs>
      </main>

      {/* Reply drawer */}
      <Sheet open={!!active} onOpenChange={(o) => !o && setActiveId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-background p-0 sm:max-w-xl">
          {active && (
            <div className="flex h-full flex-col">
              <SheetHeader className="border-b border-border/70 p-6">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Stars value={active.starRating} />
                  <span>·</span>
                  <span>{timeAgo(active.reviewWrittenAt ?? active.reviewFoundAt)}</span>
                  <SentimentChip starRating={active.starRating} />
                  <StatusChip status={active.status} />
                </div>
                <SheetTitle className="font-display text-2xl">{active.reviewerName}</SheetTitle>
                {active.status === "posted" && active.postedAt && (
                  <SheetDescription className="text-xs">
                    Posted {timeAgo(active.postedAt)}
                  </SheetDescription>
                )}
              </SheetHeader>

              <div className="space-y-6 overflow-y-auto p-6">
                {active.reviewText && (
                  <div className="rounded-2xl border border-border bg-secondary/50 p-4 text-sm leading-relaxed">
                    {active.reviewText}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      <Wand2 className="h-3.5 w-3.5 text-primary" /> Reply
                    </div>
                    {active.status !== "posted" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() =>
                          regenerate.mutate(active.id, {
                            onSuccess: (data) => setReplyDraft(data.draftReply),
                          })
                        }
                        disabled={regenerate.isPending}
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${regenerate.isPending ? "animate-spin" : ""}`}
                        />
                        {regenerate.isPending ? "Regenerating…" : "Regenerate"}
                      </Button>
                    )}
                  </div>
                  <Textarea
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    disabled={active.status === "posted" || regenerate.isPending}
                    className="mt-2 min-h-[160px] resize-none bg-card text-sm leading-relaxed"
                  />
                  {regenerate.isError && (
                    <p className="mt-1.5 text-xs text-destructive">
                      {(regenerate.error as Error).message}
                    </p>
                  )}
                </div>

                {active.status === "post_failed" && active.postError && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                    Last attempt failed: {active.postError}
                  </div>
                )}
              </div>

              {active.status !== "posted" && (
                <div className="mt-auto flex items-center gap-2 border-t border-border/70 bg-card p-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      dismiss.mutate(active.id, { onSuccess: () => setActiveId(null) })
                    }
                    disabled={dismiss.isPending}
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="sm"
                    className="ml-auto gap-2"
                    onClick={handleApproveAndPost}
                    disabled={approveAndPost.isPending || !replyDraft.trim()}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {approveAndPost.isPending ? "Posting…" : "Approve & post to Google"}
                  </Button>
                </div>
              )}
              {approveAndPost.isError && (
                <p className="border-t border-border/70 bg-card p-4 pt-0 text-xs text-destructive">
                  {(approveAndPost.error as Error).message}
                </p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
