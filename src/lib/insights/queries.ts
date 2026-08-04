import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useLocationIds, useRestaurantIds } from "@/lib/supabase/scope";

// A user's dashboard today only ever shows one location — same
// simplification as useCurrentLocationId in lib/boh/queries.ts.
function useCurrentLocationId(): string | undefined {
  return useLocationIds().data?.[0];
}

// Same simplification as useCurrentRestaurantId in lib/boh/queries.ts.
function useCurrentRestaurantId(): string | undefined {
  return useRestaurantIds()[0];
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
// insights/src/index.ts. There's no in-app generation, only reading what
// already ran. Rows accumulate one business_date's worth per day (a tab
// can have more than one recommendation per day — see
// db/phase2/55_ai_recommendations_multi_per_tab.sql) — filter to the
// latest business_date present so yesterday's recommendations don't
// keep piling up alongside today's once more than one day exists.
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
      const rows = data ?? [];
      const latestDate = rows[0]?.business_date;
      return rows.filter((r) => r.business_date === latestDate);
    },
  });
}

export type AiInsightsSettings = {
  invoiceDriftThresholdPct: number;
};

// insights/src/invoiceDrift.ts reads this same table (falling back to
// the same 10% default) at batch time — see
// db/phase2/56_ai_insights_settings.sql.
export function useAiInsightsSettings() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["ai-insights-settings", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<AiInsightsSettings> => {
      const { data, error } = await supabase
        .from("ai_insights_settings")
        .select("invoice_drift_threshold_pct")
        .eq("restaurant_id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      return { invoiceDriftThresholdPct: data?.invoice_drift_threshold_pct ?? 10 };
    },
  });
}

export function useUpdateInvoiceDriftThreshold() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (thresholdPct: number) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { error } = await supabase
        .from("ai_insights_settings")
        .upsert(
          { restaurant_id: restaurantId, invoice_drift_threshold_pct: thresholdPct },
          { onConflict: "restaurant_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-insights-settings"] });
    },
  });
}
