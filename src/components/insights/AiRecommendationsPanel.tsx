import type { ReactNode } from "react";
import { AlertTriangle, Brain, Info } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useAiRecommendations,
  type AiRecommendation,
  type RecommendationSeverity,
  type RecommendationTab,
} from "@/lib/insights/queries";

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

  return (
    <Card className="p-5 border-stone-200 bg-white">
      <div className="flex items-start gap-4">
        <div className="h-11 w-11 rounded-xl bg-terracotta/10 flex items-center justify-center shrink-0">
          <Brain className="h-5 w-5 text-terracotta" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-serif text-lg text-ink">AI Recommendations</p>
            {generatedAt && (
              <span className="text-xs text-stone-500">
                Updated {new Date(generatedAt).toLocaleDateString()}
              </span>
            )}
            {headerAction && <div className="ml-auto">{headerAction}</div>}
          </div>

          {isLoading ? (
            <p className="text-sm text-stone-500 mt-1">Loading...</p>
          ) : recommendations.length === 0 ? (
            <p className="text-sm text-stone-500 mt-1 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" /> No recommendations yet — check back after
              tonight's analysis.
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
