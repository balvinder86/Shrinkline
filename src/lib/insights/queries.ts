import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useLocationIds } from "@/lib/supabase/scope";

// A user's dashboard today only ever shows one location — same
// simplification as useCurrentLocationId in lib/boh/queries.ts.
function useCurrentLocationId(): string | undefined {
  return useLocationIds().data?.[0];
}

export type RecommendationTab = "food_cost" | "inventory" | "invoices" | "recipes";
export type RecommendationSeverity = "info" | "warning" | "critical";

export type AiRecommendation = {
  tab: RecommendationTab;
  severity: RecommendationSeverity;
  headline: string;
  body: string;
  business_date: string;
  generated_at: string;
};

// Written by the insights Railway service's nightly Batch API run — see
// insights/src/index.ts. Rows are upserted per (location_id, tab,
// business_date), so this always reflects the latest generated batch;
// there's no in-app generation, only reading what already ran.
export function useAiRecommendations(tab: RecommendationTab) {
  const locationId = useCurrentLocationId();
  return useQuery({
    queryKey: ["ai-recommendations", locationId, tab],
    enabled: !!locationId,
    queryFn: async (): Promise<AiRecommendation[]> => {
      const { data, error } = await supabase
        .from("ai_recommendations")
        .select("tab, severity, headline, body, business_date, generated_at")
        .eq("location_id", locationId!)
        .eq("tab", tab)
        .order("business_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
