import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Sparkles, Trash2 } from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { useDateRange } from "@/lib/date-range-context";
import { useProductMix, type RealMenuItem } from "@/lib/pos/queries";
import {
  useIngredients,
  useRecipeLinesForItem,
  useAddRecipeLine,
  useDeleteRecipeLine,
  usePrepRecipes,
  useCreatePrepRecipe,
  useDeletePrepRecipe,
  usePrepRecipeLinesFor,
  useAddPrepRecipeLine,
  useDeletePrepRecipeLine,
  useGenerateRecipe,
  type RecipeLine,
  type PrepRecipe,
  type PrepRecipeLine,
  type GeneratedRecipe,
  type GeneratedRecipeLine,
} from "@/lib/boh/queries";
import { quadrant, QUAD_COLOR, formatItemPrice } from "@/lib/boh/menuEngineering";
import { classifyMenuItemCategory, CATEGORIES } from "@/lib/boh/menu-category";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
      { title: "Recipes · Thrasher's Pub" },
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

function RecipesPage() {
  const { item: deepLinkItemId } = Route.useSearch();
  const { dateRange } = useDateRange();
  const [activeTab, setActiveTab] = useState<"items" | "prep">("items");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedPrepId, setSelectedPrepId] = useState<string | null>(null);
  const [newPrepOpen, setNewPrepOpen] = useState(false);
  const [batchSummary, setBatchSummary] = useState<GeneratedRecipe[] | null>(null);
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, DraftLine[]>>({});
  const batchGenerate = useGenerateRecipe();

  const [categoryTab, setCategoryTab] = useState<string>("All");
  const [itemQuery, setItemQuery] = useState("");
  const [unpricedOnly, setUnpricedOnly] = useState(false);
  const [prepQuery, setPrepQuery] = useState("");

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
  const unpricedItemIds = useMemo(() => items.filter((i) => !i.hasRecipe).map((i) => i.id), [items]);

  const filteredItems = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryTab !== "All" && classifyMenuItemCategory(item.category, item.name) !== categoryTab) return false;
      if (unpricedOnly && item.hasRecipe) return false;
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, categoryTab, unpricedOnly, itemQuery]);

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
    setPendingDrafts(drafts);
    setBatchSummary(results);
  }

  function summarizeDraft(lines: GeneratedRecipeLine[]) {
    const matched = lines.filter(
      (l) => (l.kind === "ingredient" && l.ingredientId) || (l.kind === "prep_recipe" && l.prepRecipeId),
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
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "items" | "prep")}>
          <TabsList className="bg-card">
            <TabsTrigger value="items">Menu items</TabsTrigger>
            <TabsTrigger value="prep">Prep recipes</TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="mt-4 space-y-3">
            <div className="max-w-full overflow-x-auto">
              <Tabs value={categoryTab} onValueChange={setCategoryTab}>
                <TabsList className="bg-[hsl(var(--cream))] border border-stone-200">
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
            </div>

            <Card className="overflow-hidden">
              <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  {filteredItems.length} of {items.length} items — tap one to view or edit its recipe.
                </div>
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
              </div>

              {/* Mobile: stacked cards, no horizontal scroll/tiny text.
                  Desktop (md+): the full table. */}
              <div className="divide-y md:hidden">
                {isLoading ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">Loading real menu items…</div>
                ) : filteredItems.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">No items match these filters.</div>
                ) : (
                  filteredItems.map((item) => {
                    const margin =
                      item.hasRecipe && item.cost != null && item.price > 0 ? item.price - item.cost : null;
                    const marginPct = margin != null ? (margin / item.price) * 100 : null;
                    const q = quadrant(item, popMedian, marginMedian);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="flex w-full flex-col gap-1.5 p-3 text-left active:bg-muted/40"
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
                    );
                  })
                )}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                      <TableHead>Quadrant</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          Loading real menu items…
                        </TableCell>
                      </TableRow>
                    ) : filteredItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
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
                            <TableCell className="font-medium">{item.name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-normal">
                                {item.category}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono">{formatItemPrice(item)}</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              {item.hasRecipe && item.cost != null ? `$${item.cost.toFixed(2)}` : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {margin != null ? (
                                <>
                                  <div className="font-mono">${margin.toFixed(2)}</div>
                                  <div className="text-xs text-muted-foreground">{marginPct!.toFixed(0)}%</div>
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
                  House-made components (sauces, dressings, batches) used across dishes — cost rolls up
                  automatically wherever they're used.
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
                      <span className="font-medium">{p.name}</span>
                      <div className="text-right">
                        <div className="font-mono text-sm">
                          {p.costPerYieldUnitCents != null ? formatMoney(p.costPerYieldUnitCents) : "—"}
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
                      <TableHead className="text-right">Yield</TableHead>
                      <TableHead className="text-right">Cost / yield unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isPrepLoading ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                          Loading…
                        </TableCell>
                      </TableRow>
                    ) : prepRecipes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                          No prep recipes yet — add one to reuse it across dishes.
                        </TableCell>
                      </TableRow>
                    ) : filteredPrepRecipes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
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
                          <TableCell className="text-right font-mono text-muted-foreground">
                            {p.yieldQty} {p.yieldUnit}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {p.costPerYieldUnitCents != null ? formatMoney(p.costPerYieldUnitCents) : "—"}
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
              initialDraftLines={pendingDrafts[selectedItem.id]}
            />
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={!!batchSummary} onOpenChange={(o) => !o && setBatchSummary(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">AI-generated recipes</DialogTitle>
            <DialogDescription>
              Click an item to review its proposed lines before adding anything.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">
            {(batchSummary ?? []).map((r) => {
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
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={!!selectedPrepId} onOpenChange={(o) => !o && setSelectedPrepId(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selectedPrepId && (
            <PrepRecipeSheet
              prepRecipeId={selectedPrepId}
              prepRecipe={prepRecipes.find((p) => p.id === selectedPrepId) ?? null}
              onDeleted={() => setSelectedPrepId(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <NewPrepRecipeDialog open={newPrepOpen} onOpenChange={setNewPrepOpen} />
    </>
  );
}

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
  const createPrepRecipe = useCreatePrepRecipe();

  const reset = () => {
    setName("");
    setYieldQty("1");
    setYieldUnit("each");
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
            <Input id="prep-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="House burger sauce" />
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
              <Input
                id="prep-yield-unit"
                value={yieldUnit}
                onChange={(e) => setYieldUnit(e.target.value)}
                placeholder="each, oz, qt…"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            e.g. a batch that makes 2 quarts of sauce: yield quantity 2, yield unit "qt".
          </p>
        </div>
        <DialogFooter>
          <Button
            disabled={!name.trim() || !yieldUnit.trim() || createPrepRecipe.isPending}
            onClick={() => {
              const qty = parseFloat(yieldQty);
              if (!Number.isFinite(qty) || qty <= 0) return;
              createPrepRecipe.mutate(
                { name: name.trim(), yieldQty: qty, yieldUnit: yieldUnit.trim() },
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

// ---------- Menu item recipe editor ----------

function MenuItemRecipeSheet({
  item,
  initialDraftLines,
}: {
  item: RealMenuItem;
  initialDraftLines?: DraftLine[];
}) {
  const { data: lines = [], isLoading } = useRecipeLinesForItem(item.id);
  const { data: ingredients = [] } = useIngredients();
  const { data: prepRecipes = [] } = usePrepRecipes();
  const addLine = useAddRecipeLine();
  const deleteLine = useDeleteRecipeLine();
  const generateRecipe = useGenerateRecipe();
  const [draftLines, setDraftLines] = useState<DraftLine[] | null>(initialDraftLines ?? null);

  const totalCents = useMemo(() => {
    if (lines.length === 0) return null;
    let sum = 0;
    for (const l of lines) {
      const lineCost = l.ingredientId != null ? l.ingredientCostCents : l.prepRecipeCostPerYieldUnitCents;
      if (lineCost == null) return null;
      sum += l.quantity * lineCost;
    }
    return Math.round(sum);
  }, [lines]);

  const margin = totalCents != null ? item.price * 100 - totalCents : null;
  const marginPct = margin != null && item.price > 0 ? (margin / (item.price * 100)) * 100 : null;
  const foodCostPct = totalCents != null && item.price > 0 ? (totalCents / (item.price * 100)) * 100 : null;

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-serif text-2xl">{item.name}</SheetTitle>
        <SheetDescription>{item.category}</SheetDescription>
      </SheetHeader>

      <div className="mt-4 rounded-xl border bg-muted/20 p-4 text-sm">
        {totalCents != null && marginPct != null && foodCostPct != null ? (
          <>
            Costs <span className="font-medium">{formatMoney(totalCents)}</span> · Sells{" "}
            <span className="font-medium">{formatItemPrice(item, { lowercase: true })}</span> ·{" "}
            Margin{" "}
            <span className="font-medium">{marginPct.toFixed(0)}%</span> (food cost{" "}
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

      {lines.length === 0 && draftLines == null && (
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
              {generateRecipe.error instanceof Error ? generateRecipe.error.message : "Generation failed"}
            </p>
          )}
        </div>
      )}

      {draftLines != null && (
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
            menuItemPosId={item.id}
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
  onDeleted,
}: {
  prepRecipeId: string;
  prepRecipe: PrepRecipe | null;
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
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const linesAsRecipeLines: RecipeLine[] = lines.map((l) => ({
    id: l.id,
    ingredientId: l.ingredientId,
    ingredientName: l.ingredientName,
    ingredientUnit: l.ingredientUnit,
    ingredientCostCents: l.ingredientCostCents,
    prepRecipeId: l.subPrepRecipeId,
    prepRecipeName: l.subPrepRecipeName,
    prepRecipeCostPerYieldUnitCents: l.subPrepRecipeCostPerYieldUnitCents,
    quantity: l.quantity,
    unit: l.unit,
  }));

  return (
    <>
      <SheetHeader>
        <SheetTitle className="font-serif text-2xl">{prepRecipe?.name ?? "Prep recipe"}</SheetTitle>
        <SheetDescription>
          Yields {prepRecipe?.yieldQty} {prepRecipe?.yieldUnit}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-4 rounded-xl border bg-muted/20 p-4 text-sm">
        {prepRecipe?.costPerYieldUnitCents != null ? (
          <>
            Costs <span className="font-medium">{formatMoney(prepRecipe.costPerYieldUnitCents)}</span> per{" "}
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

      <div className="mt-4">
        <RecipeLineList
          lines={linesAsRecipeLines}
          isLoading={isLoading}
          onDelete={(id) => deleteLine.mutate(id)}
          deletePending={deleteLine.isPending}
        />
      </div>

      <AddLineForm
        ingredients={ingredients}
        prepRecipes={availableSubRecipes}
        onAdd={(target, quantity, unit) =>
          addLine.mutate({
            prepRecipeId,
            quantity,
            unit,
            ...(target.kind === "ingredient" ? { ingredientId: target.id } : { subPrepRecipeId: target.id }),
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
                {unitCostCents != null && ` · ${formatMoney(l.quantity * unitCostCents)}`}
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
  ingredients: { id: string; name: string; unit: string }[];
  prepRecipes: PrepRecipe[];
  onAdd: (target: LineTarget, quantity: number, unit: string) => void;
  pending: boolean;
  error?: string | null;
}) {
  const [mode, setMode] = useState<"ingredient" | "prep">("ingredient");
  const [targetId, setTargetId] = useState("");
  const [quantity, setQuantity] = useState("");

  const selectedIngredient = ingredients.find((i) => i.id === targetId);
  const selectedPrep = prepRecipes.find((p) => p.id === targetId);
  const unit = mode === "ingredient" ? (selectedIngredient?.unit ?? "") : (selectedPrep?.yieldUnit ?? "");

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
        <Select value={targetId} onValueChange={setTargetId}>
          <SelectTrigger className="h-8 flex-1">
            <SelectValue placeholder={mode === "ingredient" ? "Add ingredient…" : "Add prep recipe…"} />
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
        <span className="w-12 text-xs text-muted-foreground">{unit}</span>
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

function GeneratedRecipeReview({
  menuItemPosId,
  lines,
  ingredients,
  prepRecipes,
  onLineResolved,
}: {
  menuItemPosId: string;
  lines: DraftLine[];
  ingredients: { id: string; name: string; unit: string }[];
  prepRecipes: PrepRecipe[];
  onLineResolved: (key: string) => void;
}) {
  const addLine = useAddRecipeLine();

  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">Claude didn't propose any lines for this item.</p>;
  }

  return (
    <div className="space-y-2">
      {lines.map((line) =>
        line.kind === "new_prep_recipe" ? (
          <NewPrepRecipeFlag key={line._key} line={line} onDismiss={() => onLineResolved(line._key)} />
        ) : (
          <GeneratedLineRow
            key={line._key}
            line={line}
            ingredients={ingredients}
            prepRecipes={prepRecipes}
            pending={addLine.isPending}
            onAdd={(target, quantity, unit) =>
              addLine.mutate(
                {
                  menuItemPosId,
                  quantity,
                  unit,
                  ...(target.kind === "ingredient"
                    ? { ingredientId: target.id }
                    : { prepRecipeId: target.id }),
                } as Parameters<typeof addLine.mutate>[0],
                { onSuccess: () => onLineResolved(line._key) },
              )
            }
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
  ingredients: { id: string; name: string; unit: string }[];
  prepRecipes: PrepRecipe[];
  onAdd: (target: LineTarget, quantity: number, unit: string) => void;
  onDismiss: () => void;
  pending: boolean;
}) {
  const [mode, setMode] = useState<"ingredient" | "prep">(line.kind === "prep_recipe" ? "prep" : "ingredient");
  const [targetId, setTargetId] = useState(
    line.kind === "ingredient" ? (line.ingredientId ?? "") : line.kind === "prep_recipe" ? (line.prepRecipeId ?? "") : "",
  );
  const [quantity, setQuantity] = useState(line.quantity != null ? String(line.quantity) : "");

  const selectedIngredient = ingredients.find((i) => i.id === targetId);
  const selectedPrep = prepRecipes.find((p) => p.id === targetId);
  // Unit is always re-derived from the selected row, never trusted from
  // Claude's own output — same discipline AddLineForm already applies
  // to manual entry.
  const unit = mode === "ingredient" ? (selectedIngredient?.unit ?? "") : (selectedPrep?.yieldUnit ?? "");
  const isMatched = (line.kind === "ingredient" || line.kind === "prep_recipe") && !!targetId;

  return (
    <div className="rounded-md border p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          {!isMatched && line.proposedName && (
            <span className="truncate text-muted-foreground">Proposed: {line.proposedName}</span>
          )}
          <Badge variant="outline" className={`shrink-0 text-[10px] font-normal ${CONFIDENCE_STYLE[line.confidence]}`}>
            {line.confidence} confidence
          </Badge>
        </div>
        <button className="shrink-0 text-xs text-muted-foreground hover:underline" onClick={onDismiss}>
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
        <Select value={targetId} onValueChange={setTargetId}>
          <SelectTrigger className="h-8 flex-1">
            <SelectValue placeholder={mode === "ingredient" ? "Pick ingredient…" : "Pick prep recipe…"} />
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
        <span className="w-12 text-xs text-muted-foreground">{unit}</span>
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

function NewPrepRecipeFlag({ line, onDismiss }: { line: GeneratedRecipeLine; onDismiss: () => void }) {
  return (
    <div className="space-y-1.5 rounded-md border border-dashed bg-muted/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">
          House-made — needs a prep recipe: {line.proposedName ?? "Untitled"}
        </span>
        <button className="shrink-0 text-xs text-muted-foreground hover:underline" onClick={onDismiss}>
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
