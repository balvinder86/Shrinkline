import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth-context";

const STORAGE_KEY = "thrashers-restaurant-id";

function readStoredRestaurantId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export type RestaurantOption = {
  id: string;
  name: string;
  role: "owner" | "manager" | "staff";
};

const RestaurantContext = createContext<{
  restaurants: RestaurantOption[];
  currentRestaurantId: string | null;
  currentRestaurant: RestaurantOption | null;
  setCurrentRestaurantId: (id: string) => void;
} | null>(null);

// One shared "which restaurant am I looking at" selection for the
// whole app, persisted to localStorage — same shape as
// LanguageProvider (src/lib/i18n/language-context.tsx). Needed the
// moment a user has more than one real membership (a multi-location
// owner): src/lib/supabase/scope.ts's useRestaurantIds()/useLocationIds()
// scope every data query off currentRestaurantId here — without this
// provider they used to return every restaurant the user belongs to,
// unfiltered, which would silently blend two restaurants' data into
// one view the moment a second real membership existed.
export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { memberships } = useAuth();
  const restaurantIds = useMemo(() => memberships.map((m) => m.restaurant_id), [memberships]);

  // Real restaurant names — no client-side query against `restaurants`
  // existed anywhere in the app before this (confirmed via repo-wide
  // grep); everything downstream only ever dealt in restaurant_id.
  const { data: names } = useQuery({
    queryKey: ["restaurant-names", restaurantIds],
    enabled: restaurantIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name")
        .in("id", restaurantIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const restaurants = useMemo<RestaurantOption[]>(() => {
    const nameById = new Map((names ?? []).map((r) => [r.id, r.name as string]));
    return memberships.map((m) => ({
      id: m.restaurant_id,
      name: nameById.get(m.restaurant_id) ?? "…",
      role: m.role,
    }));
  }, [memberships, names]);

  // Starts null (not read from localStorage directly) so a stale ID
  // from a previous session/user on a shared browser is never used
  // before it's validated against this user's real memberships.
  const [currentRestaurantId, setCurrentRestaurantIdState] = useState<string | null>(null);

  useEffect(() => {
    if (restaurantIds.length === 0) {
      setCurrentRestaurantIdState(null);
      return;
    }
    setCurrentRestaurantIdState((prev) => {
      if (prev && restaurantIds.includes(prev)) return prev;
      const stored = readStoredRestaurantId();
      return stored && restaurantIds.includes(stored) ? stored : restaurantIds[0];
    });
  }, [restaurantIds]);

  const setCurrentRestaurantId = (id: string) => {
    setCurrentRestaurantIdState(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  };

  const currentRestaurant = restaurants.find((r) => r.id === currentRestaurantId) ?? null;

  return (
    <RestaurantContext.Provider
      value={{ restaurants, currentRestaurantId, currentRestaurant, setCurrentRestaurantId }}
    >
      {children}
    </RestaurantContext.Provider>
  );
}

export function useCurrentRestaurant() {
  const ctx = useContext(RestaurantContext);
  if (!ctx) throw new Error("useCurrentRestaurant must be used within a RestaurantProvider");
  return ctx;
}
