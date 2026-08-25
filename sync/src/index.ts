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
  refreshAccessToken,
  fetchOrdersForRange,
  fetchCatalogItems,
  fetchTeamMembers,
  fetchTimecardsForRange,
  type SquareOrder,
  type SquareTeamMember,
} from "./square.js";
import {
  getToastCredentials,
  getSecret,
  getSquareCredentials,
  getSquareSecret,
  upsertRawEvents,
  replacePmixForDate,
  upsertMenuItemPriceTiers,
  replacePmixByTierForDate,
  upsertMenuItems,
  upsertRevenueCenters,
  upsertLaborShifts,
  updateLastSyncedAt,
  type PosCredential,
  type SquareCredential,
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

async function syncToastCredential(cred: PosCredential) {
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
            posTimeEntryRef: entry.guid,
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

const SQUARE_APPLICATION_ID = process.env.SQUARE_APPLICATION_ID ?? "";
const SQUARE_APPLICATION_SECRET = process.env.SQUARE_APPLICATION_SECRET ?? "";

// Square doesn't stamp orders/timecards with an explicit "business
// date" the way Toast does — this derives one from a real timestamp
// in the location's own timezone, matching the yyyymmdd convention
// businessDatesBetween/toBusinessDateString already use above.
function businessDateInTimezone(iso: string, timezone: string): string {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return formatted.replace(/-/g, "");
}

function toHyphenatedDate(businessDate: string): string {
  return `${businessDate.slice(0, 4)}-${businessDate.slice(4, 6)}-${businessDate.slice(6, 8)}`;
}

// Buckets completed orders' line items by business date and menu
// item — same reduction aggregatePmix does for Toast, adapted to
// Square's field names (quantity is a string, total_money.amount is
// already in cents) and to Square orders spanning a real date range
// in one call instead of one-day-at-a-time.
function aggregateSquarePmixByDate(orders: SquareOrder[], timezone: string) {
  const byDate = new Map<string, Map<string, { name: string; qty: number; netCents: number }>>();
  for (const order of orders) {
    if (order.state !== "COMPLETED") continue;
    const stamp = order.closed_at ?? order.created_at;
    if (!stamp) continue;
    const businessDate = businessDateInTimezone(stamp, timezone);
    const itemMap = byDate.get(businessDate) ?? new Map();
    for (const line of order.line_items ?? []) {
      const posId = line.catalog_object_id;
      if (!posId) continue;
      const cur = itemMap.get(posId) ?? { name: line.name ?? "Unknown Item", qty: 0, netCents: 0 };
      cur.qty += Number(line.quantity ?? "1");
      cur.netCents += line.total_money?.amount ?? 0;
      itemMap.set(posId, cur);
    }
    byDate.set(businessDate, itemMap);
  }
  return byDate;
}

async function syncSquareCredential(cred: SquareCredential) {
  console.log(`[square-sync] ${cred.location_id}: starting`);
  if (!SQUARE_APPLICATION_ID || !SQUARE_APPLICATION_SECRET) {
    throw new Error("SQUARE_APPLICATION_ID/SQUARE_APPLICATION_SECRET must be set");
  }
  const { refreshToken } = await getSquareSecret(cred.vault_secret_name);
  const { accessToken: token } = await refreshAccessToken(
    cred.api_hostname,
    SQUARE_APPLICATION_ID,
    SQUARE_APPLICATION_SECRET,
    refreshToken,
  );

  const now = new Date();
  const start = cred.last_synced_at
    ? new Date(new Date(cred.last_synced_at).getTime() - 24 * 60 * 60 * 1000) // 1-day overlap buffer
    : new Date(now.getTime() - (BACKFILL_DAYS - 1) * 24 * 60 * 60 * 1000);

  let totalOrders = 0;
  try {
    const orders = await fetchOrdersForRange(
      cred.api_hostname,
      token,
      cred.pos_location_ref,
      start.toISOString(),
      now.toISOString(),
    );
    totalOrders = orders.length;

    await upsertRawEvents(
      cred,
      "order",
      orders.map((o) => ({
        posRef: o.id,
        businessDate: o.closed_at ? o.closed_at.slice(0, 10) : null,
        payload: o,
      })),
    );

    const byDate = aggregateSquarePmixByDate(orders, cred.timezone);
    for (const [businessDate, itemMap] of byDate) {
      const pmixRows = Array.from(itemMap.entries()).map(([menuItemPosId, v]) => ({
        menuItemPosId,
        name: v.name,
        quantitySold: v.qty,
        netSalesCents: v.netCents,
      }));
      await replacePmixForDate(cred, businessDate, pmixRows);
    }
    console.log(
      `[square-sync] ${cred.location_id}: ${totalOrders} orders across ${byDate.size} business date(s)`,
    );
  } catch (e) {
    console.error(`[square-sync] ${cred.location_id}: order sync failed (non-fatal): ${e}`);
  }

  try {
    const menuItems = await fetchCatalogItems(cred.api_hostname, token);
    await upsertMenuItems(cred, menuItems);
    await upsertRawEvents(cred, "menu", [
      { posRef: "current", businessDate: null, payload: menuItems },
    ]);
    console.log(`[square-sync] ${cred.location_id}: ${menuItems.length} menu items synced`);
  } catch (e) {
    console.error(`[square-sync] ${cred.location_id}: menu sync failed (non-fatal): ${e}`);
  }

  // No revenue-center sync — Square has no equivalent concept (no
  // physical-area grouping the way Toast's revenue centers are).
  // Channel Mix is left genuinely empty for Square locations rather
  // than mapping something conceptually different (ordering channel)
  // into the same field — confirmed with the tenant-owner.

  try {
    const [teamMembers, timecards] = await Promise.all([
      fetchTeamMembers(cred.api_hostname, token, cred.pos_location_ref),
      fetchTimecardsForRange(
        cred.api_hostname,
        token,
        cred.pos_location_ref,
        toHyphenatedDate(businessDateInTimezone(start.toISOString(), cred.timezone)),
        toHyphenatedDate(businessDateInTimezone(now.toISOString(), cred.timezone)),
        cred.timezone,
      ),
    ]);
    const teamMemberById = new Map<string, SquareTeamMember>(teamMembers.map((t) => [t.id, t]));

    const rowsByDate = new Map<string, LaborShiftRow[]>();
    for (const tc of timecards) {
      const businessDate = businessDateInTimezone(tc.start_at, cred.timezone);
      const member = teamMemberById.get(tc.team_member_id);
      const wageCents = tc.wage?.hourly_rate?.amount ?? 0;
      // v1 simplification, confirmed with the tenant-owner: Square's
      // timecards don't come pre-split into regular/overtime hours
      // the way Toast's time entries do, and computing a correct
      // weekly split ourselves is real, non-trivial aggregation
      // (tricky at week boundaries during incremental syncs). Every
      // worked hour (minus real unpaid break time, which Square does
      // give per-timecard) is stored as regular for now, rather than
      // guessing at a weekly split.
      let regularHours = 0;
      if (tc.end_at) {
        const workedMs = new Date(tc.end_at).getTime() - new Date(tc.start_at).getTime();
        const unpaidBreakMs = (tc.breaks ?? [])
          .filter((b) => b.is_paid === false && b.start_at && b.end_at)
          .reduce(
            (sum, b) => sum + (new Date(b.end_at!).getTime() - new Date(b.start_at!).getTime()),
            0,
          );
        regularHours = Math.max(0, (workedMs - unpaidBreakMs) / 3_600_000);
      }
      const row: LaborShiftRow = {
        posTimeEntryRef: tc.id,
        employeeRef: tc.team_member_id,
        employeeName: member
          ? `${member.given_name ?? ""} ${member.family_name ?? ""}`.trim() || "Unknown employee"
          : "Unknown employee",
        jobRef: null,
        jobTitle: tc.wage?.title ?? null,
        inAt: tc.start_at,
        outAt: tc.end_at ?? null,
        regularHours,
        overtimeHours: 0,
        wageCents,
        laborCostCents: Math.round(regularHours * wageCents),
      };
      const list = rowsByDate.get(businessDate) ?? [];
      list.push(row);
      rowsByDate.set(businessDate, list);
    }
    let totalShifts = 0;
    for (const [businessDate, rows] of rowsByDate) {
      await upsertLaborShifts(cred, businessDate, rows);
      totalShifts += rows.length;
    }
    console.log(`[square-sync] ${cred.location_id}: ${totalShifts} labor shifts synced`);
  } catch (e) {
    console.error(`[square-sync] ${cred.location_id}: labor sync failed (non-fatal): ${e}`);
  }

  await updateLastSyncedAt(cred, now);
  console.log(`[square-sync] ${cred.location_id}: done — ${totalOrders} orders total`);
}

async function main() {
  const [toastCredentials, squareCredentials] = await Promise.all([
    getToastCredentials(),
    getSquareCredentials(),
  ]);
  if (toastCredentials.length === 0 && squareCredentials.length === 0) {
    console.log("[sync] no pos_credentials rows found — nothing to do");
    return;
  }
  for (const cred of toastCredentials) {
    try {
      await syncToastCredential(cred);
    } catch (e) {
      // One location's failure shouldn't block the others.
      console.error(`[toast-sync] ${cred.location_id}: FAILED — ${e}`);
    }
  }
  for (const cred of squareCredentials) {
    try {
      await syncSquareCredential(cred);
    } catch (e) {
      console.error(`[square-sync] ${cred.location_id}: FAILED — ${e}`);
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
