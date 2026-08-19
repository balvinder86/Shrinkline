import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useRestaurantIds } from "@/lib/supabase/scope";

export type Subscription = {
  status: string;
  planTier: "boh" | "full";
  quantity: number;
  currentPeriodEnd: string | null;
};

// subscriptions has a read-only RLS policy for tenant members
// (db/phase3/30_billing_schema.sql) — only the stripe-webhook service,
// running as service_role, ever writes it. Returns null both while
// genuinely unsubscribed and while the row hasn't landed yet right
// after a Checkout redirect (the webhook is typically fast, but isn't
// instant) — the caller can't tell those two apart from this alone,
// which is why BillingSection also reads the ?checkout= query param.
export function useSubscription() {
  const restaurantId = useRestaurantIds()[0];
  return useQuery({
    queryKey: ["subscription", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<Subscription | null> => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("status, plan_tier, quantity, current_period_end")
        .eq("restaurant_id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        status: data.status,
        planTier: data.plan_tier,
        quantity: data.quantity,
        currentPeriodEnd: data.current_period_end,
      };
    },
    // The mirror row only appears once Stripe's webhook fires, a few
    // seconds after a real subscription/quantity change — short
    // polling here (rather than a one-shot fetch) is what makes the
    // "Waiting for confirmation…" state on return from Checkout
    // resolve on its own instead of needing a manual refresh.
    refetchInterval: (query) => (query.state.data ? false : 3000),
  });
}

// Returns the Stripe Checkout Session URL to redirect the browser to.
// Never writes to `subscriptions` itself — see
// supabase/functions/create-checkout-session/index.ts's header comment
// for why that has to stay the webhook's job alone.
export function useCreateCheckoutSession() {
  const restaurantId = useRestaurantIds()[0];
  return useMutation({
    mutationFn: async ({ planTier }: { planTier: "boh" | "full" }): Promise<string> => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: { restaurant_id: restaurantId, plan_tier: planTier },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "request failed",
        );
      }
      return (data as { url: string }).url;
    },
  });
}

// Changes an existing subscription's tier — Checkout only handles
// brand-new subscriptions, this is the "Change plan" path for a
// restaurant that's already subscribed (see
// supabase/functions/update-subscription-plan/index.ts). Never writes
// to `subscriptions` itself, same single-writer-is-the-webhook rule.
export function useUpdateSubscriptionPlan() {
  const restaurantId = useRestaurantIds()[0];
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ planTier }: { planTier: "boh" | "full" }) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("update-subscription-plan", {
        body: { restaurant_id: restaurantId, plan_tier: planTier },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "request failed",
        );
      }
    },
    onSuccess: () => {
      // Best-effort — the real new plan_tier only lands a few seconds
      // later once Stripe's webhook actually fires, same reasoning as
      // useCreateLocation's quantity-sync invalidation.
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    },
  });
}
