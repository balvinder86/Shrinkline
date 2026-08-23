import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth-context";

// Creates a brand-new restaurant ("brand"), its owner membership, and
// its first location in one atomic call — see
// db/phase2/70_create_restaurant.sql for why this is a security-
// definer RPC rather than a raw client-side insert.
//
// memberships (src/lib/supabase/auth-context.tsx) only refetches on
// session change, so without refetchMemberships() the new restaurant
// wouldn't show up in RestaurantProvider's switcher until a reload.
export function useCreateRestaurant() {
  const { refetchMemberships } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      locationName,
      locationTimezone,
    }: {
      name: string;
      locationName: string;
      locationTimezone: string;
    }): Promise<string> => {
      const { data, error } = await supabase.rpc("create_restaurant", {
        p_name: name,
        p_location_name: locationName,
        p_location_timezone: locationTimezone,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async () => {
      await refetchMemberships();
      // RestaurantProvider's own query key (src/lib/restaurant-context.tsx)
      // — its queryKey already includes restaurantIds, which changes
      // the instant memberships updates above, so this just makes sure
      // any already-cached copy under the old id list doesn't linger.
      queryClient.invalidateQueries({ queryKey: ["restaurant-names"] });
    },
  });
}

// Real, self-serve hard delete — see
// supabase/functions/delete-restaurant/index.ts for why this has to be
// an edge function (cancelling any active Stripe subscription needs
// the secret key, which never reaches the client) rather than a plain
// client-side delete against `restaurants`.
export function useDeleteRestaurant() {
  const { refetchMemberships } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (restaurantId: string) => {
      const { data, error } = await supabase.functions.invoke("delete-restaurant", {
        body: { restaurant_id: restaurantId },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "request failed",
        );
      }
    },
    onSuccess: async () => {
      // Same reasoning as useCreateRestaurant — memberships only
      // refetches on session change, and RestaurantProvider's
      // currentRestaurantId self-heals to whatever's left once
      // restaurantIds (derived from memberships) drops the deleted one.
      await refetchMemberships();
      queryClient.invalidateQueries({ queryKey: ["restaurant-names"] });
      queryClient.invalidateQueries({ queryKey: ["brands-overview"] });
    },
  });
}

export type BrandOverview = {
  id: string;
  name: string;
  role: "owner" | "manager" | "staff";
  locations: { id: string; name: string; timezone: string }[];
};

// Every restaurant the user belongs to, with its full location list —
// deliberately a separate query from RestaurantProvider's (which stays
// lean: id/name only, fetched on every page load) since this is only
// needed on the Brands overview page.
export function useBrandsOverview() {
  const { memberships } = useAuth();
  const restaurantIds = useMemo(() => memberships.map((m) => m.restaurant_id), [memberships]);

  return useQuery({
    queryKey: ["brands-overview", restaurantIds],
    enabled: restaurantIds.length > 0,
    queryFn: async (): Promise<BrandOverview[]> => {
      const [restaurantsRes, locationsRes] = await Promise.all([
        supabase.from("restaurants").select("id, name").in("id", restaurantIds),
        supabase
          .from("locations")
          .select("id, name, timezone, restaurant_id")
          .in("restaurant_id", restaurantIds)
          .order("name"),
      ]);
      if (restaurantsRes.error) throw restaurantsRes.error;
      if (locationsRes.error) throw locationsRes.error;

      const roleByRestaurant = new Map(memberships.map((m) => [m.restaurant_id, m.role]));
      const locationsByRestaurant = new Map<
        string,
        { id: string; name: string; timezone: string }[]
      >();
      for (const loc of locationsRes.data ?? []) {
        const list = locationsByRestaurant.get(loc.restaurant_id) ?? [];
        list.push({ id: loc.id, name: loc.name, timezone: loc.timezone });
        locationsByRestaurant.set(loc.restaurant_id, list);
      }

      return (restaurantsRes.data ?? [])
        .map((r) => ({
          id: r.id,
          name: r.name,
          role: roleByRestaurant.get(r.id) ?? "staff",
          locations: locationsByRestaurant.get(r.id) ?? [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}
