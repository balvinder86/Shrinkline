import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

export const supabase = createClient(url, serviceRoleKey);

export type PosCredential = {
  restaurant_id: string;
  location_id: string;
  provider: string;
  pos_location_ref: string;
  vault_secret_name: string;
  api_hostname: string;
  last_synced_at: string | null;
};

export async function getToastCredentials(): Promise<PosCredential[]> {
  const { data, error } = await supabase
    .from("pos_credentials")
    .select(
      "restaurant_id, location_id, provider, pos_location_ref, vault_secret_name, api_hostname, last_synced_at",
    )
    .eq("provider", "toast");
  if (error) throw new Error(`load pos_credentials failed: ${error.message}`);
  return data ?? [];
}

export async function getSecret(
  vaultSecretName: string,
): Promise<{ clientId: string; clientSecret: string }> {
  const { data, error } = await supabase.rpc("get_pos_secret", { secret_name: vaultSecretName });
  if (error || !data)
    throw new Error(`vault secret '${vaultSecretName}' not found: ${error?.message ?? ""}`);
  const parsed = JSON.parse(data);
  if (!parsed.clientId || !parsed.clientSecret)
    throw new Error(`vault secret '${vaultSecretName}' missing clientId/clientSecret`);
  return parsed;
}

// A Square credential also needs the location's own timezone (Search
// Timecards' workday filter requires one, and Square orders don't
// carry an explicit "business date" the way Toast's do — the sync
// loop derives one from each order's closed_at using this).
export type SquareCredential = PosCredential & { timezone: string };

export async function getSquareCredentials(): Promise<SquareCredential[]> {
  const { data, error } = await supabase
    .from("pos_credentials")
    .select(
      "restaurant_id, location_id, provider, pos_location_ref, vault_secret_name, api_hostname, last_synced_at, locations (timezone)",
    )
    .eq("provider", "square");
  if (error) throw new Error(`load pos_credentials (square) failed: ${error.message}`);
  type Row = PosCredential & { locations: { timezone: string } | null };
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    restaurant_id: row.restaurant_id,
    location_id: row.location_id,
    provider: row.provider,
    pos_location_ref: row.pos_location_ref,
    vault_secret_name: row.vault_secret_name,
    api_hostname: row.api_hostname,
    last_synced_at: row.last_synced_at,
    timezone: row.locations?.timezone ?? "America/Chicago",
  }));
}

// Only the merchant-specific refresh token + merchant id live in
// Vault — the Square application's own client_id/client_secret
// (shared across every Square-connected tenant, since this is one
// registered Shrinkline OAuth app, not a per-tenant credential the
// way Toast's is) live in SQUARE_APPLICATION_ID/SECRET env vars
// instead, read directly where needed.
export async function getSquareSecret(
  vaultSecretName: string,
): Promise<{ refreshToken: string; merchantId: string }> {
  const { data, error } = await supabase.rpc("get_pos_secret", { secret_name: vaultSecretName });
  if (error || !data)
    throw new Error(`vault secret '${vaultSecretName}' not found: ${error?.message ?? ""}`);
  const parsed = JSON.parse(data);
  if (!parsed.refreshToken)
    throw new Error(`vault secret '${vaultSecretName}' missing refreshToken`);
  return parsed;
}

// Tenant identity ALWAYS comes from the credential row, never from the
// vendor payload — this is what keeps a bug in the API response from
// ever writing data under the wrong restaurant_id/location_id.
export async function upsertRawEvents(
  cred: PosCredential,
  eventType: "order" | "menu",
  rows: { posRef: string; businessDate: string | null; payload: unknown }[],
) {
  if (rows.length === 0) return;
  const fetchedAt = new Date().toISOString();
  const { error } = await supabase.from("pos_raw_events").upsert(
    rows.map((r) => ({
      restaurant_id: cred.restaurant_id,
      location_id: cred.location_id,
      provider: cred.provider,
      event_type: eventType,
      pos_ref: r.posRef,
      business_date: r.businessDate,
      payload: r.payload,
      fetched_at: fetchedAt,
    })),
    { onConflict: "location_id,provider,event_type,pos_ref" },
  );
  if (error) throw new Error(`upsert pos_raw_events failed: ${error.message}`);
}

export type PmixRow = {
  menuItemPosId: string;
  name: string;
  quantitySold: number;
  netSalesCents: number;
};

export async function replacePmixForDate(
  cred: PosCredential,
  businessDate: string,
  rows: PmixRow[],
) {
  const isoDate = `${businessDate.slice(0, 4)}-${businessDate.slice(4, 6)}-${businessDate.slice(6, 8)}`;
  if (rows.length === 0) return;
  const { error } = await supabase.from("pmix_sales").upsert(
    rows.map((r) => ({
      restaurant_id: cred.restaurant_id,
      location_id: cred.location_id,
      business_date: isoDate,
      menu_item_pos_id: r.menuItemPosId,
      name: r.name,
      quantity_sold: r.quantitySold,
      net_sales_cents: r.netSalesCents,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "location_id,business_date,menu_item_pos_id" },
  );
  if (error) throw new Error(`upsert pmix_sales failed: ${error.message}`);
}

export type PriceTierUpsert = {
  menuItemPosId: string;
  toastModifierItemGuid: string;
  tierName: string;
  lastPriceCents: number | null;
};

// Returns a lookup keyed by "menuItemPosId::toastModifierItemGuid" to
// each tier's stable row id, so replacePmixByTierForDate can attach
// its rows to the right tier without a second round trip.
export async function upsertMenuItemPriceTiers(
  cred: PosCredential,
  tiers: PriceTierUpsert[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (tiers.length === 0) return map;
  const { data, error } = await supabase
    .from("menu_item_price_tiers")
    .upsert(
      tiers.map((t) => ({
        restaurant_id: cred.restaurant_id,
        location_id: cred.location_id,
        menu_item_pos_id: t.menuItemPosId,
        toast_modifier_item_guid: t.toastModifierItemGuid,
        tier_name: t.tierName,
        last_price_cents: t.lastPriceCents,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "location_id,menu_item_pos_id,toast_modifier_item_guid" },
    )
    .select("id, menu_item_pos_id, toast_modifier_item_guid");
  if (error) throw new Error(`upsert menu_item_price_tiers failed: ${error.message}`);
  for (const row of data ?? []) {
    map.set(`${row.menu_item_pos_id}::${row.toast_modifier_item_guid}`, row.id);
  }
  return map;
}

export type PmixByTierRow = {
  menuItemPosId: string;
  priceTierId: string;
  quantitySold: number;
  netSalesCents: number;
};

export async function replacePmixByTierForDate(
  cred: PosCredential,
  businessDate: string,
  rows: PmixByTierRow[],
) {
  const isoDate = `${businessDate.slice(0, 4)}-${businessDate.slice(4, 6)}-${businessDate.slice(6, 8)}`;
  if (rows.length === 0) return;
  const { error } = await supabase.from("pmix_sales_by_tier").upsert(
    rows.map((r) => ({
      restaurant_id: cred.restaurant_id,
      location_id: cred.location_id,
      business_date: isoDate,
      menu_item_pos_id: r.menuItemPosId,
      price_tier_id: r.priceTierId,
      quantity_sold: r.quantitySold,
      net_sales_cents: r.netSalesCents,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "location_id,business_date,menu_item_pos_id,price_tier_id" },
  );
  if (error) throw new Error(`upsert pmix_sales_by_tier failed: ${error.message}`);
}

export async function upsertMenuItems(
  cred: PosCredential,
  items: {
    posId: string;
    name: string;
    category: string;
    priceCents: number | null;
    isStartingPrice: boolean;
  }[],
) {
  if (items.length === 0) return;
  const { error } = await supabase.from("menu_items").upsert(
    items.map((i) => ({
      restaurant_id: cred.restaurant_id,
      location_id: cred.location_id,
      pos_id: i.posId,
      name: i.name,
      category: i.category,
      price_cents: i.priceCents,
      price_is_starting_price: i.isStartingPrice,
      active: true,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "location_id,pos_id" },
  );
  if (error) throw new Error(`upsert menu_items failed: ${error.message}`);
}

export async function upsertRevenueCenters(
  cred: PosCredential,
  centers: { guid: string; name: string }[],
) {
  if (centers.length === 0) return;
  const { error } = await supabase.from("pos_revenue_centers").upsert(
    centers.map((c) => ({
      restaurant_id: cred.restaurant_id,
      location_id: cred.location_id,
      provider: cred.provider,
      pos_guid: c.guid,
      name: c.name,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "location_id,provider,pos_guid" },
  );
  if (error) throw new Error(`upsert pos_revenue_centers failed: ${error.message}`);
}

export type LaborShiftRow = {
  posTimeEntryRef: string;
  employeeRef: string;
  employeeName: string;
  jobRef: string | null;
  jobTitle: string | null;
  inAt: string;
  outAt: string | null;
  regularHours: number;
  overtimeHours: number;
  wageCents: number;
  laborCostCents: number;
};

export async function upsertLaborShifts(
  cred: PosCredential,
  businessDate: string,
  rows: LaborShiftRow[],
) {
  const isoDate = `${businessDate.slice(0, 4)}-${businessDate.slice(4, 6)}-${businessDate.slice(6, 8)}`;
  if (rows.length === 0) return;
  const { error } = await supabase.from("labor_shifts").upsert(
    rows.map((r) => ({
      restaurant_id: cred.restaurant_id,
      location_id: cred.location_id,
      business_date: isoDate,
      pos_time_entry_ref: r.posTimeEntryRef,
      employee_ref: r.employeeRef,
      employee_name: r.employeeName,
      job_ref: r.jobRef,
      job_title: r.jobTitle,
      in_at: r.inAt,
      out_at: r.outAt,
      regular_hours: r.regularHours,
      overtime_hours: r.overtimeHours,
      wage_cents: r.wageCents,
      labor_cost_cents: r.laborCostCents,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "location_id,pos_time_entry_ref" },
  );
  if (error) throw new Error(`upsert labor_shifts failed: ${error.message}`);
}

export async function updateLastSyncedAt(cred: PosCredential, at: Date) {
  const { error } = await supabase
    .from("pos_credentials")
    .update({ last_synced_at: at.toISOString() })
    .eq("location_id", cred.location_id)
    .eq("provider", cred.provider);
  if (error) throw new Error(`update last_synced_at failed: ${error.message}`);
}
