import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

// service_role — bypasses RLS, same as every other Railway service in
// this repo (ocr, sync, email-ingest). subscriptions' own RLS policy
// (db/phase3/30_billing_schema.sql) only grants tenant members SELECT,
// specifically so this is the only writer.
export const supabase = createClient(url, serviceRoleKey);

export async function upsertSubscriptionFromEvent(params: {
  restaurantId: string;
  stripeSubscriptionId: string;
  status: string;
  planTier: "boh" | "full";
  quantity: number;
  currentPeriodEnd: string | null;
}) {
  const { error } = await supabase.from("subscriptions").upsert(
    {
      restaurant_id: params.restaurantId,
      stripe_subscription_id: params.stripeSubscriptionId,
      status: params.status,
      plan_tier: params.planTier,
      quantity: params.quantity,
      current_period_end: params.currentPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    // Conflict on restaurant_id, not stripe_subscription_id — the
    // schema's real identity constraint is "one mirror row per
    // restaurant" (unique(restaurant_id)); if a restaurant ever
    // cancels and re-subscribes under a new Stripe subscription id,
    // this still correctly overwrites their one row instead of
    // erroring or leaving a stale duplicate behind.
    { onConflict: "restaurant_id" },
  );
  if (error) throw new Error(`upsert subscriptions failed: ${error.message}`);
}

// invoice.payment_failed's event object is a Stripe Invoice, not a
// Subscription — it has no restaurant_id metadata of its own, only the
// Stripe subscription id it belongs to. The row is guaranteed to
// already exist (a payment can't fail on a subscription that was never
// created), so this updates by stripe_subscription_id directly rather
// than needing to look up the restaurant first.
export async function markPastDueBySubscriptionId(stripeSubscriptionId: string) {
  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", stripeSubscriptionId);
  if (error) throw new Error(`mark past_due failed: ${error.message}`);
}
