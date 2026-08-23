import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Plus, Search, TrendingDown, TrendingUp } from "lucide-react";

import {
  useInventoryCounts,
  useInventoryItems,
  useIngredients,
  useSaveInventoryCount,
  useStorageLocations,
  useCreateStorageLocation,
  useAssignStorageLocation,
  useBulkAssignStorageLocation,
  type InventoryItem,
  type SaveInventoryCountLine,
} from "@/lib/boh/queries";
import { CATEGORIES, type Category } from "@/lib/boh/ingredient-categories";
import { compatibleLineUnits, convertQuantityToIngredientUnit, unitLabel } from "@/lib/units";

import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const UNASSIGNED = "Unassigned";
type GroupBy = "category" | "location";

// The quantity as typed may be in a different (but compatible) unit
// than the ingredient's own priced unit — a keg-tracked beer counted
// in oz, a case-purchased item counted directly in cases. Converts
// back to the ingredient's own unit for costing/on-hand-sync purposes;
// null when the typed unit can't convert (shouldn't happen through the
// picker below, which only ever offers convertible units, but this is
// the same defensive fallback resolveIngredientLineCostCents uses).
function resolveNativeQty(item: InventoryItem, qty: number, unit: string): number | null {
  if (!Number.isFinite(qty)) return null;
  if (unit === item.unit) return qty;
  return convertQuantityToIngredientUnit(
    qty,
    unit,
    item.unit,
    item.containerSizeMl,
    item.containerSizeG,
  );
}

export const Route = createFileRoute("/inventory-count")({
  head: () => ({
    meta: [
      { title: "Inventory Count · Shrinkline" },
      {
        name: "description",
        content:
          "Do a physical inventory count and see its priced-out total value, saved as a dated record so you can track value over time.",
      },
    ],
  }),
  component: InventoryCountPage,
});

const COUNT_PAGE_SIZE = 50;

function formatMoney(n: number, opts: { compact?: boolean } = {}) {
  if (opts.compact && Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  trend?: "up" | "down";
}) {
  return (
    <Card className="p-5 border-stone-200 bg-white">
      <div className="flex items-center gap-2 text-stone-600 text-xs uppercase tracking-wider">
        {icon}
        <span>{label}</span>
        {trend === "up" && <TrendingUp className="h-3 w-3 text-emerald-600 ml-auto" />}
        {trend === "down" && <TrendingDown className="h-3 w-3 text-terracotta ml-auto" />}
      </div>
      <p className="font-serif text-3xl text-ink mt-2 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-stone-500 mt-1">{hint}</p>}
    </Card>
  );
}

function InventoryCountPage() {
  const { data: items = [] } = useInventoryItems();
  const { data: ingredients = [] } = useIngredients();
  const { data: counts = [] } = useInventoryCounts();
  const { data: storageLocations = [] } = useStorageLocations();
  const assignStorageLocation = useAssignStorageLocation();
  const bulkAssignStorageLocation = useBulkAssignStorageLocation();
  const saveCount = useSaveInventoryCount();
  const storageLocationNameById = useMemo(
    () => new Map(storageLocations.map((l) => [l.id, l.name])),
    [storageLocations],
  );

  // InventoryItem.cost defaults uncosted ingredients to $0 (same
  // convention the Items page's own on-hand-value KPI already uses),
  // which can't tell "priced at $0" apart from "no cost set yet". This
  // page's live total follows that same established convention for
  // consistency, but the SAVED historical record uses the ingredient's
  // true nullable cost below, so a past count's fidelity doesn't
  // silently degrade to "priced at $0" for items that were never
  // actually priced.
  const trueCostCentsById = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i.unitCostCents])),
    [ingredients],
  );
  const uncostedCount = useMemo(
    () => items.filter((i) => trueCostCentsById.get(i.id) == null).length,
    [items, trueCostCentsById],
  );

  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [tab, setTab] = useState<string>("All");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [addLocationOpen, setAddLocationOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStorageLocationId, setBulkStorageLocationId] = useState("");

  // Seeded once from the current on-hand numbers (in each item's own
  // unit) as a starting point to correct while walking the count — not
  // re-seeded on every refetch, or an in-progress count would keep
  // getting clobbered by whatever ingredient_stock happens to say
  // right now.
  const [seeded, setSeeded] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!seeded && items.length > 0) {
      const initialQty: Record<string, string> = {};
      const initialUnit: Record<string, string> = {};
      for (const i of items) {
        initialQty[i.id] = String(i.onHand);
        initialUnit[i.id] = i.unit;
      }
      setQuantities(initialQty);
      setUnits(initialUnit);
      setSeeded(true);
    }
  }, [seeded, items]);

  useEffect(() => {
    setTab("All");
  }, [groupBy]);

  useEffect(() => {
    setPage(1);
  }, [tab, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (tab !== "All") {
        if (groupBy === "category") {
          if (i.category !== tab) return false;
        } else if (tab === UNASSIGNED) {
          if (i.storageLocationId != null) return false;
        } else if (i.storageLocationId !== tab) {
          return false;
        }
      }
      if (q && !i.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, tab, query, groupBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / COUNT_PAGE_SIZE));
  const paged = useMemo(
    () => filtered.slice((page - 1) * COUNT_PAGE_SIZE, page * COUNT_PAGE_SIZE),
    [filtered, page],
  );
  // section.key groups rows and drives the "All" section headers;
  // section.label is what's actually shown (a storage location's real
  // name, looked up by id, rather than its id).
  const sections = useMemo(() => {
    if (groupBy === "category") {
      if (tab !== "All") return [{ key: tab, label: tab, items: paged }];
      const extraCategories = Array.from(
        new Set(paged.map((i) => i.category).filter((c) => !CATEGORIES.includes(c as Category))),
      ).sort();
      return [...CATEGORIES, ...extraCategories]
        .map((c) => ({ key: c, label: c, items: paged.filter((i) => i.category === c) }))
        .filter((s) => s.items.length > 0);
    }
    if (tab !== "All") {
      const label = tab === UNASSIGNED ? UNASSIGNED : (storageLocationNameById.get(tab) ?? tab);
      return [{ key: tab, label, items: paged }];
    }
    const groups = [
      ...storageLocations.map((l) => ({ key: l.id, label: l.name })),
      { key: UNASSIGNED, label: UNASSIGNED },
    ];
    return groups
      .map((g) => ({
        ...g,
        items: paged.filter((i) =>
          g.key === UNASSIGNED ? i.storageLocationId == null : i.storageLocationId === g.key,
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [paged, tab, groupBy, storageLocations, storageLocationNameById]);

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  // Selects every item matching the current filter, not just the
  // current page — same "select all" scope useBulkAssignVendor's UI
  // uses on the Ordering page, so a bulk assign can cover a whole
  // filtered set (e.g. everything in "Alcohol") in one action.
  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id));
  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(filtered.map((i) => i.id)) : new Set());
  };
  const applyBulkStorageLocation = () => {
    if (selectedIds.size === 0) return;
    bulkAssignStorageLocation.mutate(
      { ingredientIds: Array.from(selectedIds), storageLocationId: bulkStorageLocationId || null },
      {
        onSuccess: () => {
          setSelectedIds(new Set());
          setBulkStorageLocationId("");
        },
      },
    );
  };

  // Live total across EVERY item, not just the current page/filter —
  // a count sheet you're only halfway through paging through should
  // still show the real total for what's been entered (and defaults
  // to each item's current on-hand, in its own unit, for anything not
  // yet touched).
  const totalValueCents = useMemo(() => {
    let sum = 0;
    for (const i of items) {
      const qtyStr = quantities[i.id];
      const qty = qtyStr !== undefined ? parseFloat(qtyStr) : i.onHand;
      const unit = units[i.id] ?? i.unit;
      const nativeQty = resolveNativeQty(i, qty, unit);
      if (nativeQty != null) sum += Math.round(nativeQty * i.cost * 100);
    }
    return sum;
  }, [items, quantities, units]);

  const latestCount = counts[0] ?? null;
  const previousCount = counts[1] ?? null;
  const valueDeltaCents =
    latestCount && previousCount
      ? latestCount.totalValueCents - previousCount.totalValueCents
      : null;
  const valueDeltaPct =
    valueDeltaCents != null && previousCount && previousCount.totalValueCents !== 0
      ? (valueDeltaCents / previousCount.totalValueCents) * 100
      : null;

  function handleSave() {
    setSaveError(null);
    setSavedMessage(null);
    const lines: SaveInventoryCountLine[] = items.map((i) => {
      const qtyStr = quantities[i.id];
      const qty = qtyStr !== undefined ? parseFloat(qtyStr) : i.onHand;
      const unit = units[i.id] ?? i.unit;
      return {
        ingredientId: i.id,
        quantity: Number.isFinite(qty) ? qty : 0,
        unit,
        nativeQuantity: resolveNativeQty(i, qty, unit),
        unitCostCents: trueCostCentsById.get(i.id) ?? null,
      };
    });
    saveCount.mutate(
      { lines, notes: notes.trim() || null },
      {
        onSuccess: () => {
          setNotes("");
          setSavedMessage(
            `Count saved — ${formatMoney(totalValueCents / 100)} across ${items.length} items.`,
          );
        },
        onError: (e) => setSaveError(e instanceof Error ? e.message : String(e)),
      },
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      <Topbar eyebrow="Stock & purchasing" title="Inventory Count" />

      <main className="px-8 py-8 max-w-[1500px] mx-auto space-y-8">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-terracotta font-semibold">
            Stock & purchasing
          </p>
          <p className="font-serif text-3xl text-ink mt-1">Inventory Count</p>
          <p className="text-sm text-stone-600 mt-1 max-w-2xl">
            Count what's actually on the shelf and save it as a dated, priced-out record — separate
            from the running on-hand number Items & Orders uses for reordering — so you can compare
            total inventory value count-to-count.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <KpiCard
            icon={<ClipboardCheck className="h-3.5 w-3.5" />}
            label="Last saved count"
            value={
              latestCount ? formatMoney(latestCount.totalValueCents / 100, { compact: true }) : "—"
            }
            hint={
              latestCount
                ? `${new Date(`${latestCount.countedAt}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${latestCount.itemCount} items`
                : "No count saved yet"
            }
          />
          <KpiCard
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            label="Change vs previous count"
            value={
              valueDeltaCents != null ? formatMoney(valueDeltaCents / 100, { compact: true }) : "—"
            }
            hint={
              valueDeltaPct != null
                ? `${valueDeltaPct >= 0 ? "+" : ""}${valueDeltaPct.toFixed(1)}%`
                : previousCount
                  ? undefined
                  : "Need a second count to compare"
            }
            trend={valueDeltaCents != null ? (valueDeltaCents >= 0 ? "up" : "down") : undefined}
          />
          <KpiCard
            icon={<ClipboardCheck className="h-3.5 w-3.5" />}
            label="Current count sheet total"
            value={formatMoney(totalValueCents / 100, { compact: true })}
            hint={
              uncostedCount > 0
                ? `${items.length} items · ${uncostedCount} with no cost set`
                : `${items.length} items`
            }
          />
        </div>

        <Card className="border-stone-200 overflow-hidden">
          <div className="p-5 pb-0 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-serif text-2xl text-ink">Count sheet</p>
              <p className="text-sm text-stone-600">
                Pre-filled from current on-hand — correct any item as you count it.
              </p>
            </div>
          </div>

          <div className="p-5 flex items-center gap-3 flex-wrap">
            <div className="inline-flex rounded-md border border-stone-200 bg-white p-0.5 text-xs shrink-0">
              <button
                type="button"
                onClick={() => setGroupBy("category")}
                className={`rounded px-2.5 py-1.5 font-medium ${
                  groupBy === "category" ? "bg-ink text-cream" : "text-stone-600"
                }`}
              >
                Category
              </button>
              <button
                type="button"
                onClick={() => setGroupBy("location")}
                className={`rounded px-2.5 py-1.5 font-medium ${
                  groupBy === "location" ? "bg-ink text-cream" : "text-stone-600"
                }`}
              >
                Storage location
              </button>
            </div>
            <div className="max-w-full overflow-x-auto">
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="bg-cream border border-stone-200">
                  <TabsTrigger value="All">All</TabsTrigger>
                  {groupBy === "category"
                    ? CATEGORIES.map((c) => (
                        <TabsTrigger key={c} value={c}>
                          {c}
                        </TabsTrigger>
                      ))
                    : [
                        ...storageLocations.map((l) => (
                          <TabsTrigger key={l.id} value={l.id}>
                            {l.name}
                          </TabsTrigger>
                        )),
                        <TabsTrigger key={UNASSIGNED} value={UNASSIGNED}>
                          {UNASSIGNED}
                        </TabsTrigger>,
                      ]}
                </TabsList>
              </Tabs>
            </div>
            {groupBy === "location" && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 shrink-0"
                onClick={() => setAddLocationOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Add location
              </Button>
            )}
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search items"
                className="pl-9 bg-white"
              />
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="px-5 pb-5">
              <Card className="border-stone-200 bg-cream p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"} selected
                  </span>
                  <select
                    value={bulkStorageLocationId}
                    onChange={(e) => setBulkStorageLocationId(e.target.value)}
                    className="h-9 rounded-md border border-stone-200 bg-white px-2 text-sm"
                  >
                    <option value="">Unassigned</option>
                    {storageLocations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={bulkAssignStorageLocation.isPending}
                    onClick={applyBulkStorageLocation}
                  >
                    {bulkAssignStorageLocation.isPending ? "Assigning…" : "Assign location"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                    Clear selection
                  </Button>
                </div>
              </Card>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/60">
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={allFilteredSelected}
                      onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                      aria-label="Select all items"
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Unit cost</TableHead>
                  <TableHead className="text-center">Counted qty & unit</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sections.map((section) => (
                  <Fragment key={section.key}>
                    {tab === "All" && (
                      <TableRow key={`${section.key}-header`} className="bg-stone-50/40">
                        <TableCell
                          colSpan={6}
                          className="text-xs font-semibold uppercase tracking-wider text-stone-500 py-2"
                        >
                          {section.label} · {section.items.length}
                        </TableCell>
                      </TableRow>
                    )}
                    {section.items.map((item) => {
                      const qtyStr = quantities[item.id] ?? String(item.onHand);
                      const qty = parseFloat(qtyStr);
                      const unit = units[item.id] ?? item.unit;
                      const compatUnits = compatibleLineUnits(
                        item.unit,
                        item.containerSizeMl,
                        item.containerSizeG,
                      );
                      const hasCost = trueCostCentsById.get(item.id) != null;
                      const nativeQty = resolveNativeQty(item, qty, unit);
                      const lineValueCents =
                        nativeQty != null ? Math.round(nativeQty * item.cost * 100) : null;
                      return (
                        <TableRow key={item.id} className="hover:bg-stone-50/50">
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(item.id)}
                              onCheckedChange={(checked) => toggleSelect(item.id, checked === true)}
                              aria-label={`Select ${item.name}`}
                            />
                          </TableCell>
                          <TableCell>
                            <p className="font-medium text-ink">{item.name}</p>
                            <p className="text-xs text-stone-500">
                              priced per {unitLabel(item.unit)}
                            </p>
                            <p className="text-xs text-stone-400">
                              {item.lastCounted === "—"
                                ? "Never counted"
                                : `Last counted ${item.lastCounted}`}
                            </p>
                          </TableCell>
                          <TableCell>
                            <select
                              value={item.storageLocationId ?? ""}
                              onChange={(e) =>
                                assignStorageLocation.mutate({
                                  ingredientId: item.id,
                                  storageLocationId: e.target.value || null,
                                })
                              }
                              className="h-8 w-32 rounded-md border border-stone-200 bg-white px-1.5 text-xs text-stone-700"
                            >
                              <option value="">Unassigned</option>
                              {storageLocations.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell className="text-sm text-stone-700">
                            {hasCost ? formatMoney(item.cost) : "— no cost"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-1.5">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                value={qtyStr}
                                onChange={(e) =>
                                  setQuantities((q) => ({ ...q, [item.id]: e.target.value }))
                                }
                                className="h-8 w-20 text-center"
                              />
                              {compatUnits.length > 1 ? (
                                <Select
                                  value={unit}
                                  onValueChange={(u) => setUnits((s) => ({ ...s, [item.id]: u }))}
                                >
                                  <SelectTrigger className="h-8 w-28">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {compatUnits.map((u) => (
                                      <SelectItem key={u} value={u}>
                                        {unitLabel(u)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="w-20 text-left text-xs text-stone-500">
                                  {unitLabel(unit)}
                                </span>
                              )}
                            </div>
                            {nativeQty == null && (
                              <p className="mt-1 text-center text-[11px] text-terracotta">
                                Can't convert to {unitLabel(item.unit)}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {hasCost && lineValueCents != null
                              ? formatMoney(lineValueCents / 100)
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-sm text-stone-500">
                      No items match this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-stone-50/60 px-4 py-3 text-sm">
            <span className="text-stone-500">
              {filtered.length === 0
                ? "0 items"
                : `Showing ${(page - 1) * COUNT_PAGE_SIZE + 1}–${Math.min(page * COUNT_PAGE_SIZE, filtered.length)} of ${filtered.length} item${filtered.length === 1 ? "" : "s"}`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <span className="text-xs text-stone-500">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            )}
          </div>

          <div className="p-5 border-t border-stone-200 space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <Label htmlFor="count-notes" className="text-xs text-stone-500">
                  Notes (optional)
                </Label>
                <Textarea
                  id="count-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. counted with Maria, walk-in freezer skipped"
                  className="mt-1 max-w-md"
                />
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-stone-500">Count total</p>
                <p className="font-serif text-3xl text-ink tabular-nums">
                  {formatMoney(totalValueCents / 100)}
                </p>
              </div>
            </div>
            {saveError && <p className="text-xs text-terracotta">{saveError}</p>}
            {savedMessage && !saveError && (
              <p className="text-xs text-emerald-700">{savedMessage}</p>
            )}
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saveCount.isPending || items.length === 0}>
                {saveCount.isPending ? "Saving…" : "Save count"}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="border-stone-200 overflow-hidden">
          <div className="p-5 pb-0">
            <p className="font-serif text-2xl text-ink">Count history</p>
            <p className="text-sm text-stone-600">Every saved count, most recent first.</p>
          </div>
          <div className="overflow-x-auto mt-4">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/60">
                  <TableHead>Date</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-right">Total value</TableHead>
                  <TableHead className="text-right">Change vs prior</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {counts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-sm text-stone-500">
                      No counts saved yet — save your first count above.
                    </TableCell>
                  </TableRow>
                ) : (
                  counts.map((c, idx) => {
                    const prior = counts[idx + 1];
                    const delta = prior ? c.totalValueCents - prior.totalValueCents : null;
                    return (
                      <TableRow key={c.id} className="hover:bg-stone-50/50">
                        <TableCell className="text-sm">
                          {new Date(`${c.countedAt}T00:00:00`).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </TableCell>
                        <TableCell className="text-center text-sm">{c.itemCount}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatMoney(c.totalValueCents / 100)}
                        </TableCell>
                        <TableCell
                          className={`text-right text-sm tabular-nums ${
                            delta == null
                              ? "text-stone-400"
                              : delta >= 0
                                ? "text-emerald-700"
                                : "text-terracotta"
                          }`}
                        >
                          {delta == null
                            ? "—"
                            : `${delta >= 0 ? "+" : ""}${formatMoney(delta / 100)}`}
                        </TableCell>
                        <TableCell className="text-sm text-stone-500">{c.notes ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </main>

      <AddStorageLocationDialog open={addLocationOpen} onOpenChange={setAddLocationOpen} />
    </div>
  );
}

function AddStorageLocationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const createStorageLocation = useCreateStorageLocation();
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Add a storage location</DialogTitle>
          <DialogDescription>
            e.g. "Walk-in," "Dry storage shelf 2" — anywhere items physically live, for grouping the
            count sheet.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Bar well"
          autoFocus
        />
        {createStorageLocation.isError && (
          <p className="text-xs text-terracotta">
            {(createStorageLocation.error as Error).message}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || createStorageLocation.isPending}
            onClick={() =>
              createStorageLocation.mutate(name.trim(), { onSuccess: () => onOpenChange(false) })
            }
          >
            {createStorageLocation.isPending ? "Adding…" : "Add location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
