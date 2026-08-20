import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, FileUp, Pencil, Plus, Search, Sparkles, Trash2, Zap } from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { useDateRange } from "@/lib/date-range-context";
import {
  useProductMix,
  useUpdateItemCategory,
  useUpdateItemCost,
  useSetMenuItemsHiddenFromRecipes,
  type RealMenuItem,
} from "@/lib/pos/queries";
import {
  useIngredients,
  useMenuItemPriceTiers,
  useRecipeLinesForItem,
  useAddRecipeLine,
  useDeleteRecipeLine,
  usePrepRecipes,
  useCreatePrepRecipe,
  useUpdatePrepRecipe,
  useDeletePrepRecipe,
  usePrepRecipeLinesFor,
  useAddPrepRecipeLine,
  useDeletePrepRecipeLine,
  useGenerateRecipe,
  useUploadRecipeDoc,
  useEnqueueRecipeImport,
  useCheckRecipeImport,
  type RecipeLine,
  type PrepRecipe,
  type PrepRecipeLine,
  type GeneratedRecipe,
  type GeneratedRecipeLine,
  type RecipeImportDraft,
} from "@/lib/boh/queries";
import { quadrant, QUAD_COLOR, formatItemPrice } from "@/lib/boh/menuEngineering";
import { classifyMenuItemCategory, CATEGORIES } from "@/lib/boh/menu-category";
import { matchBeverageLine } from "@/lib/boh/beverageMatch";
import {
  MEASURE_UNITS,
  compatibleLineUnits,
  convertQuantityToIngredientUnit,
  unitLabel,
} from "@/lib/units";
import { Card } from "@/components/ui/card";
import { AiRecommendationsPanel } from "@/components/insights/AiRecommendationsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/recipes")({
  validateSearch: (search: Record<string, unknown>): { item?: string } => ({
    item: typeof search.item === "string" ? search.item : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Recipes · Shrinkline" },
      {
        name: "description",
        content:
          "What's in each dish, what it costs to make, and the margin it earns — real ingredients and sub-recipes, priced from real invoices.",
      },
    ],
  }),
  component: RecipesPage,
});

function formatMoney(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Edge Function caps a single generate-recipe call at 25 menu items —
// a larger "generate all unpriced items" selection is chunked into
// sequential calls of this size client-side rather than the function
// silently truncating.
const GENERATE_BATCH_SIZE = 25;

// A stable per-line key, generated once when a draft is received —
// NOT the array index. Review rows carry their own local state (which
// ingredient is picked, the quantity typed in), and once a line is
// resolved and filtered out of the array, every later index shifts;
// keying by index would make React reuse a row's DOM node (and its
// stale local state) for a completely different line.
type DraftLine = GeneratedRecipeLine & { _key: string };
function tagDraftLines(lines: GeneratedRecipeLine[]): DraftLine[] {
  return lines.map((line) => ({ ...line, _key: crypto.randomUUID() }));
}

// Same "stable key, not array index" reasoning as DraftLine above,
// one level up — a whole recipe found in an imported doc gets removed
// from this list as it's resolved (attached to a real item, created
// as a new prep recipe, or skipped).
type ImportRecipeDraft = RecipeImportDraft & { _key: string };
function tagImportRecipes(recipes: RecipeImportDraft[]): ImportRecipeDraft[] {
  return recipes.map((r) => ({ ...r, _key: crypto.randomUUID() }));
}

type InFlightImport = {
  id: string;
  fileName: string;
  status: "pending" | "processing" | "ready" | "failed";
  // Mutated in place as recipes get resolved/skipped, so reopening
  // "Review" on the same import later shows only what's left — the
  // source data itself is never re-fetched or re-processed.
  recipes: ImportRecipeDraft[] | null;
  error: string | null;
};

const NEW_PREP_RECIPE_TARGET = "__new_prep_recipe__";
const SKIP_TARGET = "__skip__";

function RecipesPage() {
  const { item: deepLinkItemId } = Route.useSearch();
  const { dateRange } = useDateRange();
  const [activeTab, setActiveTab] = useState<"items" | "prep">("items");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedPrepId, setSelectedPrepId] = useState<string | null>(null);
  const [newPrepOpen, setNewPrepOpen] = useState(false);
  const [batchSummary, setBatchSummary] = useState<{
    source: "ai" | "quick";
    results: GeneratedRecipe[];
  } | null>(null);
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, DraftLine[]>>({});
  const batchGenerate = useGenerateRecipe();
  const { data: allIngredients = [] } = useIngredients();

  const [categoryTab, setCategoryTab] = useState<string>("All");
  const [itemQuery, setItemQuery] = useState("");
  const [unpricedOnly, setUnpricedOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const setItemsHidden = useSetMenuItemsHiddenFromRecipes();
  const [prepQuery, setPrepQuery] = useState("");

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [inFlightImports, setInFlightImports] = useState<InFlightImport[]>([]);
  const [reviewingImportId, setReviewingImportId] = useState<string | null>(null);
  const uploadRecipeDoc = useUploadRecipeDoc();
  const enqueueRecipeImport = useEnqueueRecipeImport();
  const checkRecipeImport = useCheckRecipeImport();
  const createPrepRecipeForImport = useCreatePrepRecipe();
  const reviewingImport = inFlightImports.find((i) => i.id === reviewingImportId) ?? null;

  // Same self-rescheduling setTimeout poll already proven for invoice
  // OCR (src/routes/invoices.tsx) — re-arms on every state change as
  // long as something is still pending/processing, stops the instant
  // every in-flight import has settled.
  useEffect(() => {
    const active = inFlightImports.filter(
      (i) => i.status === "pending" || i.status === "processing",
    );
    if (active.length === 0) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const results = await Promise.all(
        active.map((i) =>
          checkRecipeImport
            .mutateAsync(i.id)
            .then((r) => ({ id: i.id, r }))
            .catch(() => ({ id: i.id, r: null })),
        ),
      );
      if (cancelled) return;
      setInFlightImports((prev) =>
        prev.map((i) => {
          const found = results.find((x) => x.id === i.id);
          if (!found?.r) return i;
          const recipes = found.r.result?.recipes
            ? tagImportRecipes(found.r.result.recipes)
            : i.recipes;
          return { ...i, status: found.r.status, recipes, error: found.r.error ?? null };
        }),
      );
    }, 3000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlightImports]);

  async function handleImportFiles(files: FileList) {
    for (const file of Array.from(files)) {
      try {
        const id = await uploadRecipeDoc.mutateAsync(file);
        setInFlightImports((prev) => [
          ...prev,
          { id, fileName: file.name, status: "pending", recipes: null, error: null },
        ]);
        await enqueueRecipeImport.mutateAsync(id);
        setInFlightImports((prev) =>
          prev.map((i) => (i.id === id ? { ...i, status: "processing" } : i)),
        );
      } catch (e) {
        setInFlightImports((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            fileName: file.name,
            status: "failed",
            recipes: null,
            error: e instanceof Error ? e.message : "Upload failed",
          },
        ]);
      }
    }
  }

  function removeResolvedImportRecipe(importId: string, key: string) {
    setInFlightImports((prev) =>
      prev.map((i) =>
        i.id === importId ? { ...i, recipes: (i.recipes ?? []).filter((r) => r._key !== key) } : i,
      ),
    );
  }

  function resolveImportRecipeToMenuItem(
    importId: string,
    recipe: ImportRecipeDraft,
    posId: string,
  ) {
    setPendingDrafts((prev) => ({ ...prev, [posId]: tagDraftLines(recipe.lines) }));
    removeResolvedImportRecipe(importId, recipe._key);
    setReviewingImportId(null);
    setActiveTab("items");
    setSelectedItemId(posId);
  }

  async function resolveImportRecipeToNewPrepRecipe(
    importId: string,
    recipe: ImportRecipeDraft,
    name: string,
    yieldQty: number,
    yieldUnit: string,
  ) {
    const newId = await createPrepRecipeForImport.mutateAsync({ name, yieldQty, yieldUnit });
    setPendingDrafts((prev) => ({ ...prev, [newId]: tagDraftLines(recipe.lines) }));
    removeResolvedImportRecipe(importId, recipe._key);
    setReviewingImportId(null);
    setActiveTab("prep");
    setSelectedPrepId(newId);
  }

  // A deep link from Product Mix's "Edit recipe" button lands here
  // with the item pre-selected, regardless of which tab was last open.
  useEffect(() => {
    if (deepLinkItemId) {
      setActiveTab("items");
      setSelectedItemId(deepLinkItemId);
    }
  }, [deepLinkItemId]);

  const { data: items = [], isLoading } = useProductMix(dateRange);
  const { data: prepRecipes = [], isLoading: isPrepLoading } = usePrepRecipes();
  const unpricedItemIds = useMemo(
    () => items.filter((i) => !i.hasRecipe).map((i) => i.id),
    [items],
  );
  // The subset "Quick-match" targets — unpriced items this app's own
  // taxonomy already classifies as Alcohol/Beverages. Food/dessert/
  // misc items are left to the AI generator or manual entry, since a
  // name-matched single ingredient can't stand in for a prepared dish.
  const quickMatchItems = useMemo(
    () =>
      items.filter(
        (i) =>
          !i.hasRecipe &&
          ["Alcohol", "Beverages"].includes(classifyMenuItemCategory(i.category, i.name)),
      ),
    [items],
  );
  // Every real category currently in use across the menu — offered as
  // the edit dropdown's options so reassigning an item reuses an
  // existing category rather than accidentally forking a near-duplicate.
  const allItemCategories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category))).sort((a, b) => a.localeCompare(b)),
    [items],
  );

  // Hidden items never show up in the normal, category-filtered view —
  // "Show hidden" replaces that view entirely with just the hidden
  // ones, so there's always a way back in to unhide something.
  const hiddenItems = useMemo(() => items.filter((i) => i.hiddenFromRecipes), [items]);

  const filteredItems = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (showHidden) {
        if (!item.hiddenFromRecipes) return false;
      } else {
        if (item.hiddenFromRecipes) return false;
        if (
          categoryTab !== "All" &&
          classifyMenuItemCategory(item.category, item.name) !== categoryTab
        )
          return false;
        if (unpricedOnly && item.hasRecipe) return false;
      }
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, categoryTab, unpricedOnly, itemQuery, showHidden]);

  // Selection persists across filter/tab changes — same reasoning as
  // Stock & Purchasing's bulk vendor assign (src/routes/inventory.tsx):
  // an owner may search "vodka", select some, search "rum", select
  // more, before applying one bulk action to everything at once.
  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const allFilteredSelected =
    filteredItems.length > 0 && filteredItems.every((i) => selectedIds.has(i.id));
  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(filteredItems.map((i) => i.id)) : new Set());
  };
  // "Hide" in the normal view, "Unhide" while looking at the Hidden
  // list — same action, opposite direction, so one bulk button and one
  // per-row icon cover both without duplicating the mutation call.
  // Takes real items (not bare ids) so locationId travels with them —
  // every item here in practice shares one location (single-location
  // restaurants only, same simplification useLocationIds()[0] makes
  // elsewhere), but deriving it from the items being hidden rather
  // than an arbitrary items[0] keeps this correct if that changes.
  const applyHidden = (targets: RealMenuItem[], hidden: boolean) => {
    if (targets.length === 0) return;
    const locationId = targets[0].locationId;
    setItemsHidden.mutate(
      { locationId, posIds: targets.map((t) => t.id), hidden },
      { onSuccess: () => setSelectedIds(new Set()) },
    );
  };

  const filteredPrepRecipes = useMemo(() => {
    const q = prepQuery.trim().toLowerCase();
    if (!q) return prepRecipes;
    return prepRecipes.filter((p) => p.name.toLowerCase().includes(q));
  }, [prepRecipes, prepQuery]);

  async function runBatchGenerate() {
    const results: GeneratedRecipe[] = [];
    for (let i = 0; i < unpricedItemIds.length; i += GENERATE_BATCH_SIZE) {
      const chunk = unpricedItemIds.slice(i, i + GENERATE_BATCH_SIZE);
      const chunkResults = await batchGenerate.mutateAsync(chunk);
      results.push(...chunkResults);
    }
    const drafts: Record<string, DraftLine[]> = {};
    for (const r of results) drafts[r.menuItemPosId] = tagDraftLines(r.lines);
    setPendingDrafts((prev) => ({ ...prev, ...drafts }));
    setBatchSummary({ source: "ai", results });
  }

  // Rule-based, no AI call — matches each unpriced Alcohol/Beverages
  // item to an existing ingredient by name (see beverageMatch.ts for
  // the exact rules). Items with no clean match, or that look poured/
  // mixed rather than sold whole, are simply skipped rather than
  // guessed at; the summary reports how many that leaves out.
  function runQuickMatch() {
    const results: GeneratedRecipe[] = [];
    const prepRecipeNames = prepRecipes.map((p) => p.name);
    for (const item of quickMatchItems) {
      const lines = matchBeverageLine(
        { name: item.name, category: item.category },
        allIngredients,
        prepRecipeNames,
      );
      if (lines.length > 0) results.push({ menuItemPosId: item.id, lines });
    }
    const drafts: Record<string, DraftLine[]> = {};
    for (const r of results) drafts[r.menuItemPosId] = tagDraftLines(r.lines);
    setPendingDrafts((prev) => ({ ...prev, ...drafts }));
    setBatchSummary({ source: "quick", results });
  }

  function summarizeDraft(lines: GeneratedRecipeLine[]) {
    const matched = lines.filter(
      (l) =>
        (l.kind === "ingredient" && l.ingredientId) || (l.kind === "prep_recipe" && l.prepRecipeId),
    ).length;
    return { matched, flagged: lines.length - matched };
  }

  const popMedian = useMemo(() => {
    if (items.length === 0) return 0;
    const arr = [...items].sort((a, b) => a.soldWk - b.soldWk);
    return arr[Math.floor(arr.length / 2)].soldWk;
  }, [items]);
  const marginMedian = useMemo(() => {
    const priced = items.filter((i) => i.cost != null);
    if (priced.length === 0) return 0;
    const arr = [...priced].sort((a, b) => a.price - a.cost! - (b.price - b.cost!));
    const mid = arr[Math.floor(arr.length / 2)];
    return mid.price - mid.cost!;
  }, [items]);

  const selectedItem = items.find((i) => i.id === selectedItemId) ?? null;

  return (
    <>
      <Topbar eyebrow="Menu Performance" title="Recipes" />
      <main className="space-y-6 px-6 py-6">
        <AiRecommendationsPanel tab="recipes" />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "items" | "prep")}>
          <TabsList className="bg-card">
            <TabsTrigger value="items">Menu items</TabsTrigger>
            <TabsTrigger value="prep">Prep recipes</TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="mt-4 space-y-3">
            <div className="max-w-full overflow-x-auto">
              <Tabs value={categoryTab} onValueChange={setCategoryTab}>
                <TabsList className="bg-cream border border-stone-200">
                  <TabsTrigger value="All">All</TabsTrigger>
                  {CATEGORIES.map((c) => (
                    <TabsTrigger key={c} value={c}>
                      {c}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1 min-w-0 sm:max-w-md">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <Input
                  value={itemQuery}
                  onChange={(e) => setItemQuery(e.target.value)}
                  placeholder="Search items"
                  className="pl-9 bg-white"
                />
              </div>
              <Button
                size="sm"
                variant={unpricedOnly ? "default" : "outline"}
                className="h-9 shrink-0"
                onClick={() => setUnpricedOnly((v) => !v)}
              >
                Needs recipe {unpricedItemIds.length > 0 && `(${unpricedItemIds.length})`}
              </Button>
              {hiddenItems.length > 0 && (
                <Button
                  size="sm"
                  variant={showHidden ? "default" : "outline"}
                  className="h-9 shrink-0"
                  onClick={() => setShowHidden((v) => !v)}
                >
                  Hidden ({hiddenItems.length})
                </Button>
              )}
            </div>

            {selectedIds.size > 0 && (
              <Card className="border-stone-200 bg-cream p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"} selected
                  </span>
                  <Button
                    size="sm"
                    disabled={setItemsHidden.isPending}
                    onClick={() =>
                      applyHidden(
                        items.filter((i) => selectedIds.has(i.id)),
                        !showHidden,
                      )
                    }
                  >
                    {setItemsHidden.isPending
                      ? "Working…"
                      : showHidden
                        ? `Unhide ${selectedIds.size}`
                        : `Hide ${selectedIds.size}`}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                    Clear selection
                  </Button>
                </div>
              </Card>
            )}

            <Card className="overflow-hidden">
              <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  {filteredItems.length} of {items.length} items — tap one to view or edit its
                  recipe.
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={quickMatchItems.length === 0}
                    onClick={runQuickMatch}
                    title="Matches bottled/canned beer, brand-name pours, etc. by name — no AI call, nothing added until you review it."
                  >
                    <Zap className="h-3.5 w-3.5" />
                    Quick-match beverages ({quickMatchItems.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={batchGenerate.isPending || unpricedItemIds.length === 0}
                    onClick={runBatchGenerate}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {batchGenerate.isPending
                      ? "Generating…"
                      : `Generate recipes for unpriced items (${unpricedItemIds.length})`}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => setImportDialogOpen(true)}
                  >
                    <FileUp className="h-3.5 w-3.5" />
                    Import from Word/PDF
                  </Button>
                </div>
              </div>

              {/* Mobile: stacked cards, no horizontal scroll/tiny text.
                  Desktop (md+): the full table. */}
              <div className="divide-y md:hidden">
                {isLoading ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    Loading real menu items…
                  </div>
                ) : filteredItems.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No items match these filters.
                  </div>
                ) : (
                  filteredItems.map((item) => {
                    const margin =
                      item.hasRecipe && item.cost != null && item.price > 0
                        ? item.price - item.cost
                        : null;
                    const marginPct = margin != null ? (margin / item.price) * 100 : null;
                    const q = quadrant(item, popMedian, marginMedian);
                    return (
                      <div key={item.id} className="flex items-start gap-1 p-3 active:bg-muted/40">
                        <div
                          className="flex shrink-0 items-center pt-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedIds.has(item.id)}
                            onCheckedChange={(checked) => toggleSelected(item.id, checked === true)}
                            aria-label={`Select ${item.name}`}
                          />
                        </div>
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 flex-col gap-1.5 text-left"
                          onClick={() => setSelectedItemId(item.id)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-medium">{item.name}</span>
                            <Badge
                              className="shrink-0 text-xs font-normal"
                              style={{
                                background: `${QUAD_COLOR[q]}22`,
                                color: QUAD_COLOR[q],
                                border: `1px solid ${QUAD_COLOR[q]}55`,
                              }}
                            >
                              {q}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-normal">
                              {item.category}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-mono">{formatItemPrice(item)}</span>
                            {margin != null ? (
                              <span className="font-mono text-muted-foreground">
                                ${margin.toFixed(2)} margin ({marginPct!.toFixed(0)}%)
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Add recipe</span>
                            )}
                          </div>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          title={
                            item.hiddenFromRecipes ? "Unhide from Recipes" : "Hide from Recipes"
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            applyHidden([item], !item.hiddenFromRecipes);
                          }}
                        >
                          {item.hiddenFromRecipes ? (
                            <Eye className="h-3.5 w-3.5" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={allFilteredSelected}
                          onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                          aria-label="Select all items"
                        />
                      </TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                      <TableHead>Quadrant</TableHead>
                      <TableHead className="w-[48px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          Loading real menu items…
                        </TableCell>
                      </TableRow>
                    ) : filteredItems.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          No items match these filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredItems.map((item) => {
                        const margin =
                          item.hasRecipe && item.cost != null && item.price > 0
                            ? item.price - item.cost
                            : null;
                        const marginPct = margin != null ? (margin / item.price) * 100 : null;
                        const q = quadrant(item, popMedian, marginMedian);
                        return (
                          <TableRow
                            key={item.id}
                            className="cursor-pointer"
                            onClick={() => setSelectedItemId(item.id)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedIds.has(item.id)}
                                onCheckedChange={(checked) =>
                                  toggleSelected(item.id, checked === true)
                                }
                                aria-label={`Select ${item.name}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-normal">
                                {item.category}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatItemPrice(item)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              {item.hasRecipe && item.cost != null
                                ? `$${item.cost.toFixed(2)}`
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {margin != null ? (
                                <>
                                  <div className="font-mono">${margin.toFixed(2)}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {marginPct!.toFixed(0)}%
                                  </div>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">Add recipe</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                className="text-xs font-normal"
                                style={{
                                  background: `${QUAD_COLOR[q]}22`,
                                  color: QUAD_COLOR[q],
                                  border: `1px solid ${QUAD_COLOR[q]}55`,
                                }}
                              >
                                {q}
                              </Badge>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title={
                                  item.hiddenFromRecipes
                                    ? "Unhide from Recipes"
                                    : "Hide from Recipes"
                                }
                                onClick={() => applyHidden([item], !item.hiddenFromRecipes)}
                              >
                                {item.hiddenFromRecipes ? (
                                  <Eye className="h-3.5 w-3.5" />
                                ) : (
                                  <EyeOff className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="prep" className="mt-4 space-y-3">
            <div className="relative md:max-w-md">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input
                value={prepQuery}
                onChange={(e) => setPrepQuery(e.target.value)}
                placeholder="Search prep recipes"
                className="pl-9 bg-white"
              />
            </div>

            <Card className="overflow-hidden">
              <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  House-made components (sauces, dressings, batches) used across dishes — cost rolls
                  up automatically wherever they're used.
                </div>
                <Button size="sm" className="gap-2" onClick={() => setNewPrepOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> New prep recipe
                </Button>
              </div>

              <div className="divide-y md:hidden">
                {isPrepLoading ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
                ) : prepRecipes.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No prep recipes yet — add one to reuse it across dishes.
                  </div>
                ) : filteredPrepRecipes.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No prep recipes match "{prepQuery}".
                  </div>
                ) : (
                  filteredPrepRecipes.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-2 p-3 text-left active:bg-muted/40"
                      onClick={() => setSelectedPrepId(p.id)}
                    >
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <PrepUsageBadge prep={p} />
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm">
                          {p.costPerYieldUnitCents != null
                            ? formatMoney(p.costPerYieldUnitCents)
                            : "—"}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {p.yieldQty} {p.yieldUnit}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Used in</TableHead>
                      <TableHead className="text-right">Yield</TableHead>
                      <TableHead className="text-right">Cost / yield unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isPrepLoading ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          Loading…
                        </TableCell>
                      </TableRow>
                    ) : prepRecipes.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          No prep recipes yet — add one to reuse it across dishes.
                        </TableCell>
                      </TableRow>
                    ) : filteredPrepRecipes.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          No prep recipes match "{prepQuery}".
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredPrepRecipes.map((p) => (
                        <TableRow
                          key={p.id}
                          className="cursor-pointer"
                          onClick={() => setSelectedPrepId(p.id)}
                        >
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell>
                            <PrepUsageBadge prep={p} />
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {p.yieldQty} {p.yieldUnit}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {p.costPerYieldUnitCents != null
                              ? formatMoney(p.costPerYieldUnitCents)
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Sheet open={!!selectedItemId} onOpenChange={(o) => !o && setSelectedItemId(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedItem && (
            <MenuItemRecipeSheet
              key={selectedItem.id}
              item={selectedItem}
              allCategories={allItemCategories}
              initialDraftLines={pendingDrafts[selectedItem.id]}
            />
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!batchSummary} onOpenChange={(o) => !o && setBatchSummary(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {batchSummary?.source === "quick" ? "Quick-matched recipes" : "AI-generated recipes"}
            </DialogTitle>
            <DialogDescription>
              {batchSummary?.source === "quick"
                ? `Matched ${batchSummary.results.length} of ${quickMatchItems.length} unpriced beverage/alcohol items by name. The rest didn't have an obvious single-ingredient match — try "Generate recipes" or add them by hand.`
                : "Click an item to review its proposed lines before adding anything."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">
            {batchSummary?.results.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No obvious matches found.
              </p>
            ) : (
              (batchSummary?.results ?? []).map((r) => {
                const item = items.find((i) => i.id === r.menuItemPosId);
                const { matched, flagged } = summarizeDraft(r.lines);
                return (
                  <button
                    key={r.menuItemPosId}
                    className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/30"
                    onClick={() => {
                      setBatchSummary(null);
                      setActiveTab("items");
                      setSelectedItemId(r.menuItemPosId);
                    }}
                  >
                    <span className="font-medium">{item?.name ?? r.menuItemPosId}</span>
                    <span className="text-xs text-muted-foreground">
                      {matched} matched{flagged > 0 && `, ${flagged} flagged`}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(o) => {
          setImportDialogOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Import from Word/PDF</DialogTitle>
            <DialogDescription>
              Upload recipe docs (.pdf, .docx up to 20 pages) — Claude finds every recipe in each
              one and matches it to a real menu item or prep recipe. Nothing is added anywhere until
              you review it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              type="file"
              accept=".pdf,.docx"
              multiple
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleImportFiles(e.target.files);
                  e.target.value = "";
                }
              }}
            />
            {inFlightImports.length > 0 && (
              <div className="max-h-[40vh] space-y-1 overflow-y-auto">
                {inFlightImports.map((imp) => (
                  <div
                    key={imp.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{imp.fileName}</span>
                    {imp.status === "ready" ? (
                      (imp.recipes?.length ?? 0) === 0 ? (
                        <span className="shrink-0 text-xs text-muted-foreground">All reviewed</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => {
                            setImportDialogOpen(false);
                            setReviewingImportId(imp.id);
                          }}
                        >
                          Review ({imp.recipes?.length ?? 0})
                        </Button>
                      )
                    ) : imp.status === "failed" ? (
                      <span className="shrink-0 text-xs text-destructive" title={imp.error ?? ""}>
                        Failed
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">Processing…</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reviewingImport} onOpenChange={(o) => !o && setReviewingImportId(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Review imported recipes</DialogTitle>
            <DialogDescription>
              {reviewingImport?.fileName} — pick where each recipe goes, or skip it. Its lines still
              need their own review once you get there.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {(reviewingImport?.recipes ?? []).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                All recipes from this file have been reviewed.
              </p>
            ) : (
              (reviewingImport?.recipes ?? []).map((r) => (
                <ImportRecipeRow
                  key={r._key}
                  recipe={r}
                  items={items}
                  creating={createPrepRecipeForImport.isPending}
                  onResolveToMenuItem={(posId) =>
                    resolveImportRecipeToMenuItem(reviewingImport!.id, r, posId)
                  }
                  onResolveToNewPrepRecipe={(name, yieldQty, yieldUnit) =>
                    resolveImportRecipeToNewPrepRecipe(
                      reviewingImport!.id,
                      r,
                      name,
                      yieldQty,
                      yieldUnit,
                    )
                  }
                  onSkip={() => removeResolvedImportRecipe(reviewingImport!.id, r._key)}
                />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={!!selectedPrepId} onOpenChange={(o) => !o && setSelectedPrepId(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedPrepId && (
            <PrepRecipeSheet
              key={selectedPrepId}
              prepRecipeId={selectedPrepId}
              prepRecipe={prepRecipes.find((p) => p.id === selectedPrepId) ?? null}
              initialDraftLines={pendingDrafts[selectedPrepId]}
              onDeleted={() => setSelectedPrepId(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <NewPrepRecipeDialog open={newPrepOpen} onOpenChange={setNewPrepOpen} />
    </>
  );
}

// A prep recipe with real ingredients but zero real usage looks
// identical to one actually rolled into a dish's cost unless
// something calls that out directly — this is that callout.
function PrepUsageBadge({ prep }: { prep: PrepRecipe }) {
  const dishCount = prep.usedByMenuItemNames.length;
  const prepCount = prep.usedByPrepRecipeNames.length;
  const allNames = [...prep.usedByMenuItemNames, ...prep.usedByPrepRecipeNames];

  if (dishCount === 0 && prepCount === 0) {
    return <span className="text-[11px] text-amber-700">Not used yet</span>;
  }
  const parts: string[] = [];
  if (dishCount > 0) parts.push(`${dishCount} dish${dishCount === 1 ? "" : "es"}`);
  if (prepCount > 0) parts.push(`${prepCount} prep recipe${prepCount === 1 ? "" : "s"}`);
  return (
    <span className="text-[11px] text-muted-foreground" title={allNames.join(", ")}>
      {parts.join(", ")}
    </span>
  );
}

// Common house-batch yield units — volume, weight, and count-based,
// covering the real range of prep recipes (sauces/dressings by the
// quart or gallon, batters/doughs by the pound, portioned items by
// count). "Other" falls back to free text for anything not listed
// rather than blocking a real, valid unit this list didn't anticipate.
const PREP_YIELD_UNITS = MEASURE_UNITS;
const OTHER_YIELD_UNIT = "__other__";
const OTHER_CATEGORY = "__other__";

function NewPrepRecipeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [yieldQty, setYieldQty] = useState("1");
  const [yieldUnit, setYieldUnit] = useState("each");
  const [customYieldUnit, setCustomYieldUnit] = useState("");
  const createPrepRecipe = useCreatePrepRecipe();
  const isCustomUnit = yieldUnit === OTHER_YIELD_UNIT;
  const resolvedYieldUnit = isCustomUnit ? customYieldUnit.trim() : yieldUnit;

  const reset = () => {
    setName("");
    setYieldQty("1");
    setYieldUnit("each");
    setCustomYieldUnit("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">New prep recipe</DialogTitle>
          <DialogDescription>
            A house-made component — a sauce, dressing, or batch — you'll use across other recipes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="prep-name">Name</Label>
            <Input
              id="prep-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="House burger sauce"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="prep-yield-qty">Yield quantity</Label>
              <Input
                id="prep-yield-qty"
                type="number"
                step="0.01"
                min="0"
                value={yieldQty}
                onChange={(e) => setYieldQty(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="prep-yield-unit">Yield unit</Label>
              <Select value={yieldUnit} onValueChange={setYieldUnit}>
                <SelectTrigger id="prep-yield-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PREP_YIELD_UNITS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_YIELD_UNIT}>Other…</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {isCustomUnit && (
            <div>
              <Label htmlFor="prep-yield-unit-custom">Custom unit</Label>
              <Input
                id="prep-yield-unit-custom"
                value={customYieldUnit}
                onChange={(e) => setCustomYieldUnit(e.target.value)}
                placeholder="e.g. keg, batch"
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            e.g. a batch that makes 2 quarts of sauce: yield quantity 2, yield unit "quart".
          </p>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || !resolvedYieldUnit || createPrepRecipe.isPending}
            onClick={() => {
              const qty = parseFloat(yieldQty);
              if (!Number.isFinite(qty) || qty <= 0 || !resolvedYieldUnit) return;
              createPrepRecipe.mutate(
                { name: name.trim(), yieldQty: qty, yieldUnit: resolvedYieldUnit },
                { onSuccess: () => onOpenChange(false) },
              );
            }}
          >
            {createPrepRecipe.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Bulk recipe import review ----------
// One row per recipe Claude found in an uploaded doc. Resolving it
// (attach to a real item, create as a new prep recipe, or skip) just
// hands the raw lines back up to RecipesPage, which seeds them into
// the same pendingDrafts state the AI generator/quick-match already
// use — the actual line-by-line review happens in the familiar
// MenuItemRecipeSheet/PrepRecipeSheet flow, not here.
function ImportRecipeRow({
  recipe,
  items,
  creating,
  onResolveToMenuItem,
  onResolveToNewPrepRecipe,
  onSkip,
}: {
  recipe: ImportRecipeDraft;
  items: RealMenuItem[];
  creating: boolean;
  onResolveToMenuItem: (posId: string) => void;
  onResolveToNewPrepRecipe: (name: string, yieldQty: number, yieldUnit: string) => void;
  onSkip: () => void;
}) {
  const defaultChoice =
    recipe.targetKind === "menu_item" && recipe.matchedMenuItemPosId
      ? recipe.matchedMenuItemPosId
      : recipe.targetKind === "prep_recipe"
        ? NEW_PREP_RECIPE_TARGET
        : SKIP_TARGET;
  const [choice, setChoice] = useState(defaultChoice);
  const [prepName, setPrepName] = useState(recipe.proposedName);
  const [prepYieldQty, setPrepYieldQty] = useState("1");
  const [prepYieldUnit, setPrepYieldUnit] = useState("each");
  const [prepCustomYieldUnit, setPrepCustomYieldUnit] = useState("");
  const isCustomPrepYieldUnit = prepYieldUnit === OTHER_YIELD_UNIT;
  const resolvedPrepYieldUnit = isCustomPrepYieldUnit ? prepCustomYieldUnit.trim() : prepYieldUnit;
  const isNewPrepChoice = choice === NEW_PREP_RECIPE_TARGET;
  const isSkipChoice = choice === SKIP_TARGET;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{recipe.proposedName}</div>
          <div className="text-xs text-muted-foreground">
            {recipe.lines.length} line{recipe.lines.length === 1 ? "" : "s"} found
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground hover:underline"
          onClick={onSkip}
        >
          Skip
        </button>
      </div>

      <Select value={choice} onValueChange={setChoice}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
          <SelectItem value={NEW_PREP_RECIPE_TARGET}>New prep recipe…</SelectItem>
          <SelectItem value={SKIP_TARGET}>Skip</SelectItem>
        </SelectContent>
      </Select>

      {isNewPrepChoice && (
        <div className="space-y-2 rounded-md bg-muted/20 p-2">
          <Input
            value={prepName}
            onChange={(e) => setPrepName(e.target.value)}
            placeholder="Prep recipe name"
            className="h-8"
          />
          <div className="flex gap-1.5">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={prepYieldQty}
              onChange={(e) => setPrepYieldQty(e.target.value)}
              placeholder="yield"
              className="h-8 w-20"
            />
            <Select value={prepYieldUnit} onValueChange={setPrepYieldUnit}>
              <SelectTrigger className="h-8 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PREP_YIELD_UNITS.map((u) => (
                  <SelectItem key={u.value} value={u.value}>
                    {u.label}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER_YIELD_UNIT}>Other…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isCustomPrepYieldUnit && (
            <Input
              value={prepCustomYieldUnit}
              onChange={(e) => setPrepCustomYieldUnit(e.target.value)}
              placeholder="e.g. keg, batch"
              className="h-8"
            />
          )}
        </div>
      )}

      <Button
        size="sm"
        className="w-full"
        disabled={
          isSkipChoice ||
          creating ||
          (isNewPrepChoice && (!prepName.trim() || !resolvedPrepYieldUnit))
        }
        onClick={() => {
          if (isNewPrepChoice) {
            const qty = parseFloat(prepYieldQty);
            if (!Number.isFinite(qty) || qty <= 0 || !resolvedPrepYieldUnit) return;
            onResolveToNewPrepRecipe(prepName.trim(), qty, resolvedPrepYieldUnit);
          } else if (!isSkipChoice) {
            onResolveToMenuItem(choice);
          }
        }}
      >
        {creating ? "Creating…" : isNewPrepChoice ? "Create & review lines →" : "Review lines →"}
      </Button>
    </div>
  );
}

// ---------- Menu item recipe editor ----------

function MenuItemRecipeSheet({
  item,
  allCategories,
  initialDraftLines,
}: {
  item: RealMenuItem;
  allCategories: string[];
  initialDraftLines?: DraftLine[];
}) {
  // A menu item sold at more than one real price (Bottle/Pint/
  // Pitcher, a Happy Hour variant...) gets its own tab per size here,
  // each with a completely separate recipe — a pint pour costs
  // differently than a pitcher, so one shared recipe can't represent
  // both. Items with no observed tiers (the vast majority) never show
  // this row at all and behave exactly as before.
  const { data: priceTiers = [] } = useMenuItemPriceTiers(item.id);
  const [activeTierId, setActiveTierId] = useState<string | null | undefined>(undefined);
  const resolvedTierId = activeTierId !== undefined ? activeTierId : (priceTiers[0]?.id ?? null);

  const { data: lines = [], isLoading } = useRecipeLinesForItem(item.id, resolvedTierId);
  const { data: ingredients = [] } = useIngredients();
  const { data: prepRecipes = [] } = usePrepRecipes();
  const addLine = useAddRecipeLine();
  const deleteLine = useDeleteRecipeLine();
  const generateRecipe = useGenerateRecipe();
  const [draftLines, setDraftLines] = useState<DraftLine[] | null>(initialDraftLines ?? null);
  const updateCategory = useUpdateItemCategory();
  const updateCost = useUpdateItemCost();

  const totalCents = useMemo(() => {
    if (lines.length === 0) return null;
    let sum = 0;
    for (const l of lines) {
      if (l.ingredientId != null) {
        if (l.ingredientCostCents == null || l.ingredientUnit == null) return null;
        const converted = convertQuantityToIngredientUnit(
          l.quantity,
          l.unit,
          l.ingredientUnit,
          l.ingredientContainerSizeMl,
          l.ingredientContainerSizeG,
        );
        if (converted == null) return null;
        sum += converted * l.ingredientCostCents;
      } else {
        if (l.prepRecipeCostPerYieldUnitCents == null) return null;
        sum += l.quantity * l.prepRecipeCostPerYieldUnitCents;
      }
    }
    return Math.round(sum);
  }, [lines]);

  // Margin has to compare against THIS tier's real price, not
  // item.price — that's the item's overall (often cheapest-tier)
  // display price, which would understate margin on every pricier
  // tier the same way the raw sales data used to before price tiers
  // existed.
  const activeTierPriceCents = priceTiers.find((t) => t.id === resolvedTierId)?.lastPriceCents;
  const priceCents =
    resolvedTierId != null && activeTierPriceCents != null
      ? activeTierPriceCents
      : Math.round(item.price * 100);
  const margin = totalCents != null ? priceCents - totalCents : null;
  const marginPct = margin != null && priceCents > 0 ? (margin / priceCents) * 100 : null;
  const foodCostPct = totalCents != null && priceCents > 0 ? (totalCents / priceCents) * 100 : null;

  const [categoryChoice, setCategoryChoice] = useState(item.category);
  const [customCategory, setCustomCategory] = useState("");
  const isCustomCategory = categoryChoice === OTHER_CATEGORY;
  const saveCategory = (category: string) => {
    if (!category.trim()) return;
    updateCategory.mutate({
      locationId: item.locationId,
      posId: item.id,
      category: category.trim(),
    });
  };

  const [costInput, setCostInput] = useState(item.cost != null ? item.cost.toFixed(2) : "");

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-serif text-2xl">{item.name}</SheetTitle>
        <SheetDescription>{item.rawCategory}</SheetDescription>
      </SheetHeader>

      {priceTiers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {priceTiers.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTierId(t.id)}
              className={`rounded-full border px-3 py-1 transition ${
                resolvedTierId === t.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:border-foreground/30"
              }`}
            >
              {t.tierName}
              {t.lastPriceCents != null && (
                <span className="ml-1 opacity-70">{formatMoney(t.lastPriceCents)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-3 rounded-xl border p-4 text-sm">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label
              htmlFor="item-category"
              className="text-xs uppercase tracking-widest text-muted-foreground"
            >
              Category
            </Label>
            {item.categoryOverride != null && (
              <button
                type="button"
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => {
                  updateCategory.mutate({
                    locationId: item.locationId,
                    posId: item.id,
                    category: null,
                  });
                  setCategoryChoice(item.rawCategory);
                }}
              >
                Reset to POS category ({item.rawCategory})
              </button>
            )}
          </div>
          <div className="flex gap-1.5">
            <Select
              value={categoryChoice}
              onValueChange={(v) => {
                setCategoryChoice(v);
                if (v !== OTHER_CATEGORY) saveCategory(v);
              }}
            >
              <SelectTrigger id="item-category" className="h-8 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allCategories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER_CATEGORY}>Other…</SelectItem>
              </SelectContent>
            </Select>
            {isCustomCategory && (
              <>
                <Input
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="New category"
                  className="h-8 flex-1"
                />
                <Button
                  size="sm"
                  className="h-8"
                  disabled={!customCategory.trim()}
                  onClick={() => saveCategory(customCategory)}
                >
                  Save
                </Button>
              </>
            )}
          </div>
        </div>

        <div>
          <Label
            htmlFor="item-cost"
            className="text-xs uppercase tracking-widest text-muted-foreground"
          >
            Cost per unit{" "}
            {item.hasRecipe && <span className="normal-case">(fallback if no recipe)</span>}
          </Label>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              id="item-cost"
              type="number"
              step="0.01"
              min="0"
              value={costInput}
              onChange={(e) => setCostInput(e.target.value)}
              className="h-8 w-24"
              placeholder="0.00"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={updateCost.isPending}
              onClick={() => {
                const num = parseFloat(costInput);
                updateCost.mutate({
                  locationId: item.locationId,
                  posId: item.id,
                  costCents: Number.isFinite(num) && num >= 0 ? Math.round(num * 100) : null,
                });
              }}
            >
              {updateCost.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border bg-muted/20 p-4 text-sm">
        {totalCents != null && marginPct != null && foodCostPct != null ? (
          <>
            Costs <span className="font-medium">{formatMoney(totalCents)}</span> · Sells{" "}
            <span className="font-medium">
              {resolvedTierId != null && activeTierPriceCents != null
                ? formatMoney(activeTierPriceCents)
                : formatItemPrice(item, { lowercase: true })}
            </span>{" "}
            · Margin <span className="font-medium">{marginPct.toFixed(0)}%</span> (food cost{" "}
            {foodCostPct.toFixed(0)}%)
          </>
        ) : (
          <span className="text-muted-foreground">
            {lines.length === 0
              ? "No recipe yet — add ingredients or a prep recipe below."
              : totalCents == null
                ? "Can't compute cost yet — a line below has no cost (an ingredient with no invoice yet, or an uncosted prep recipe)."
                : "Can't compute margin — this item has no price set."}
          </span>
        )}
      </div>

      <div className="mt-4">
        <RecipeLineList
          lines={lines}
          isLoading={isLoading}
          onDelete={(id) => deleteLine.mutate(id)}
          deletePending={deleteLine.isPending}
        />
      </div>

      {/* AI generation doesn't know about size tiers — offered only for
          the base/no-tier recipe so a drafted line never lands somewhere
          other than the tab currently being viewed. */}
      {lines.length === 0 && draftLines == null && resolvedTierId == null && (
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={generateRecipe.isPending}
            onClick={() =>
              generateRecipe.mutate([item.id], {
                onSuccess: (recipes) => setDraftLines(tagDraftLines(recipes[0]?.lines ?? [])),
              })
            }
          >
            <Sparkles className="h-3.5 w-3.5" />
            {generateRecipe.isPending ? "Generating…" : "Generate with AI"}
          </Button>
          {generateRecipe.error && (
            <p className="mt-2 text-xs text-destructive">
              {generateRecipe.error instanceof Error
                ? generateRecipe.error.message
                : "Generation failed"}
            </p>
          )}
        </div>
      )}

      {draftLines != null && resolvedTierId == null && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> AI-generated — review before adding
            </div>
            <button
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => setDraftLines(null)}
            >
              Dismiss
            </button>
          </div>
          <GeneratedRecipeReview
            target={{ kind: "menu_item", menuItemPosId: item.id }}
            lines={draftLines}
            ingredients={ingredients}
            prepRecipes={prepRecipes}
            onLineResolved={(key) =>
              setDraftLines((cur) => (cur ? cur.filter((l) => l._key !== key) : cur))
            }
          />
        </div>
      )}

      <AddLineForm
        ingredients={ingredients}
        prepRecipes={prepRecipes}
        onAdd={(target, quantity, unit) =>
          addLine.mutate({
            menuItemPosId: item.id,
            quantity,
            unit,
            priceTierId: resolvedTierId,
            ...(target.kind === "ingredient"
              ? { ingredientId: target.id }
              : { prepRecipeId: target.id }),
          } as Parameters<typeof addLine.mutate>[0])
        }
        pending={addLine.isPending}
        error={addLine.error instanceof Error ? addLine.error.message : null}
      />
    </>
  );
}

// ---------- Prep recipe editor ----------

function PrepRecipeSheet({
  prepRecipeId,
  prepRecipe,
  initialDraftLines,
  onDeleted,
}: {
  prepRecipeId: string;
  prepRecipe: PrepRecipe | null;
  initialDraftLines?: DraftLine[];
  onDeleted: () => void;
}) {
  const { data: lines = [], isLoading } = usePrepRecipeLinesFor(prepRecipeId);
  const { data: ingredients = [] } = useIngredients();
  // A prep recipe can't reference itself directly (or transitively —
  // the mutation itself is the real guard for the transitive case);
  // excluding it here avoids offering the obviously-invalid choice.
  const { data: allPrepRecipes = [] } = usePrepRecipes();
  const availableSubRecipes = allPrepRecipes.filter((p) => p.id !== prepRecipeId);
  const addLine = useAddPrepRecipeLine();
  const deleteLine = useDeletePrepRecipeLine();
  const deletePrepRecipe = useDeletePrepRecipe();
  const updatePrepRecipe = useUpdatePrepRecipe();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [draftLines, setDraftLines] = useState<DraftLine[] | null>(initialDraftLines ?? null);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(prepRecipe?.name ?? "");
  const [editYieldQty, setEditYieldQty] = useState(String(prepRecipe?.yieldQty ?? ""));
  const [editYieldUnit, setEditYieldUnit] = useState(prepRecipe?.yieldUnit ?? "each");
  const [editCustomYieldUnit, setEditCustomYieldUnit] = useState("");
  const isCustomEditYieldUnit = editYieldUnit === OTHER_YIELD_UNIT;
  const resolvedEditYieldUnit = isCustomEditYieldUnit ? editCustomYieldUnit.trim() : editYieldUnit;

  const startEditing = () => {
    if (!prepRecipe) return;
    setEditName(prepRecipe.name);
    setEditYieldQty(String(prepRecipe.yieldQty));
    const knownUnit = PREP_YIELD_UNITS.some((u) => u.value === prepRecipe.yieldUnit);
    setEditYieldUnit(knownUnit ? prepRecipe.yieldUnit : OTHER_YIELD_UNIT);
    setEditCustomYieldUnit(knownUnit ? "" : prepRecipe.yieldUnit);
    setIsEditing(true);
  };

  const linesAsRecipeLines: RecipeLine[] = lines.map((l) => ({
    id: l.id,
    ingredientId: l.ingredientId,
    ingredientName: l.ingredientName,
    ingredientUnit: l.ingredientUnit,
    ingredientCostCents: l.ingredientCostCents,
    ingredientContainerSizeMl: l.ingredientContainerSizeMl,
    ingredientContainerSizeG: l.ingredientContainerSizeG,
    prepRecipeId: l.subPrepRecipeId,
    prepRecipeName: l.subPrepRecipeName,
    prepRecipeCostPerYieldUnitCents: l.subPrepRecipeCostPerYieldUnitCents,
    quantity: l.quantity,
    unit: l.unit,
  }));

  return (
    <>
      {isEditing ? (
        <div className="space-y-3 rounded-xl border p-4">
          <div>
            <Label htmlFor="prep-edit-name">Name</Label>
            <Input
              id="prep-edit-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="prep-edit-yield-qty">Yield quantity</Label>
              <Input
                id="prep-edit-yield-qty"
                type="number"
                step="0.01"
                min="0"
                value={editYieldQty}
                onChange={(e) => setEditYieldQty(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="prep-edit-yield-unit">Yield unit</Label>
              <Select value={editYieldUnit} onValueChange={setEditYieldUnit}>
                <SelectTrigger id="prep-edit-yield-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PREP_YIELD_UNITS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_YIELD_UNIT}>Other…</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {isCustomEditYieldUnit && (
            <div>
              <Label htmlFor="prep-edit-yield-unit-custom">Custom unit</Label>
              <Input
                id="prep-edit-yield-unit-custom"
                value={editCustomYieldUnit}
                onChange={(e) => setEditCustomYieldUnit(e.target.value)}
                placeholder="e.g. keg, batch"
              />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!editName.trim() || !resolvedEditYieldUnit || updatePrepRecipe.isPending}
              onClick={() => {
                const qty = parseFloat(editYieldQty);
                if (!Number.isFinite(qty) || qty <= 0 || !resolvedEditYieldUnit) return;
                updatePrepRecipe.mutate(
                  {
                    id: prepRecipeId,
                    name: editName.trim(),
                    yieldQty: qty,
                    yieldUnit: resolvedEditYieldUnit,
                  },
                  { onSuccess: () => setIsEditing(false) },
                );
              }}
            >
              {updatePrepRecipe.isPending ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <SheetHeader className="pr-8">
          <SheetTitle className="font-serif text-2xl">
            {prepRecipe?.name ?? "Prep recipe"}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2">
            <span>
              Yields {prepRecipe?.yieldQty} {prepRecipe?.yieldUnit}
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              onClick={startEditing}
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
          </SheetDescription>
        </SheetHeader>
      )}

      <div className="mt-4 rounded-xl border bg-muted/20 p-4 text-sm">
        {prepRecipe?.costPerYieldUnitCents != null ? (
          <>
            Costs{" "}
            <span className="font-medium">{formatMoney(prepRecipe.costPerYieldUnitCents)}</span> per{" "}
            {prepRecipe.yieldUnit}
          </>
        ) : (
          <span className="text-muted-foreground">
            {lines.length === 0
              ? "No lines yet — add ingredients or another prep recipe below."
              : "Can't compute cost yet — a line below has no cost."}
          </span>
        )}
      </div>

      {prepRecipe && (
        <div className="mt-3 text-sm">
          {prepRecipe.usedByMenuItemNames.length === 0 &&
          prepRecipe.usedByPrepRecipeNames.length === 0 ? (
            <p className="text-amber-700">
              Not used anywhere yet — its cost won't affect any dish's margin until it's added to
              one.
            </p>
          ) : (
            <div className="text-muted-foreground">
              <span className="font-medium text-foreground">Used in: </span>
              {[...prepRecipe.usedByMenuItemNames, ...prepRecipe.usedByPrepRecipeNames].join(", ")}
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <RecipeLineList
          lines={linesAsRecipeLines}
          isLoading={isLoading}
          onDelete={(id) => deleteLine.mutate(id)}
          deletePending={deleteLine.isPending}
        />
      </div>

      {draftLines != null && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Imported — review before adding
            </div>
            <button
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => setDraftLines(null)}
            >
              Dismiss
            </button>
          </div>
          <GeneratedRecipeReview
            target={{ kind: "prep_recipe", prepRecipeId }}
            lines={draftLines}
            ingredients={ingredients}
            prepRecipes={allPrepRecipes}
            onLineResolved={(key) =>
              setDraftLines((cur) => (cur ? cur.filter((l) => l._key !== key) : cur))
            }
          />
        </div>
      )}

      <AddLineForm
        ingredients={ingredients}
        prepRecipes={availableSubRecipes}
        onAdd={(target, quantity, unit) =>
          addLine.mutate({
            prepRecipeId,
            quantity,
            unit,
            ...(target.kind === "ingredient"
              ? { ingredientId: target.id }
              : { subPrepRecipeId: target.id }),
          } as Parameters<typeof addLine.mutate>[0])
        }
        pending={addLine.isPending}
        error={addLine.error instanceof Error ? addLine.error.message : null}
      />

      <div className="mt-6 border-t pt-4">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-destructive hover:text-destructive"
          disabled={deletePrepRecipe.isPending}
          onClick={() => {
            setDeleteError(null);
            deletePrepRecipe.mutate(prepRecipeId, {
              onSuccess: onDeleted,
              onError: () =>
                setDeleteError(
                  "Can't delete — this prep recipe is still used in another recipe. Remove it from there first.",
                ),
            });
          }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete prep recipe
        </Button>
        {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}
      </div>
    </>
  );
}

// ---------- Shared line list + add form ----------

function RecipeLineList({
  lines,
  isLoading,
  onDelete,
  deletePending,
}: {
  lines: RecipeLine[];
  isLoading: boolean;
  onDelete: (id: string) => void;
  deletePending: boolean;
}) {
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No lines yet.</p>;
  return (
    <div className="rounded-md border divide-y">
      {lines.map((l) => {
        const isPrep = l.prepRecipeId != null;
        const name = isPrep ? l.prepRecipeName : l.ingredientName;
        const unitCostCents = isPrep ? l.prepRecipeCostPerYieldUnitCents : l.ingredientCostCents;
        // A prep-recipe sub-line's unit IS its cost basis directly
        // (locked to the sub-recipe's own yield unit); an ingredient
        // line's unit may differ from what the ingredient is priced
        // per (5 oz of a bottle priced "each"), so convert first.
        const lineTotalCents =
          unitCostCents == null
            ? null
            : isPrep
              ? l.quantity * unitCostCents
              : l.ingredientUnit == null
                ? null
                : (() => {
                    const converted = convertQuantityToIngredientUnit(
                      l.quantity,
                      l.unit,
                      l.ingredientUnit,
                      l.ingredientContainerSizeMl,
                      l.ingredientContainerSizeG,
                    );
                    return converted == null ? null : converted * unitCostCents;
                  })();
        return (
          <div key={l.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <div>
              <div className="flex items-center gap-1.5">
                {name}
                {isPrep && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    prep recipe
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {l.quantity} {l.unit}
                {lineTotalCents != null && ` · ${formatMoney(lineTotalCents)}`}
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => onDelete(l.id)}
              disabled={deletePending}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

type LineTarget = { kind: "ingredient" | "prep"; id: string };

function AddLineForm({
  ingredients,
  prepRecipes,
  onAdd,
  pending,
  error,
}: {
  ingredients: {
    id: string;
    name: string;
    unit: string;
    containerSizeMl: number | null;
    containerSizeG: number | null;
  }[];
  prepRecipes: PrepRecipe[];
  onAdd: (target: LineTarget, quantity: number, unit: string) => void;
  pending: boolean;
  error?: string | null;
}) {
  const [mode, setMode] = useState<"ingredient" | "prep">("ingredient");
  const [targetId, setTargetId] = useState("");
  const [quantity, setQuantity] = useState("");
  // Only meaningful in ingredient mode — which unit the typed quantity
  // is in, which may differ from the ingredient's own priced unit
  // (5 oz of a wine bought "each"). Prep-recipe lines always stay
  // locked to the sub-recipe's own yield unit — there's no ambiguity
  // to pick from there.
  const [lineUnit, setLineUnit] = useState("");

  const selectedIngredient = ingredients.find((i) => i.id === targetId);
  const selectedPrep = prepRecipes.find((p) => p.id === targetId);
  const compatibleUnits = selectedIngredient
    ? compatibleLineUnits(
        selectedIngredient.unit,
        selectedIngredient.containerSizeMl,
        selectedIngredient.containerSizeG,
      )
    : [];
  const unit =
    mode === "ingredient"
      ? lineUnit || selectedIngredient?.unit || ""
      : (selectedPrep?.yieldUnit ?? "");

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-1 text-xs">
        {(["ingredient", "prep"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setTargetId("");
            }}
            className={`rounded-full border px-3 py-1 transition ${
              mode === m
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:border-foreground/30"
            }`}
          >
            {m === "ingredient" ? "Ingredient" : "Prep recipe"}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={targetId}
          onValueChange={(id) => {
            setTargetId(id);
            setLineUnit("");
            // A prep recipe's own yield is a reasonable starting guess
            // for "how much of it goes into one serving" — most
            // house-made batches (a lemonade batch, a single sauce
            // portion) are sized to yield exactly one serving. Only
            // pre-fills an empty box, and it's still fully editable —
            // this is a default, not a locked-in answer, since a
            // bigger batch used across several servings needs a
            // different number here.
            if (mode === "prep" && quantity.trim() === "") {
              const prep = prepRecipes.find((p) => p.id === id);
              if (prep) setQuantity(String(prep.yieldQty));
            }
          }}
        >
          <SelectTrigger className="h-8 flex-1">
            <SelectValue
              placeholder={mode === "ingredient" ? "Add ingredient…" : "Add prep recipe…"}
            />
          </SelectTrigger>
          <SelectContent>
            {(mode === "ingredient" ? ingredients : prepRecipes).map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          step="0.01"
          min="0"
          placeholder="qty"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="h-8 w-20"
        />
        {mode === "ingredient" && selectedIngredient && compatibleUnits.length > 1 ? (
          <Select value={unit} onValueChange={setLineUnit}>
            <SelectTrigger className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {compatibleUnits.map((u) => (
                <SelectItem key={u} value={u}>
                  {unitLabel(u)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="w-12 text-xs text-muted-foreground">{unit}</span>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!targetId || !quantity || pending}
          onClick={() => {
            const qty = parseFloat(quantity);
            if (!Number.isFinite(qty) || qty <= 0 || !unit) return;
            onAdd({ kind: mode === "ingredient" ? "ingredient" : "prep", id: targetId }, qty, unit);
            setQuantity("");
          }}
        >
          Add
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ---------- AI-generated recipe review ----------
// A draft only — nothing here is a real recipe_lines row until the
// owner hits "Add" on a specific line, which goes through the exact
// same useAddRecipeLine mutation manual entry uses. Dismissing a line
// (or the whole draft) just drops it from local React state.

// Reviewing a draft can commit into either a menu item's own recipe
// or a prep recipe's own sub-ingredient list — same review row either
// way, just a different mutation (and, for a prep recipe target, the
// sub-recipe key is subPrepRecipeId, not prepRecipeId, since
// prepRecipeId here already names the OWNING recipe).
type DraftTarget =
  | { kind: "menu_item"; menuItemPosId: string }
  | { kind: "prep_recipe"; prepRecipeId: string };

function GeneratedRecipeReview({
  target,
  lines,
  ingredients,
  prepRecipes,
  onLineResolved,
}: {
  target: DraftTarget;
  lines: DraftLine[];
  ingredients: {
    id: string;
    name: string;
    unit: string;
    containerSizeMl: number | null;
    containerSizeG: number | null;
  }[];
  prepRecipes: PrepRecipe[];
  onLineResolved: (key: string) => void;
}) {
  const addRecipeLine = useAddRecipeLine();
  const addPrepRecipeLine = useAddPrepRecipeLine();
  // A prep recipe can't reference itself as one of its own lines —
  // mirrors PrepRecipeSheet's own availableSubRecipes filter.
  const availablePrepRecipes =
    target.kind === "prep_recipe"
      ? prepRecipes.filter((p) => p.id !== target.prepRecipeId)
      : prepRecipes;

  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Claude didn't propose any lines for this item.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {lines.map((line) =>
        line.kind === "new_prep_recipe" ? (
          <NewPrepRecipeFlag
            key={line._key}
            line={line}
            onDismiss={() => onLineResolved(line._key)}
          />
        ) : (
          <GeneratedLineRow
            key={line._key}
            line={line}
            ingredients={ingredients}
            prepRecipes={availablePrepRecipes}
            pending={
              target.kind === "menu_item" ? addRecipeLine.isPending : addPrepRecipeLine.isPending
            }
            onAdd={(lineTarget, quantity, unit) => {
              if (target.kind === "menu_item") {
                addRecipeLine.mutate(
                  {
                    menuItemPosId: target.menuItemPosId,
                    quantity,
                    unit,
                    ...(lineTarget.kind === "ingredient"
                      ? { ingredientId: lineTarget.id }
                      : { prepRecipeId: lineTarget.id }),
                  } as Parameters<typeof addRecipeLine.mutate>[0],
                  { onSuccess: () => onLineResolved(line._key) },
                );
              } else {
                addPrepRecipeLine.mutate(
                  {
                    prepRecipeId: target.prepRecipeId,
                    quantity,
                    unit,
                    ...(lineTarget.kind === "ingredient"
                      ? { ingredientId: lineTarget.id }
                      : { subPrepRecipeId: lineTarget.id }),
                  } as Parameters<typeof addPrepRecipeLine.mutate>[0],
                  { onSuccess: () => onLineResolved(line._key) },
                );
              }
            }}
            onDismiss={() => onLineResolved(line._key)}
          />
        ),
      )}
    </div>
  );
}

const CONFIDENCE_STYLE: Record<GeneratedRecipeLine["confidence"], string> = {
  high: "border-green-600/40 text-green-700",
  medium: "border-amber-600/40 text-amber-700",
  low: "border-muted-foreground/40 text-muted-foreground",
};

function GeneratedLineRow({
  line,
  ingredients,
  prepRecipes,
  onAdd,
  onDismiss,
  pending,
}: {
  line: GeneratedRecipeLine;
  ingredients: {
    id: string;
    name: string;
    unit: string;
    containerSizeMl: number | null;
    containerSizeG: number | null;
  }[];
  prepRecipes: PrepRecipe[];
  onAdd: (target: LineTarget, quantity: number, unit: string) => void;
  onDismiss: () => void;
  pending: boolean;
}) {
  const [mode, setMode] = useState<"ingredient" | "prep">(
    line.kind === "prep_recipe" ? "prep" : "ingredient",
  );
  const [targetId, setTargetId] = useState(
    line.kind === "ingredient"
      ? (line.ingredientId ?? "")
      : line.kind === "prep_recipe"
        ? (line.prepRecipeId ?? "")
        : "",
  );
  const [quantity, setQuantity] = useState(line.quantity != null ? String(line.quantity) : "");
  // Defaults to the matched ingredient's own unit (never trusted from
  // Claude's own output — same discipline as the rest of this row) but
  // still overridable, same as AddLineForm.
  const [lineUnit, setLineUnit] = useState("");

  const selectedIngredient = ingredients.find((i) => i.id === targetId);
  const selectedPrep = prepRecipes.find((p) => p.id === targetId);
  const compatibleUnits = selectedIngredient
    ? compatibleLineUnits(
        selectedIngredient.unit,
        selectedIngredient.containerSizeMl,
        selectedIngredient.containerSizeG,
      )
    : [];
  const unit =
    mode === "ingredient"
      ? lineUnit || selectedIngredient?.unit || ""
      : (selectedPrep?.yieldUnit ?? "");
  const isMatched = (line.kind === "ingredient" || line.kind === "prep_recipe") && !!targetId;

  return (
    <div className="rounded-md border p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          {!isMatched && line.proposedName && (
            <span className="truncate text-muted-foreground">Proposed: {line.proposedName}</span>
          )}
          <Badge
            variant="outline"
            className={`shrink-0 text-[10px] font-normal ${CONFIDENCE_STYLE[line.confidence]}`}
          >
            {line.confidence} confidence
          </Badge>
        </div>
        <button
          className="shrink-0 text-xs text-muted-foreground hover:underline"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
      {line.notes && <p className="text-xs text-muted-foreground">{line.notes}</p>}
      <div className="flex gap-1 text-xs">
        {(["ingredient", "prep"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setTargetId("");
              setLineUnit("");
            }}
            className={`rounded-full border px-3 py-1 transition ${
              mode === m
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card hover:border-foreground/30"
            }`}
          >
            {m === "ingredient" ? "Ingredient" : "Prep recipe"}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={targetId}
          onValueChange={(id) => {
            setTargetId(id);
            setLineUnit("");
          }}
        >
          <SelectTrigger className="h-8 flex-1">
            <SelectValue
              placeholder={mode === "ingredient" ? "Pick ingredient…" : "Pick prep recipe…"}
            />
          </SelectTrigger>
          <SelectContent>
            {(mode === "ingredient" ? ingredients : prepRecipes).map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          step="0.01"
          min="0"
          placeholder="qty"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="h-8 w-20"
        />
        {mode === "ingredient" && selectedIngredient && compatibleUnits.length > 1 ? (
          <Select value={unit} onValueChange={setLineUnit}>
            <SelectTrigger className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {compatibleUnits.map((u) => (
                <SelectItem key={u} value={u}>
                  {unitLabel(u)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="w-12 text-xs text-muted-foreground">{unit}</span>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!targetId || !quantity || pending}
          onClick={() => {
            const qty = parseFloat(quantity);
            if (!Number.isFinite(qty) || qty <= 0 || !unit) return;
            onAdd({ kind: mode === "ingredient" ? "ingredient" : "prep", id: targetId }, qty, unit);
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function NewPrepRecipeFlag({
  line,
  onDismiss,
}: {
  line: GeneratedRecipeLine;
  onDismiss: () => void;
}) {
  return (
    <div className="space-y-1.5 rounded-md border border-dashed bg-muted/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">
          House-made — needs a prep recipe: {line.proposedName ?? "Untitled"}
        </span>
        <button
          className="shrink-0 text-xs text-muted-foreground hover:underline"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
      {line.notes && <p className="text-xs text-muted-foreground">{line.notes}</p>}
      {line.proposedSubIngredients && line.proposedSubIngredients.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-muted-foreground">
          {line.proposedSubIngredients.map((s, i) => (
            <li key={i}>
              {s.name} — {s.quantity} {s.unit}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Build this on the Prep recipes tab, then come back and add it above.
      </p>
    </div>
  );
}
