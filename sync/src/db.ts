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

export async function upsertMenuItems(
  cred: PosCredential,
  items: { posId: string; name: string; category: string; priceCents: number | null }[],
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
  toastTimeEntryRef: string;
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
      toast_time_entry_ref: r.toastTimeEntryRef,
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
    { onConflict: "location_id,toast_time_entry_ref" },
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
