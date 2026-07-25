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
};

export type ToastMenuItemFlat = {
  posId: string;
  name: string;
  category: string;
  priceCents: number | null;
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

function flattenMenuGroup(group: any, category: string, out: ToastMenuItemFlat[]) {
  for (const item of group.menuItems ?? []) {
    out.push({
      posId: item.guid,
      name: item.name,
      category,
      priceCents: typeof item.price === "number" ? Math.round(item.price * 100) : null,
    });
  }
  for (const sub of group.menuGroups ?? []) {
    flattenMenuGroup(sub, sub.name ?? category, out);
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
  const out: ToastMenuItemFlat[] = [];
  for (const menu of Array.isArray(menus) ? menus : (menus.menus ?? [])) {
    for (const group of menu.menuGroups ?? []) {
      flattenMenuGroup(group, group.name ?? "Uncategorized", out);
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
