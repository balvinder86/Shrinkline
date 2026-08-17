import { useCurrentRestaurant } from "@/lib/restaurant-context";
import { useCurrentLocation } from "@/lib/location-context";

// RLS already scopes every query to the signed-in user's own
// restaurants — this resolves which location_id(s) to filter on for
// the currently-*selected* location only (a restaurant can have more
// than one location; LocationProvider — src/lib/location-context.tsx —
// tracks which one is picked via the sidebar switcher). Every read
// query in the app that does `.in("location_id", locationIds)`, and
// every write hook's `useLocationIds().data?.[0]`, both flow through
// here — so switching locations re-scopes the whole dashboard from
// this one spot rather than needing every call site touched.
//
// Kept in this query-result shape (an object with `.data`) rather than
// returning the array directly, since every existing call site already
// destructures `{ data: locationIds } = useLocationIds()` — matching
// that shape meant zero changes were needed anywhere else in the app.
export function useLocationIds(): { data: string[] | undefined; isLoading: boolean } {
  const { currentRestaurantId } = useCurrentRestaurant();
  const { currentLocationId, isLoading } = useCurrentLocation();
  if (!currentRestaurantId) return { data: undefined, isLoading };
  return { data: currentLocationId ? [currentLocationId] : [], isLoading };
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
