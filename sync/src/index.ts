import {
  authenticate,
  fetchOrdersForDate,
  fetchMenus,
  fetchRevenueCenters,
  fetchEmployees,
  fetchJobs,
  fetchTimeEntriesForDate,
  findPriceTierModifier,
  type ToastOrder,
  type ToastEmployee,
  type ToastJob,
} from "./toast.js";
import {
  getToastCredentials,
  getSecret,
  upsertRawEvents,
  replacePmixForDate,
  upsertMenuItemPriceTiers,
  replacePmixByTierForDate,
  upsertMenuItems,
  upsertRevenueCenters,
  upsertLaborShifts,
  updateLastSyncedAt,
  type PosCredential,
  type LaborShiftRow,
  type PriceTierUpsert,
} from "./db.js";

// Time-and-a-half — US federal OT standard, matches WA state law (no
// CA-style daily-OT rules apply here). Not configurable in v1.
const OVERTIME_MULTIPLIER = 1.5;

// Employee wage override for the specific job worked, falling back to
// that job's default wage — mirrors how Toast itself resolves pay,
// and matches ingredient_cost_history's point-in-time-cost philosophy:
// the stored rate reflects what this person was actually paid for
// this shift, not whatever today's rate happens to be.
function resolveWageCents(
  employees: Map<string, ToastEmployee>,
  jobs: Map<string, ToastJob>,
  employeeRef: string | undefined,
  jobRef: string | undefined,
): number {
  const employee = employeeRef ? employees.get(employeeRef) : undefined;
  const override = jobRef
    ? employee?.wageOverrides?.find((w) => w.jobReference?.guid === jobRef)
    : undefined;
  if (override) return Math.round(override.wage * 100);
  const job = jobRef ? jobs.get(jobRef) : undefined;
  return Math.round((job?.defaultWage ?? 0) * 100);
}

const BACKFILL_DAYS = 30;

function toBusinessDateString(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function businessDatesBetween(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cursor <= last) {
    dates.push(toBusinessDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function aggregatePmix(orders: ToastOrder[]) {
  const map = new Map<string, { name: string; qty: number; netCents: number }>();
  for (const order of orders) {
    if (order.deleted || order.voided) continue;
    for (const check of order.checks ?? []) {
      if (check.deleted || check.voided) continue;
      for (const sel of check.selections ?? []) {
        if (sel.voided || sel.deleted) continue;
        const posId = sel.item?.guid ?? sel.guid;
        const cur = map.get(posId) ?? {
          name: sel.displayName ?? "Unknown Item",
          qty: 0,
          netCents: 0,
        };
        cur.qty += sel.quantity ?? 1;
        cur.netCents += Math.round((sel.price ?? 0) * 100);
        map.set(posId, cur);
      }
    }
  }
  return Array.from(map.entries()).map(([menuItemPosId, v]) => ({
    menuItemPosId,
    name: v.name,
    quantitySold: v.qty,
    netSalesCents: v.netCents,
  }));
}

// A second, more granular pass over the same orders — only for
// selections that actually carry a real price-tier modifier (see
// findPriceTierModifier). Deliberately separate from aggregatePmix
// rather than folded into it: the vast majority of items have no
// tiers at all, and this keeps that whole path untouched.
function aggregatePmixByTier(orders: ToastOrder[]) {
  const map = new Map<
    string,
    {
      menuItemPosId: string;
      toastModifierItemGuid: string;
      tierName: string;
      qty: number;
      netCents: number;
    }
  >();
  for (const order of orders) {
    if (order.deleted || order.voided) continue;
    for (const check of order.checks ?? []) {
      if (check.deleted || check.voided) continue;
      for (const sel of check.selections ?? []) {
        if (sel.voided || sel.deleted) continue;
        const tierMod = findPriceTierModifier(sel);
        const tierItemGuid = tierMod?.item?.guid;
        if (!tierItemGuid) continue;
        const posId = sel.item?.guid ?? sel.guid;
        const key = `${posId}::${tierItemGuid}`;
        const cur = map.get(key) ?? {
          menuItemPosId: posId,
          toastModifierItemGuid: tierItemGuid,
          tierName: tierMod.displayName ?? "Size",
          qty: 0,
          netCents: 0,
        };
        cur.qty += sel.quantity ?? 1;
        cur.netCents += Math.round((sel.price ?? 0) * 100);
        map.set(key, cur);
      }
    }
  }
  return Array.from(map.values());
}

async function syncCredential(cred: PosCredential) {
  console.log(`[toast-sync] ${cred.location_id}: starting`);
  const { clientId, clientSecret } = await getSecret(cred.vault_secret_name);
  const token = await authenticate(cred.api_hostname, clientId, clientSecret);

  const now = new Date();
  const start = cred.last_synced_at
    ? new Date(new Date(cred.last_synced_at).getTime() - 24 * 60 * 60 * 1000) // 1-day overlap buffer
    : new Date(now.getTime() - (BACKFILL_DAYS - 1) * 24 * 60 * 60 * 1000);

  const dates = businessDatesBetween(start, now);
  console.log(
    `[toast-sync] ${cred.location_id}: syncing ${dates.length} business date(s) from ${dates[0]} to ${dates[dates.length - 1]}`,
  );

  let totalOrders = 0;
  for (const businessDate of dates) {
    const orders = await fetchOrdersForDate(
      cred.api_hostname,
      token,
      cred.pos_location_ref,
      businessDate,
    );
    totalOrders += orders.length;

    await upsertRawEvents(
      cred,
      "order",
      orders.map((o) => ({
        posRef: o.guid,
        businessDate: `${businessDate.slice(0, 4)}-${businessDate.slice(4, 6)}-${businessDate.slice(6, 8)}`,
        payload: o,
      })),
    );

    const pmixRows = aggregatePmix(orders);
    await replacePmixForDate(cred, businessDate, pmixRows);

    const tierRows = aggregatePmixByTier(orders);
    if (tierRows.length > 0) {
      const tierUpserts: PriceTierUpsert[] = tierRows.map((r) => ({
        menuItemPosId: r.menuItemPosId,
        toastModifierItemGuid: r.toastModifierItemGuid,
        tierName: r.tierName,
        lastPriceCents: r.qty > 0 ? Math.round(r.netCents / r.qty) : null,
      }));
      const tierIdByKey = await upsertMenuItemPriceTiers(cred, tierUpserts);
      await replacePmixByTierForDate(
        cred,
        businessDate,
        tierRows.map((r) => ({
          menuItemPosId: r.menuItemPosId,
          priceTierId: tierIdByKey.get(`${r.menuItemPosId}::${r.toastModifierItemGuid}`)!,
          quantitySold: r.qty,
          netSalesCents: r.netCents,
        })),
      );
    }

    console.log(
      `[toast-sync] ${cred.location_id}: ${businessDate} — ${orders.length} orders, ${pmixRows.length} pmix rows, ${tierRows.length} tier rows`,
    );
    await new Promise((r) => setTimeout(r, 150));
  }

  try {
    const rawMenuItems = await fetchMenus(cred.api_hostname, token, cred.pos_location_ref);
    // Same item can appear on multiple menus (e.g. lunch + dinner) — dedupe
    // by posId so a single upsert never targets the same row twice.
    const menuItems = Array.from(new Map(rawMenuItems.map((i) => [i.posId, i])).values());
    await upsertMenuItems(cred, menuItems);
    await upsertRawEvents(cred, "menu", [
      { posRef: "current", businessDate: null, payload: menuItems },
    ]);
    console.log(`[toast-sync] ${cred.location_id}: ${menuItems.length} menu items synced`);
  } catch (e) {
    console.error(`[toast-sync] ${cred.location_id}: menu sync failed (non-fatal): ${e}`);
  }

  try {
    const revenueCenters = await fetchRevenueCenters(
      cred.api_hostname,
      token,
      cred.pos_location_ref,
    );
    await upsertRevenueCenters(cred, revenueCenters);
    console.log(
      `[toast-sync] ${cred.location_id}: ${revenueCenters.length} revenue centers synced`,
    );
  } catch (e) {
    console.error(`[toast-sync] ${cred.location_id}: revenue center sync failed (non-fatal): ${e}`);
  }

  try {
    // Roster + wage config fetched once per run, not once per date —
    // used only to resolve each shift's employee name/wage_cents.
    const [rawEmployees, rawJobs] = await Promise.all([
      fetchEmployees(cred.api_hostname, token, cred.pos_location_ref),
      fetchJobs(cred.api_hostname, token, cred.pos_location_ref),
    ]);
    const employees = new Map(rawEmployees.map((e) => [e.guid, e]));
    const jobs = new Map(rawJobs.map((j) => [j.guid, j]));

    let totalShifts = 0;
    for (const businessDate of dates) {
      const entries = await fetchTimeEntriesForDate(
        cred.api_hostname,
        token,
        cred.pos_location_ref,
        businessDate,
      );
      const rows: LaborShiftRow[] = entries
        .filter((entry) => !entry.deleted)
        .map((entry) => {
          const employee = entry.employeeReference
            ? employees.get(entry.employeeReference.guid)
            : undefined;
          const job = entry.jobReference ? jobs.get(entry.jobReference.guid) : undefined;
          const wageCents = resolveWageCents(
            employees,
            jobs,
            entry.employeeReference?.guid,
            entry.jobReference?.guid,
          );
          const regularHours = entry.regularHours ?? 0;
          const overtimeHours = entry.overtimeHours ?? 0;
          const laborCostCents = Math.round(
            regularHours * wageCents + overtimeHours * wageCents * OVERTIME_MULTIPLIER,
          );
          return {
            toastTimeEntryRef: entry.guid,
            employeeRef: entry.employeeReference?.guid ?? "unknown",
            employeeName: employee
              ? `${employee.firstName} ${employee.lastName}`.trim()
              : "Unknown employee",
            jobRef: entry.jobReference?.guid ?? null,
            jobTitle: job?.title ?? null,
            inAt: entry.inDate,
            outAt: entry.outDate ?? null,
            regularHours,
            overtimeHours,
            wageCents,
            laborCostCents,
          };
        });
      await upsertLaborShifts(cred, businessDate, rows);
      totalShifts += rows.length;
      await new Promise((r) => setTimeout(r, 150));
    }
    console.log(`[toast-sync] ${cred.location_id}: ${totalShifts} labor shifts synced`);
  } catch (e) {
    console.error(`[toast-sync] ${cred.location_id}: labor sync failed (non-fatal): ${e}`);
  }

  await updateLastSyncedAt(cred, now);
  console.log(`[toast-sync] ${cred.location_id}: done — ${totalOrders} orders total`);
}

async function main() {
  const credentials = await getToastCredentials();
  if (credentials.length === 0) {
    console.log("[toast-sync] no toast pos_credentials rows found — nothing to do");
    return;
  }
  for (const cred of credentials) {
    try {
      await syncCredential(cred);
    } catch (e) {
      // One location's failure shouldn't block the others.
      console.error(`[toast-sync] ${cred.location_id}: FAILED — ${e}`);
    }
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[toast-sync] fatal:", e);
    process.exit(1);
  },
);
