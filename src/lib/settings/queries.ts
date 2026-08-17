import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useRestaurantIds } from "@/lib/supabase/scope";

// Renames the current restaurant. Requires db/phase2/68_restaurant_owner_update.sql
// (restaurants had a read-only RLS policy before that — no insert/
// update/delete for normal users at all, see db/phase0/01_schema.sql).
//
// An RLS USING clause that blocks an UPDATE doesn't error — Postgres
// just matches zero rows, and PostgREST returns 200 with an empty
// result, not a failure. Without .select() + a length check here,
// this would report "Saved" while silently changing nothing whenever
// the policy is missing or the caller isn't an owner — confirmed live
// against production before this check was added: the UI showed
// "Saved," but a fresh reload showed the old name untouched.
export function useUpdateRestaurantName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await supabase
        .from("restaurants")
        .update({ name })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(
          "Nothing was updated — you may not have owner access, or db/phase2/68_restaurant_owner_update.sql hasn't been applied yet.",
        );
      }
    },
    onSuccess: () => {
      // RestaurantProvider's own query key (src/lib/restaurant-context.tsx)
      // — invalidating it is what makes the new name show up in the
      // sidebar's restaurant switcher too, not just this page.
      queryClient.invalidateQueries({ queryKey: ["restaurant-names"] });
    },
  });
}

export type SettingsLocation = {
  id: string;
  name: string;
  timezone: string;
};

// locations already has a real read+write tenant_isolation RLS policy
// (db/phase0/01_schema.sql) — any member can edit a location's own
// name/timezone, no new migration needed for this one.
export function useLocationsForSettings() {
  const restaurantId = useRestaurantIds()[0];
  return useQuery({
    queryKey: ["settings-locations", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<SettingsLocation[]> => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name, timezone")
        .eq("restaurant_id", restaurantId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, timezone }: { id: string; name: string; timezone: string }) => {
      const { data, error } = await supabase
        .from("locations")
        .update({ name, timezone })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Nothing was updated — this location may not belong to your restaurant.");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings-locations"] }),
  });
}
