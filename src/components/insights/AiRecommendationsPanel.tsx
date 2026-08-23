import { useState, type ReactNode } from "react";
import { AlertTriangle, Bell, ChevronDown, Info, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useAiRecommendations,
  useDismissedRecommendationDate,
  useDismissRecommendations,
  type AiRecommendation,
  type RecommendationSeverity,
  type RecommendationTab,
} from "@/lib/insights/queries";

// Invoices/P&L content really is price movement ("this vendor's cost
// went up 12%"); Inventory/Recipes content is broader (par-level gaps,
// margin) so "Price Alerts" doesn't fit there — just "Alerts".
const PANEL_TITLE: Record<RecommendationTab, string> = {
  invoices: "Price Alerts",
  food_cost: "Price Alerts",
  inventory: "Alerts",
  recipes: "Alerts",
  product_mix: "Menu Insights",
  waste: "Waste Alerts",
  variance: "Variance Alerts",
};

const SEVERITY_STYLE: Record<RecommendationSeverity, { badge: string; icon: string }> = {
  critical: { badge: "border-red-200 bg-red-50 text-red-700", icon: "text-red-500" },
  warning: { badge: "border-amber-200 bg-amber-50 text-amber-800", icon: "text-amber-500" },
  info: { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: "text-emerald-600" },
};

function RecommendationRow({ rec }: { rec: AiRecommendation }) {
  const style = SEVERITY_STYLE[rec.severity];
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${style.icon}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm text-ink">{rec.headline}</p>
          <Badge variant="outline" className={style.badge}>
            {rec.severity}
          </Badge>
        </div>
        <p className="text-sm text-stone-600 mt-0.5">{rec.body}</p>
      </div>
    </div>
  );
}

// Light card matching the rest of the dashboard's KPI-card style
// (bg-white, border-stone-200) instead of the dark
// bg-gradient-to-br from-[hsl(var(--ink))] pattern used elsewhere in
// this codebase — that gradient is broken CSS (--ink/--terracotta are
// defined as oklch(), so wrapping them in hsl(...) is invalid; the
// browser silently drops it and the "from" side washes out to the page
// background, which is why that pattern reads as low-contrast). Uses
// the pre-registered `text-ink`/`bg-terracotta` utilities (see
// styles.css's @theme block) instead, which resolve correctly. Always
// renders (even empty), so the AI layer stays discoverable rather than
// only appearing once it has something to say.
//
// headerAction is an optional slot (e.g. a settings-gear button) so a
// page can attach its own controls without this shared component
// needing to know about any tab-specific settings.
export function AiRecommendationsPanel({
  tab,
  headerAction,
}: {
  tab: RecommendationTab;
  headerAction?: ReactNode;
}) {
  const { data, isLoading } = useAiRecommendations(tab);
  const recommendations = data ?? [];
  const generatedAt = recommendations[0]?.generated_at;
  const latestBusinessDate = recommendations[0]?.business_date;

  const { data: dismissedDate } = useDismissedRecommendationDate(tab);
  const dismissRecommendations = useDismissRecommendations(tab);
  // Peeking at a dismissed batch (via "Show") is session-local — it
  // doesn't clear the persisted dismissal, so it's back to collapsed
  // on the next reload/login unless a genuinely new business_date has
  // landed by then.
  const [peeking, setPeeking] = useState(false);
  const isDismissed = !!latestBusinessDate && dismissedDate === latestBusinessDate && !peeking;

  if (isDismissed) {
    return (
      <Card className="p-3 border-stone-200 bg-white">
        <button
          onClick={() => setPeeking(true)}
          className="flex w-full items-center gap-2.5 text-left"
        >
          <div className="h-7 w-7 rounded-lg bg-terracotta/10 flex items-center justify-center shrink-0">
            <Bell className="h-3.5 w-3.5 text-terracotta" />
          </div>
          <span className="text-sm font-medium text-ink">{PANEL_TITLE[tab]}</span>
          <span className="text-xs text-stone-500">
            dismissed — {recommendations.length} item{recommendations.length === 1 ? "" : "s"}
          </span>
          <ChevronDown className="h-4 w-4 text-stone-400 ml-auto" />
        </button>
      </Card>
    );
  }

  return (
    <Card className="p-5 border-stone-200 bg-white">
      <div className="flex items-start gap-4">
        <div className="h-11 w-11 rounded-xl bg-terracotta/10 flex items-center justify-center shrink-0">
          <Bell className="h-5 w-5 text-terracotta" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-serif text-lg text-ink">{PANEL_TITLE[tab]}</p>
            <div className="ml-auto flex items-center gap-1">
              {headerAction}
              {recommendations.length > 0 && latestBusinessDate && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-stone-400 hover:text-stone-700"
                  onClick={() => {
                    setPeeking(false);
                    dismissRecommendations.mutate(latestBusinessDate);
                  }}
                  title="Dismiss until the next new alert"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-stone-500">
            Cost changes worth a look
            {generatedAt && ` — updated ${new Date(generatedAt).toLocaleDateString()}`}
          </p>

          {isLoading ? (
            <p className="text-sm text-stone-500 mt-1">Loading...</p>
          ) : recommendations.length === 0 ? (
            <p className="text-sm text-stone-500 mt-1 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" /> Nothing flagged yet — check back after tonight's
              analysis.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-stone-100">
              {recommendations.map((rec) => (
                <RecommendationRow key={`${rec.tab}-${rec.headline}`} rec={rec} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
