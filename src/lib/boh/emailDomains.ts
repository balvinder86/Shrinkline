// A vendor's invoicing_sender_emails list may contain full addresses
// (joe@gmail.com) AND/OR domains (@sysco.com) — but a domain entry on
// a free email provider would trust literally anyone with a Gmail
// account, so those may only ever be added as exact addresses.
export const FREE_EMAIL_PROVIDER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "zoho.com",
]);

export function isFreeEmailProviderDomain(domain: string): boolean {
  return FREE_EMAIL_PROVIDER_DOMAINS.has(domain.trim().toLowerCase());
}
