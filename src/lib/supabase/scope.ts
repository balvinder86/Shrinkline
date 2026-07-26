import { useQuery } from "@tanstack/react-query";

import { supabase } from "./client";
import { useCurrentRestaurant } from "@/lib/restaurant-context";

// RLS already scopes every query to the signed-in user's own
// restaurants — this resolves which location_id(s) to filter on for
// the currently-*selected* restaurant only (a restaurant can have more
// than one location, but a user with memberships in multiple
// restaurants should only ever see one restaurant's data at a time —
// see src/lib/restaurant-context.tsx for the selection itself).
export function useLocationIds() {
  const { currentRestaurantId } = useCurrentRestaurant();
  return useQuery({
    queryKey: ["locations", currentRestaurantId],
    enabled: !!currentRestaurantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id")
        .eq("restaurant_id", currentRestaurantId!);
      if (error) throw error;
      return (data ?? []).map((l) => l.id as string);
    },
  });
}

// Single-element array (or empty while the selection is still
// resolving) — kept as an array, not a plain string, so every existing
// `[0]`-indexing call site and every `.in("restaurant_id", ...)`-style
// call site keeps working unchanged now that this scopes to one
// selected restaurant instead of every restaurant the user belongs to.
export function useRestaurantIds(): string[] {
  const { currentRestaurantId } = useCurrentRestaurant();
  return currentRestaurantId ? [currentRestaurantId] : [];
}
