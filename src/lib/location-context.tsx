import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useCurrentRestaurant } from "@/lib/restaurant-context";

const STORAGE_KEY = "thrashers-location-id";

function readStoredLocationId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export type LocationOption = {
  id: string;
  name: string;
};

const LocationContext = createContext<{
  locations: LocationOption[];
  currentLocationId: string | null;
  currentLocation: LocationOption | null;
  setCurrentLocationId: (id: string) => void;
  isLoading: boolean;
} | null>(null);

// Same shape as RestaurantProvider (src/lib/restaurant-context.tsx), one
// level down: a restaurant can have more than one location, and every
// data query/mutation in the app should only ever touch one location at
// a time (src/lib/supabase/scope.ts's useLocationIds() reads this
// selection) — otherwise switching restaurants or locations wouldn't
// actually change what's on screen.
export function LocationProvider({ children }: { children: ReactNode }) {
  const { currentRestaurantId } = useCurrentRestaurant();

  const { data: locations, isLoading } = useQuery({
    queryKey: ["locations-for-switcher", currentRestaurantId],
    enabled: !!currentRestaurantId,
    queryFn: async (): Promise<LocationOption[]> => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name")
        .eq("restaurant_id", currentRestaurantId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const locationList = useMemo(() => locations ?? [], [locations]);

  // Starts null, same reasoning as RestaurantProvider's
  // currentRestaurantId: never trust a stored id before it's checked
  // against this restaurant's real locations (a stale id from a
  // previously-selected restaurant, or one that's since been renamed
  // away, should never silently stick).
  const [currentLocationId, setCurrentLocationIdState] = useState<string | null>(null);

  useEffect(() => {
    if (locationList.length === 0) {
      setCurrentLocationIdState(null);
      return;
    }
    setCurrentLocationIdState((prev) => {
      if (prev && locationList.some((l) => l.id === prev)) return prev;
      const stored = readStoredLocationId();
      return stored && locationList.some((l) => l.id === stored) ? stored : locationList[0].id;
    });
  }, [locationList]);

  const setCurrentLocationId = (id: string) => {
    setCurrentLocationIdState(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  };

  const currentLocation = locationList.find((l) => l.id === currentLocationId) ?? null;

  return (
    <LocationContext.Provider
      value={{
        locations: locationList,
        currentLocationId,
        currentLocation,
        setCurrentLocationId,
        isLoading,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useCurrentLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useCurrentLocation must be used within a LocationProvider");
  return ctx;
}
