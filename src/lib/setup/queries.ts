import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useRestaurantIds } from "@/lib/supabase/scope";

export type SetupStatus = {
  posConnected: boolean;
  menuImported: boolean;
  recipesDone: boolean;
  recipesSkipped: boolean;
  parDone: boolean;
  parSkipped: boolean;
  billingActive: boolean;
};

// Backed by get_setup_status() (db/phase3/50_setup_status.sql) — status
// is derived from real data (pos_credentials/menu_items/recipe_lines/
// par_levels/subscriptions), not from onboarding_progress alone, so an
// already-fully-set-up tenant never shows as "nothing done."
export function useSetupStatus() {
  const restaurantId = useRestaurantIds()[0];
  return useQuery({
    queryKey: ["setup-status", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<SetupStatus> => {
      const { data, error } = await supabase
        .rpc("get_setup_status", { p_restaurant_id: restaurantId! })
        .single();
      if (error) throw error;
      const row = data as {
        pos_connected: boolean;
        menu_imported: boolean;
        recipes_done: boolean;
        recipes_skipped: boolean;
        par_done: boolean;
        par_skipped: boolean;
        billing_active: boolean;
      };
      return {
        posConnected: row.pos_connected,
        menuImported: row.menu_imported,
        recipesDone: row.recipes_done,
        recipesSkipped: row.recipes_skipped,
        parDone: row.par_done,
        parSkipped: row.par_skipped,
        billingActive: row.billing_active,
      };
    },
  });
}

export type SkippableStep = "recipes" | "par";

// Direct table write, not an RPC — onboarding_progress already has
// full tenant-isolation RLS (db/phase3/30_billing_schema.sql), unlike
// subscriptions, so any member can record a skip without a
// security-definer function in between.
export function useSkipSetupStep() {
  const restaurantId = useRestaurantIds()[0];
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (step: SkippableStep) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { error } = await supabase
        .from("onboarding_progress")
        .upsert(
          { restaurant_id: restaurantId, step, status: "skipped" },
          { onConflict: "restaurant_id,step" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setup-status"] });
    },
  });
}
