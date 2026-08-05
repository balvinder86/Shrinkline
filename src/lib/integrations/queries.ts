import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useLocationIds, useRestaurantIds } from "@/lib/supabase/scope";

function useCurrentRestaurantId(): string | undefined {
  return useRestaurantIds()[0];
}

// A user's dashboard today only ever shows one location — same
// simplification as useCurrentLocationId elsewhere in this codebase;
// revisit when multi-location restaurants are onboarded.
function useCurrentLocationId(): string | undefined {
  return useLocationIds().data?.[0];
}

async function callConnectToast<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("connect-toast", { body });
  if (error || !(data as { ok?: boolean } | null)?.ok) {
    throw new Error(
      (data as { error?: string } | null)?.error ?? error?.message ?? "request failed",
    );
  }
  return data as T;
}

export type ToastConnectionStatus = {
  connected: boolean;
  credential: {
    location_id: string;
    pos_location_ref: string;
    last_synced_at: string | null;
  } | null;
};

export function useToastConnection() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["toast-connection", restaurantId],
    enabled: !!restaurantId,
    queryFn: () =>
      callConnectToast<ToastConnectionStatus>({ action: "status", restaurant_id: restaurantId }),
  });
}

type ConnectToastInput = { clientId: string; clientSecret: string; posLocationRef: string };

export function useConnectToast() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ConnectToastInput) => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      return callConnectToast({
        action: "connect",
        restaurant_id: restaurantId,
        location_id: locationId,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        pos_location_ref: input.posLocationRef,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["toast-connection"] });
    },
  });
}
