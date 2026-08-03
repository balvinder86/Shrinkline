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
          <p className="font-medium text-sm text-stone-900">{rec.headline}</p>
          <Badge variant="outline" className={style.badge}>
            {rec.severity}
          </Badge>
        </div>
        <p className="text-sm text-stone-600 mt-0.5">{rec.body}</p>
      </div>
    </div>
  );
}

// Same visual language as the "AI Agent strip" on the Inventory page
// (dark gradient card, Brain icon) — reads as one system rather than a
// bolted-on feature. Always renders (even empty), so the AI layer stays
// discoverable rather than only appearing once it has something to say.
export function AiRecommendationsPanel({ tab }: { tab: RecommendationTab }) {
  const { data, isLoading } = useAiRecommendations(tab);
  const recommendations = data ?? [];
  const generatedAt = recommendations[0]?.generated_at;

  return (
    <Card className="p-5 bg-gradient-to-br from-[hsl(var(--ink))] to-stone-800 text-cream border-0">
      <div className="flex items-start gap-4">
        <div className="h-11 w-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
          <Brain className="h-5 w-5 text-amber-200" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-serif text-lg text-stone-100">AI Recommendations</p>
            {generatedAt && (
              <span className="text-xs text-stone-400">
                Updated {new Date(generatedAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {isLoading ? (
            <p className="text-sm text-stone-300 mt-1">Loading...</p>
          ) : recommendations.length === 0 ? (
            <p className="text-sm text-stone-300 mt-1 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" /> No recommendations yet — check back after tonight's
              analysis.
            </p>
          ) : (
            <div className="bg-white rounded-lg mt-3 px-4 divide-y divide-stone-100">
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
