// Square POS client — pure reader, mirrors toast.ts's shape. Every
// request/response field below was confirmed against Square's current
// API reference during planning (Orders Search, Catalog List, Team
// Members Search, Labor Search Timecards, OAuth token exchange), not
// guessed. Note: Labor's old "Search Shifts" endpoint is deprecated —
// this uses its replacement, Search Timecards.

export type SquareMoney = { amount?: number; currency?: string };

export type SquareOrderLineItem = {
  catalog_object_id?: string;
  name?: string;
  // Square returns this as a string, not a number.
  quantity?: string;
  total_money?: SquareMoney;
};

export type SquareOrder = {
  id: string;
  location_id: string;
  state?: string; // "OPEN" | "COMPLETED" | "CANCELED"
  closed_at?: string;
  created_at?: string;
  line_items?: SquareOrderLineItem[];
};

export type SquareCatalogItemVariation = {
  type: string; // "ITEM_VARIATION"
  id: string;
  item_variation_data?: { price_money?: SquareMoney };
};

export type SquareCatalogObject = {
  type: string; // "ITEM" | "CATEGORY"
  id: string;
  is_deleted?: boolean;
  item_data?: {
    name?: string;
    category_id?: string;
    variations?: SquareCatalogItemVariation[];
  };
  category_data?: { name?: string };
};

export type SquareMenuItemFlat = {
  posId: string;
  name: string;
  category: string;
  priceCents: number | null;
  // True when priceCents is the cheapest of more than one real
  // variation price (e.g. Small/Large) rather than a single fixed
  // price — same convention as Toast's isStartingPrice.
  isStartingPrice: boolean;
};

export type SquareTeamMember = {
  id: string;
  given_name?: string;
  family_name?: string;
  status?: string; // "ACTIVE" | "INACTIVE"
};

export type SquareTimecardBreak = {
  start_at?: string;
  end_at?: string;
  is_paid?: boolean;
};

export type SquareTimecard = {
  id: string;
  team_member_id: string;
  start_at: string;
  end_at?: string | null;
  wage?: { title?: string; hourly_rate?: SquareMoney };
  breaks?: SquareTimecardBreak[];
};

type SquareTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

async function squarePost(hostname: string, path: string, token: string | null, body: unknown) {
  const res = await fetch(`${hostname}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Square POST ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

async function squareGet(hostname: string, path: string, token: string) {
  const res = await fetch(`${hostname}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Square GET ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// Access tokens expire in 30 days — called fresh at the start of every
// sync run rather than cached, same spirit as Toast's authenticate()
// being called every run (client-credentials there, refresh-token
// grant here).
export async function refreshAccessToken(
  hostname: string,
  applicationId: string,
  applicationSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const data = (await squarePost(hostname, "/oauth2/token", null, {
    client_id: applicationId,
    client_secret: applicationSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })) as SquareTokenResponse;
  if (!data?.access_token) {
    throw new Error(`Square token refresh returned no access_token: ${JSON.stringify(data)}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
  };
}

// Orders in one request, paginated — unlike Toast's ordersBulk (one
// business date per call), Search Orders takes a real date range
// directly, so the caller doesn't need to loop day by day.
export async function fetchOrdersForRange(
  hostname: string,
  token: string,
  locationRef: string,
  startAtIso: string,
  endAtIso: string,
): Promise<SquareOrder[]> {
  const all: SquareOrder[] = [];
  let cursor: string | undefined;
  for (;;) {
    const data = await squarePost(hostname, "/v2/orders/search", token, {
      location_ids: [locationRef],
      query: {
        filter: { date_time_filter: { created_at: { start_at: startAtIso, end_at: endAtIso } } },
        sort: { sort_field: "CREATED_AT", sort_order: "ASC" },
      },
      limit: 500,
      cursor,
    });
    all.push(...((data?.orders ?? []) as SquareOrder[]));
    cursor = data?.cursor;
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

// ITEM + CATEGORY objects in one paginated pass — category names are
// only given as ids inline on each item, resolved against the
// CATEGORY objects fetched in the same call.
export async function fetchCatalogItems(
  hostname: string,
  token: string,
): Promise<SquareMenuItemFlat[]> {
  const all: SquareCatalogObject[] = [];
  let cursor: string | undefined;
  for (;;) {
    const url = new URL(`${hostname}/v2/catalog/list`);
    url.searchParams.set("types", "ITEM,CATEGORY");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await squareGet(hostname, url.pathname + url.search, token);
    all.push(...((data?.objects ?? []) as SquareCatalogObject[]));
    cursor = data?.cursor;
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  const categoryNameById = new Map<string, string>();
  for (const obj of all) {
    if (obj.type === "CATEGORY" && obj.category_data?.name) {
      categoryNameById.set(obj.id, obj.category_data.name);
    }
  }

  const items: SquareMenuItemFlat[] = [];
  for (const obj of all) {
    if (obj.type !== "ITEM" || obj.is_deleted || !obj.item_data) continue;
    const variations = (obj.item_data.variations ?? []).filter(
      (v) => v.item_variation_data?.price_money?.amount != null,
    );
    const prices = variations.map((v) => v.item_variation_data!.price_money!.amount!);
    const priceCents = prices.length > 0 ? Math.min(...prices) : null;
    items.push({
      posId: obj.id,
      name: obj.item_data.name ?? "Unknown item",
      category: obj.item_data.category_id
        ? (categoryNameById.get(obj.item_data.category_id) ?? "Uncategorized")
        : "Uncategorized",
      priceCents,
      isStartingPrice: prices.length > 1,
    });
  }
  return items;
}

export async function fetchTeamMembers(
  hostname: string,
  token: string,
  locationRef: string,
): Promise<SquareTeamMember[]> {
  const all: SquareTeamMember[] = [];
  let cursor: string | undefined;
  for (;;) {
    const data = await squarePost(hostname, "/v2/team-members/search", token, {
      query: { filter: { location_ids: [locationRef], status: "ACTIVE" } },
      limit: 200,
      cursor,
    });
    all.push(...((data?.team_members ?? []) as SquareTeamMember[]));
    cursor = data?.cursor;
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

// Real clocked timecards for a date range — the current Labor API
// (Search Shifts, the older endpoint, is deprecated and past its
// retirement date).
export async function fetchTimecardsForRange(
  hostname: string,
  token: string,
  locationRef: string,
  startDate: string, // YYYY-MM-DD
  endDate: string, // YYYY-MM-DD
  defaultTimezone: string,
): Promise<SquareTimecard[]> {
  const all: SquareTimecard[] = [];
  let cursor: string | undefined;
  for (;;) {
    const data = await squarePost(hostname, "/v2/labor/timecards/search", token, {
      query: {
        filter: {
          location_id: [locationRef],
          workday: {
            date_range: { start_date: startDate, end_date: endDate },
            match_timecards_by: "START_AT",
            default_timezone: defaultTimezone,
          },
        },
      },
      limit: 200,
      cursor,
    });
    all.push(...((data?.timecards ?? []) as SquareTimecard[]));
    cursor = data?.cursor;
    if (!cursor) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}
