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

export type GmailConnection = {
  connectedEmail: string;
  lastSyncedAt: string | null;
};

// null means "not connected yet" — same pattern as
// useSearchConsoleConnection in src/lib/seo/queries.ts. Direct RLS-
// scoped read, not an Edge Function call — email_ingestion_credentials
// already has a tenant_isolation policy allowing this.
export function useGmailConnection() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["gmail-connection", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<GmailConnection | null> => {
      const { data, error } = await supabase
        .from("email_ingestion_credentials")
        .select("connected_email, last_synced_at")
        .eq("restaurant_id", restaurantId!)
        .eq("provider", "gmail")
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { connectedEmail: data.connected_email, lastSyncedAt: data.last_synced_at };
    },
  });
}

// Calls connect-gmail-start to get a real Google consent URL, then does
// a full browser redirect — same shape as useConnectSearchConsole
// (src/lib/seo/queries.ts). Nothing to return on success; the callback
// Edge Function redirects back to /settings once done.
export function useConnectGmail() {
  const restaurantId = useCurrentRestaurantId();
  return useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("connect-gmail-start", {
        body: { restaurant_id: restaurantId },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ??
            error?.message ??
            "could not start connection",
        );
      }
      const { authUrl } = data as { authUrl: string };
      window.location.href = authUrl;
    },
  });
}
