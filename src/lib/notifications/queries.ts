import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth-context";
import { useRestaurantIds } from "@/lib/supabase/scope";

function useCurrentRestaurantId(): string | undefined {
  return useRestaurantIds()[0];
}

export const NOTIFICATION_EVENT_KEYS = [
  "low_inventory",
  "new_review",
  "negative_review",
  "ai_recommendations",
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

// A missing row means "on" — db/phase2/77_notification_preferences.sql's
// own lazy-write convention: a row is only written once someone
// actually flips a toggle, same as other real Settings toggles in
// this app.
export function useNotificationPreferences() {
  const { user } = useAuth();
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["notification-preferences", user?.id, restaurantId],
    enabled: !!user?.id && !!restaurantId,
    queryFn: async (): Promise<Record<NotificationEventKey, boolean>> => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("event_key, email_enabled")
        .eq("user_id", user!.id)
        .eq("restaurant_id", restaurantId!);
      if (error) throw error;
      const byKey = new Map(data?.map((r) => [r.event_key, r.email_enabled]));
      return Object.fromEntries(
        NOTIFICATION_EVENT_KEYS.map((k) => [k, byKey.get(k) ?? true]),
      ) as Record<NotificationEventKey, boolean>;
    },
  });
}

export function useUpdateNotificationPreference() {
  const { user } = useAuth();
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      eventKey,
      enabled,
    }: {
      eventKey: NotificationEventKey;
      enabled: boolean;
    }) => {
      if (!user?.id || !restaurantId) throw new Error("no current user/restaurant");
      const { error } = await supabase.from("notification_preferences").upsert(
        {
          user_id: user.id,
          restaurant_id: restaurantId,
          event_key: eventKey,
          email_enabled: enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,restaurant_id,event_key" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
  });
}
