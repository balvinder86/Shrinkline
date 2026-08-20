import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, DollarSign, Trash2 } from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { useDateRange } from "@/lib/date-range-context";
import { formatDateRange } from "@/lib/date-range";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  useAddWasteEntry,
  useDeleteWasteEntry,
  useIngredients,
  useWasteLog,
} from "@/lib/boh/queries";
import { WASTE_REASONS, WASTE_REASON_LABEL, type WasteReason } from "@/lib/boh/waste-reasons";
import { compatibleLineUnits, unitLabel } from "@/lib/units";

export const Route = createFileRoute("/waste-log")({
  head: () => ({
    meta: [
      { title: "Waste Log · Shrinkline" },
      {
        name: "description",
        content:
          "Log ingredient waste — spoilage, breakage, spills, expired stock — and see its real dollar cost.",
      },
    ],
  }),
  component: WasteLogPage,
});

function formatMoney(n: number, opts: { compact?: boolean } = {}) {
  if (opts.compact && n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function KPI({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof DollarSign;
  tone?: "default" | "success" | "warning";
}) {
  const toneCls =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "bg-amber-50 text-amber-700"
        : "bg-primary/10 text-primary";
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className={`grid h-9 w-9 place-items-center rounded-xl ${toneCls}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 font-display text-3xl">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function WasteLogPage() {
  const { dateRange: globalDateRange } = useDateRange();
  const rangeLabel = useMemo(() => formatDateRange(globalDateRange), [globalDateRange]);

  const { data: ingredients = [] } = useIngredients();
  const { data: entries = [], isLoading } = useWasteLog(globalDateRange);
  const addEntry = useAddWasteEntry();
  const deleteEntry = useDeleteWasteEntry();

  const summary = useMemo(() => {
    const totalCostCents = entries.reduce((sum, e) => sum + (e.costCents ?? 0), 0);
    const uncostedCount = entries.filter((e) => e.costCents == null).length;
    const costByReason = new Map<WasteReason, number>();
    for (const e of entries) {
      costByReason.set(e.reason, (costByReason.get(e.reason) ?? 0) + (e.costCents ?? 0));
    }
    const topReason = Array.from(costByReason.entries()).sort((a, b) => b[1] - a[1])[0];
    return {
      totalCostCents,
      count: entries.length,
      uncostedCount,
      topReasonLabel: topReason && topReason[1] > 0 ? WASTE_REASON_LABEL[topReason[0]] : null,
    };
  }, [entries]);

  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lineUnit, setLineUnit] = useState("");
  const [reason, setReason] = useState<WasteReason>("spoilage");
  const [notes, setNotes] = useState("");
  const [loggedAt, setLoggedAt] = useState(todayIso());
  const [formError, setFormError] = useState<string | null>(null);

  const selectedIngredient = ingredients.find((i) => i.id === ingredientId);
  const compatibleUnits = selectedIngredient
    ? compatibleLineUnits(
        selectedIngredient.unit,
        selectedIngredient.containerSizeMl,
        selectedIngredient.containerSizeG,
      )
    : [];
  const unit = lineUnit || selectedIngredient?.unit || "";

  function resetForm() {
    setIngredientId("");
    setQuantity("");
    setLineUnit("");
    setReason("spoilage");
    setNotes("");
    setLoggedAt(todayIso());
    setFormError(null);
  }

  function handleLog() {
    const qty = parseFloat(quantity);
    if (!ingredientId || !Number.isFinite(qty) || qty <= 0 || !unit) {
      setFormError("Pick an ingredient and enter a quantity greater than zero.");
      return;
    }
    setFormError(null);
    addEntry.mutate(
      { ingredientId, quantity: qty, unit, reason, notes: notes.trim() || null, loggedAt },
      {
        onSuccess: resetForm,
        onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
      },
    );
  }

  return (
    <>
      <Topbar eyebrow="Stock & purchasing" title="Waste Log" />
      <main className="space-y-6 px-6 py-6">
        <div className="grid gap-4 md:grid-cols-3">
          <KPI
            label="Total waste cost"
            value={formatMoney(summary.totalCostCents / 100, { compact: true })}
            hint={
              summary.uncostedCount > 0
                ? `${rangeLabel} · ${summary.uncostedCount} entr${summary.uncostedCount === 1 ? "y" : "ies"} with no cost yet`
                : rangeLabel
            }
            icon={DollarSign}
            tone={summary.totalCostCents > 0 ? "warning" : "default"}
          />
          <KPI
            label="Entries logged"
            value={String(summary.count)}
            hint={rangeLabel}
            icon={ClipboardList}
          />
          <KPI
            label="Top reason"
            value={summary.topReasonLabel ?? "—"}
            hint={summary.count === 0 ? "no waste logged yet" : "by cost, this period"}
            icon={AlertTriangle}
          />
        </div>

        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Log waste
          </div>
          <h3 className="mt-1 font-display text-xl">Record a new entry</h3>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Ingredient</Label>
              <Select
                value={ingredientId}
                onValueChange={(id) => {
                  setIngredientId(id);
                  setLineUnit("");
                }}
              >
                <SelectTrigger className="h-9 w-56">
                  <SelectValue placeholder="Pick an ingredient…" />
                </SelectTrigger>
                <SelectContent>
                  {ingredients.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Quantity</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="qty"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="h-9 w-24"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Unit</Label>
              {selectedIngredient && compatibleUnits.length > 1 ? (
                <Select value={unit} onValueChange={setLineUnit}>
                  <SelectTrigger className="h-9 w-28">
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
                <span className="flex h-9 w-28 items-center text-sm text-muted-foreground">
                  {unit || "—"}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as WasteReason)}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WASTE_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input
                type="date"
                value={loggedAt}
                onChange={(e) => setLoggedAt(e.target.value)}
                className="h-9 w-36"
              />
            </div>
            <div className="flex min-w-40 flex-1 flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. dropped tray"
                className="h-9"
              />
            </div>
            <Button onClick={handleLog} disabled={addEntry.isPending}>
              {addEntry.isPending ? "Logging…" : "Log waste"}
            </Button>
          </div>
          {formError && <p className="mt-2 text-xs text-destructive">{formError}</p>}
          {selectedIngredient && selectedIngredient.unitCostCents == null && (
            <p className="mt-2 text-xs text-amber-700">
              This ingredient has no cost set yet — this entry will log with a quantity but no
              dollar cost until you add one on the Inventory page.
            </p>
          )}
        </Card>

        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Log</div>
          <h3 className="mt-1 font-display text-xl">Waste entries, {rangeLabel}</h3>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Date</TableHead>
                  <TableHead>Ingredient</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No waste logged in {rangeLabel}.
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(`${e.loggedAt}T00:00:00`).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </TableCell>
                      <TableCell className="font-medium">{e.ingredientName}</TableCell>
                      <TableCell className="text-sm">
                        {e.quantity} {unitLabel(e.unit)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{WASTE_REASON_LABEL[e.reason]}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {e.notes ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {e.costCents != null ? formatMoney(e.costCents / 100) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteEntry.mutate(e.id)}
                          disabled={deleteEntry.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </main>
    </>
  );
}
