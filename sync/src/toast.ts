// Toast POS client — pure reader. Auth + orders + menus against the
// real Toast API shape (confirmed against doc.toasttab.com, not guessed).

export type ToastOrder = {
  guid: string;
  businessDate: number; // yyyymmdd
  deleted?: boolean;
  voided?: boolean;
  checks?: ToastCheck[];
};

export type ToastCheck = {
  guid: string;
  deleted?: boolean;
  voided?: boolean;
  selections?: ToastSelection[];
};

export type ToastSelection = {
  guid: string;
  displayName?: string;
  quantity?: number;
  price?: number;
  voided?: boolean;
  deleted?: boolean;
  item?: { guid: string };
  modifiers?: ToastModifierSelection[];
};

// A selection's own chosen modifiers — e.g. a size ("BTL"/"PINT"/
// "PITCHER") or a flavor ("Reposado"). Confirmed against a real, live
// order payload: `optionGroupPricingMode === "REPLACES_PRICE"` is
// Toast's own signal that a modifier is the one setting the real
// price (a size choice), as opposed to a $0 descriptive one (a flavor
// choice) — both can appear in the same selection's modifiers array.
export type ToastModifierSelection = {
  guid: string;
  displayName?: string;
  price?: number | null;
  optionGroupPricingMode?: string;
  voided?: boolean;
  deleted?: boolean;
  item?: { guid: string };
};

export type ToastMenuItemFlat = {
  posId: string;
  name: string;
  category: string;
  priceCents: number | null;
  // True when priceCents was resolved from a "size" modifier group's
  // cheapest option (e.g. a well pour priced Single/Double, no single
  // fixed price) rather than the item's own fixed price — the item
  // genuinely has more than one real price, and priceCents is the
  // cheapest of them, not the only one.
  isStartingPrice: boolean;
};

export type ToastRevenueCenter = {
  guid: string;
  name: string;
};

// Labor API shapes — confirmed against a real, live response from
// this restaurant's actual Toast account before writing any of this
// (GET /labor/v1/employees, /labor/v1/jobs, /labor/v1/timeEntries all
// returned real 200s), not guessed from docs alone.
export type ToastJobReference = { guid: string };

export type ToastEmployee = {
  guid: string;
  firstName: string;
  lastName: string;
  deleted?: boolean;
  wageOverrides?: { wage: number; jobReference: ToastJobReference }[];
};

export type ToastJob = {
  guid: string;
  title: string;
  defaultWage: number;
  deleted?: boolean;
};

export type ToastTimeEntry = {
  guid: string;
  deleted?: boolean;
  employeeReference?: ToastJobReference;
  jobReference?: ToastJobReference;
  inDate: string;
  outDate?: string | null;
  regularHours?: number;
  overtimeHours?: number;
};

async function toastFetch(
  hostname: string,
  path: string,
  token: string,
  restaurantExternalId: string,
) {
  const res = await fetch(`${hostname}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Toast-Restaurant-External-ID": restaurantExternalId,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Toast GET ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function authenticate(
  hostname: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch(`${hostname}/authentication/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret, userAccessType: "TOAST_MACHINE_CLIENT" }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.token?.accessToken) {
    throw new Error(`Toast auth failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.token.accessToken as string;
}

// Pages through ordersBulk for a single business date until exhausted.
export async function fetchOrdersForDate(
  hostname: string,
  token: string,
  restaurantExternalId: string,
  businessDate: string, // yyyymmdd
): Promise<ToastOrder[]> {
  const pageSize = 100;
  const all: ToastOrder[] = [];
  for (let page = 1; ; page++) {
    const orders: ToastOrder[] = await toastFetch(
      hostname,
      `/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=${pageSize}&page=${page}`,
      token,
      restaurantExternalId,
    );
    all.push(...orders);
    if (orders.length < pageSize) break;
    await new Promise((r) => setTimeout(r, 150)); // be gentle on Toast's rate limits
  }
  return all;
}

type ToastModifierGroupRef = {
  guid: string;
  modifierOptionReferences?: number[];
};

type ToastModifierOptionRef = {
  guid: string;
  price: number | null;
};

// Resolves the real, current cheapest price for an item priced via a
// Toast "size" modifier group (well-pour liquor: Single/Double, rail
// vs. call, etc.) instead of a single fixed price. Reads live menu
// configuration — not historical sales — so it's immune to happy-hour
// pricing, comps, and tax-inclusive/exclusive noise in the order data,
// all of which showed up as false "cheapest price" signals when this
// was first tried from pmix_sales history instead.
function resolveSizePriceCents(
  item: any,
  modifierGroups: Record<string, ToastModifierGroupRef>,
  modifierOptions: Record<string, ToastModifierOptionRef>,
): number | null {
  if (item.pricingStrategy !== "SIZE_PRICE") return null;
  const sizeGuid: string | null | undefined = item.pricingRules?.sizeSpecificPricingGuid;
  if (!sizeGuid) return null;
  const groupRefIds: number[] = item.modifierGroupReferences ?? [];
  const sizeGroup = groupRefIds
    .map((id) => modifierGroups[String(id)])
    .find((g) => g?.guid === sizeGuid);
  if (!sizeGroup) return null;
  let minPriceDollars: number | null = null;
  for (const optId of sizeGroup.modifierOptionReferences ?? []) {
    const opt = modifierOptions[String(optId)];
    if (typeof opt?.price === "number") {
      minPriceDollars = minPriceDollars == null ? opt.price : Math.min(minPriceDollars, opt.price);
    }
  }
  return minPriceDollars != null ? Math.round(minPriceDollars * 100) : null;
}

// The modifier (if any) that actually determines a selection's real
// served size/price — see ToastModifierSelection's comment. Ignores
// voided/deleted modifiers and any that don't carry their own item
// guid (that guid is the stable tier identity, since a tier can be
// renamed on Toast's side without changing it).
export function findPriceTierModifier(sel: ToastSelection): ToastModifierSelection | undefined {
  return (sel.modifiers ?? []).find(
    (m) => !m.voided && !m.deleted && m.optionGroupPricingMode === "REPLACES_PRICE" && m.item?.guid,
  );
}

function flattenMenuGroup(
  group: any,
  category: string,
  out: ToastMenuItemFlat[],
  modifierGroups: Record<string, ToastModifierGroupRef>,
  modifierOptions: Record<string, ToastModifierOptionRef>,
) {
  for (const item of group.menuItems ?? []) {
    const basePriceCents = typeof item.price === "number" ? Math.round(item.price * 100) : null;
    const startingPriceCents =
      basePriceCents == null ? resolveSizePriceCents(item, modifierGroups, modifierOptions) : null;
    out.push({
      posId: item.guid,
      name: item.name,
      category,
      priceCents: basePriceCents ?? startingPriceCents,
      isStartingPrice: basePriceCents == null && startingPriceCents != null,
    });
  }
  for (const sub of group.menuGroups ?? []) {
    flattenMenuGroup(sub, sub.name ?? category, out, modifierGroups, modifierOptions);
  }
}

// Real names for the opaque revenueCenter.guid every order payload
// already carries — used to label Channel Mix with e.g. "Bar" instead
// of a raw GUID.
export async function fetchRevenueCenters(
  hostname: string,
  token: string,
  restaurantExternalId: string,
): Promise<ToastRevenueCenter[]> {
  const centers = await toastFetch(
    hostname,
    `/config/v2/revenueCenters`,
    token,
    restaurantExternalId,
  );
  return (Array.isArray(centers) ? centers : []).map((c: { guid: string; name: string }) => ({
    guid: c.guid,
    name: c.name,
  }));
}

export async function fetchMenus(
  hostname: string,
  token: string,
  restaurantExternalId: string,
): Promise<ToastMenuItemFlat[]> {
  const menus = await toastFetch(hostname, `/menus/v2/menus`, token, restaurantExternalId);
  const modifierGroups: Record<string, ToastModifierGroupRef> = menus.modifierGroupReferences ?? {};
  const modifierOptions: Record<string, ToastModifierOptionRef> = menus.modifierOptionReferences ?? {};
  const out: ToastMenuItemFlat[] = [];
  for (const menu of Array.isArray(menus) ? menus : (menus.menus ?? [])) {
    for (const group of menu.menuGroups ?? []) {
      flattenMenuGroup(group, group.name ?? "Uncategorized", out, modifierGroups, modifierOptions);
    }
  }
  return out;
}

// Roster + wage config — fetched once per sync run (not per date) and
// used purely to resolve each time entry's wage_cents/employee name
// at sync time, never persisted as their own standing entities.
export async function fetchEmployees(
  hostname: string,
  token: string,
  restaurantExternalId: string,
): Promise<ToastEmployee[]> {
  const employees = await toastFetch(hostname, `/labor/v1/employees`, token, restaurantExternalId);
  return Array.isArray(employees) ? employees : [];
}

export async function fetchJobs(
  hostname: string,
  token: string,
  restaurantExternalId: string,
): Promise<ToastJob[]> {
  const jobs = await toastFetch(hostname, `/labor/v1/jobs`, token, restaurantExternalId);
  return Array.isArray(jobs) ? jobs : [];
}

// Real clocked shifts for one business date — actual hours worked,
// not a planned/scheduled shift (a different Toast concept this app
// doesn't ingest).
export async function fetchTimeEntriesForDate(
  hostname: string,
  token: string,
  restaurantExternalId: string,
  businessDate: string, // yyyymmdd
): Promise<ToastTimeEntry[]> {
  const entries = await toastFetch(
    hostname,
    `/labor/v1/timeEntries?businessDate=${businessDate}`,
    token,
    restaurantExternalId,
  );
  return Array.isArray(entries) ? entries : [];
}
