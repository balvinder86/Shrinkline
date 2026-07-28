import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

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
  type RecipeLine,
  type PrepRecipe,
  type PrepRecipeLine,
} from "@/lib/boh/queries";
import { quadrant, QUAD_COLOR, formatItemPrice } from "@/lib/boh/menuEngineering";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

function RecipesPage() {
  const { item: deepLinkItemId } = Route.useSearch();
  const { dateRange } = useDateRange();
  const [activeTab, setActiveTab] = useState<"items" | "prep">("items");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedPrepId, setSelectedPrepId] = useState<string | null>(null);
  const [newPrepOpen, setNewPrepOpen] = useState(false);

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

          <TabsContent value="items" className="mt-4">
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Item</th>
                      <th className="px-3 py-2 text-left font-medium">Category</th>
                      <th className="px-3 py-2 text-right font-medium">Price</th>
                      <th className="px-3 py-2 text-right font-medium">Cost</th>
                      <th className="px-3 py-2 text-right font-medium">Margin</th>
                      <th className="px-3 py-2 text-left font-medium">Quadrant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          Loading real menu items…
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => {
                        const margin =
                          item.hasRecipe && item.cost != null && item.price > 0
                            ? item.price - item.cost
                            : null;
                        const marginPct = margin != null ? (margin / item.price) * 100 : null;
                        const q = quadrant(item, popMedian, marginMedian);
                        return (
                          <tr
                            key={item.id}
                            className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                            onClick={() => setSelectedItemId(item.id)}
                          >
                            <td className="px-3 py-3 font-medium">{item.name}</td>
                            <td className="px-3 py-3">
                              <Badge variant="outline" className="font-normal">
                                {item.category}
                              </Badge>
                            </td>
                            <td className="px-3 py-3 text-right font-mono">{formatItemPrice(item)}</td>
                            <td className="px-3 py-3 text-right font-mono text-muted-foreground">
                              {item.hasRecipe && item.cost != null ? `$${item.cost.toFixed(2)}` : "—"}
                            </td>
                            <td className="px-3 py-3 text-right">
                              {margin != null ? (
                                <>
                                  <div className="font-mono">${margin.toFixed(2)}</div>
                                  <div className="text-xs text-muted-foreground">{marginPct!.toFixed(0)}%</div>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">Add recipe</span>
                              )}
                            </td>
                            <td className="px-3 py-3">
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
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="prep" className="mt-4">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b p-3">
                <div className="text-sm text-muted-foreground">
                  House-made components (sauces, dressings, batches) used across dishes — cost rolls up
                  automatically wherever they're used.
                </div>
                <Button size="sm" className="gap-2" onClick={() => setNewPrepOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> New prep recipe
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-right font-medium">Yield</th>
                      <th className="px-3 py-2 text-right font-medium">Cost / yield unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isPrepLoading ? (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                          Loading…
                        </td>
                      </tr>
                    ) : prepRecipes.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
                          No prep recipes yet — add one to reuse it across dishes.
                        </td>
                      </tr>
                    ) : (
                      prepRecipes.map((p) => (
                        <tr
                          key={p.id}
                          className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                          onClick={() => setSelectedPrepId(p.id)}
                        >
                          <td className="px-3 py-3 font-medium">{p.name}</td>
                          <td className="px-3 py-3 text-right font-mono text-muted-foreground">
                            {p.yieldQty} {p.yieldUnit}
                          </td>
                          <td className="px-3 py-3 text-right font-mono">
                            {p.costPerYieldUnitCents != null ? formatMoney(p.costPerYieldUnitCents) : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Sheet open={!!selectedItemId} onOpenChange={(o) => !o && setSelectedItemId(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          {selectedItem && <MenuItemRecipeSheet item={selectedItem} />}
        </SheetContent>
      </Sheet>

      <Sheet open={!!selectedPrepId} onOpenChange={(o) => !o && setSelectedPrepId(null)}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
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

function MenuItemRecipeSheet({ item }: { item: RealMenuItem }) {
  const { data: lines = [], isLoading } = useRecipeLinesForItem(item.id);
  const { data: ingredients = [] } = useIngredients();
  const { data: prepRecipes = [] } = usePrepRecipes();
  const addLine = useAddRecipeLine();
  const deleteLine = useDeleteRecipeLine();

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
