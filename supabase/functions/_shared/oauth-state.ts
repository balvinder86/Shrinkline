// Signs/verifies a short-lived state token carrying which restaurant
// initiated a Search Console OAuth connect flow. Needed because the
// browser fully navigates away to Google and back — no Authorization
// header survives that round trip, so the callback (a public GET
// endpoint) has no other way to know which tenant this belongs to.
// Without signing, a malicious actor could craft a callback request
// with an arbitrary restaurant_id and connect their own Search
// Console access to a victim's tenant.

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — plenty for a real consent click-through

// locationId is optional — Gmail/Search Console only ever needed
// restaurantId (one connected inbox/site per restaurant); Square's
// callback also needs to know which location the credential belongs
// to, since pos_credentials is keyed by location, not restaurant.
export async function signState(
  secret: string,
  restaurantId: string,
  locationId?: string,
): Promise<string> {
  const payload = JSON.stringify({ restaurantId, locationId, exp: Date.now() + STATE_TTL_MS });
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifyState(
  secret: string,
  state: string,
): Promise<{ restaurantId: string; locationId?: string }> {
  const [payloadB64, sigB64] = state.split(".");
  if (!payloadB64 || !sigB64) throw new Error("malformed state");

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(sigB64),
    new TextEncoder().encode(payloadB64),
  );
  if (!valid) throw new Error("invalid state signature");

  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
  if (typeof payload.restaurantId !== "string" || typeof payload.exp !== "number") {
    throw new Error("malformed state payload");
  }
  if (Date.now() > payload.exp) throw new Error("state expired — please try connecting again");

  return {
    restaurantId: payload.restaurantId,
    locationId: typeof payload.locationId === "string" ? payload.locationId : undefined,
  };
}
