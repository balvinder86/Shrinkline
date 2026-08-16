import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";

import { hasAccess, useCurrentMembership } from "@/lib/permissions";
import { NAV_OVERVIEW, NAV_GROWTH, NAV_OPERATIONS, NAV_UNGATED } from "@/lib/nav-items";
import { useInventoryItems, useRealInvoices } from "@/lib/boh/queries";
import { useProductMix } from "@/lib/pos/queries";
import { useReviews } from "@/lib/reviews/queries";
import { useCustomers } from "@/lib/marketing/queries";
import { addDays, startOfDay } from "@/lib/date-range";
import { useLanguage } from "@/lib/i18n/language-context";

// Fixed recent-items window for search candidates — deliberately not
// tied to the global date-range filter, since search should always
// surface currently-relevant menu items regardless of what range
// someone has picked for looking at historical data elsewhere.
const SEARCH_ITEM_WINDOW = (() => {
  const today = startOfDay(new Date());
  return { from: addDays(today, -6), to: today };
})();

// Flattened one level — a nested item (e.g. Vendors/Waste Log under
// Stock & Purchasing) must stay searchable by its own name, not just
// reachable by first finding its parent in the sidebar.
const ALL_FEATURES = [...NAV_OVERVIEW, ...NAV_GROWTH, ...NAV_OPERATIONS].flatMap((item) =>
  item.children ? [item, ...item.children] : [item],
);

// Lower groupRank wins ties — a page you can navigate to by name
// ("invoices") should beat a same-scoring item match, and within
// items, earlier categories are just listed in a stable, sensible
// order (there's no real reason to prefer a menu item over an
// inventory item on a tie, so this is just deterministic, not ranked
// by importance).
type Candidate = { label: string; url: string; groupRank: number };

function scoreMatch(query: string, text: string): number {
  const t = text.toLowerCase();
  if (t === query) return 3;
  if (t.startsWith(query)) return 2;
  if (t.includes(query)) return 1;
  return 0;
}

function bestMatch(query: string, candidates: Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = scoreMatch(query, c.label);
    if (score === 0) continue;
    if (!best || score > bestScore || (score === bestScore && c.groupRank < best.groupRank)) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

// A plain "type a word, hit Enter, land on the page" search — not a
// command-palette popup. Jumps to whichever single feature or real
// item scores highest against the query (exact > starts-with >
// contains), tie-broken toward feature pages.
export function GlobalSearch() {
  const navigate = useNavigate();
  const membership = useCurrentMembership();
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [notFound, setNotFound] = useState(false);

  const { data: inventoryItems = [] } = useInventoryItems();
  const { data: invoices = [] } = useRealInvoices();
  const { data: productMixItems = [] } = useProductMix(SEARCH_ITEM_WINDOW);
  const { data: reviews = [] } = useReviews();
  const { data: customers = [] } = useCustomers();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const candidates = useMemo((): Candidate[] => {
    const list: Candidate[] = [];
    for (const f of ALL_FEATURES) {
      if (hasAccess(membership, f.permission))
        list.push({ label: t.nav[f.titleKey], url: f.url, groupRank: 0 });
    }
    for (const f of NAV_UNGATED) list.push({ label: t.nav[f.titleKey], url: f.url, groupRank: 0 });

    if (hasAccess(membership, "inventory")) {
      for (const i of inventoryItems)
        list.push({ label: `${i.name} ${i.category}`, url: "/inventory", groupRank: 1 });
    }
    if (hasAccess(membership, "invoices")) {
      for (const i of invoices)
        list.push({
          label: `${i.vendorName ?? ""} ${i.invoiceNumber ?? ""}`,
          url: "/invoices",
          groupRank: 2,
        });
    }
    if (hasAccess(membership, "product_mix")) {
      for (const i of productMixItems)
        list.push({ label: `${i.name} ${i.category}`, url: "/product-mix", groupRank: 3 });
    }
    if (hasAccess(membership, "reviews")) {
      for (const r of reviews)
        list.push({
          label: `${r.reviewerName} ${r.reviewText ?? ""}`,
          url: "/reviews",
          groupRank: 4,
        });
    }
    if (hasAccess(membership, "marketing")) {
      for (const c of customers)
        list.push({ label: `${c.name} ${c.email ?? ""}`, url: "/marketing", groupRank: 5 });
    }
    return list;
  }, [membership, inventoryItems, invoices, productMixItems, reviews, customers, t]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) return;
    const match = bestMatch(q, candidates);
    if (match) {
      setNotFound(false);
      setQuery("");
      inputRef.current?.blur();
      navigate({ to: match.url });
    } else {
      setNotFound(true);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex h-10 w-full max-w-md items-center gap-2 rounded-full border border-border bg-card px-4 text-sm transition-colors focus-within:border-primary/40"
    >
      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setNotFound(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") inputRef.current?.blur();
        }}
        placeholder={t.topbar.searchPlaceholder}
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
      />
      {notFound ? (
        <span className="shrink-0 text-xs text-destructive">{t.topbar.noMatch}</span>
      ) : (
        <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      )}
    </form>
  );
}
