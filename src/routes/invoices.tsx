import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileSearch,
  FileText,
  Inbox,
  Loader2,
  Mail,
  PiggyBank,
  Receipt,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Truck,
  Upload,
  Wallet,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Topbar } from "@/components/dashboard/Topbar";
import { useDateRange } from "@/lib/date-range-context";
import { isoDate, formatDateRange } from "@/lib/date-range";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  type DateRange,
  useApproveInvoice,
  useCheckOcr,
  useDeleteInvoice,
  useDeleteInvoices,
  useEmailIngestionActivity,
  useEmailIngestionStatus,
  useEnqueueOcr,
  useIngredients,
  useCategorySpend,
  dateInRange,
  usePromoteSenderAndAssignVendor,
  useRealInvoiceLines,
  useRealInvoices,
  useSavingsSummary,
  useSetInvoiceDiscount,
  useSetInvoiceVendor,
  useTopLineItems,
  useUpdateInvoiceLineIngredient,
  useUploadInvoice,
  useVendors as useRealVendors,
  useVendorSpendSummary,
  type RealInvoice,
} from "@/lib/boh/queries";
import { attachmentGateError } from "@/lib/boh/attachmentGate";

export const Route = createFileRoute("/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices · Thrasher's Pub" },
      {
        name: "description",
        content:
          "Consolidated vendor invoices, line-item spend, savings captured, and payment status across all suppliers.",
      },
    ],
  }),
  component: InvoicesPage,
});

function formatMoney(n: number, opts: { compact?: boolean } = {}) {
  if (opts.compact && n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// Generic index-cycling palette — used where the slices don't have an
// inherent real-world identity to color by (e.g. by vendor). First
// entry is bare var(--primary), not wrapped in hsl(...) — the app's
// CSS vars are OKLCH already, and wrapping one in hsl() silently fails
// (renders solid black, no error) rather than throwing — see
// feedback_thrasherspub_oklch_charts memory.
const CATEGORY_COLORS = [
  "var(--primary)",
  "hsl(15 65% 52%)",
  "hsl(120 25% 45%)",
  "hsl(38 60% 55%)",
  "hsl(25 40% 40%)",
  "hsl(220 15% 55%)",
  "hsl(280 40% 55%)",
  "hsl(190 55% 45%)",
];

// Real ingredient categories (confirmed live: Alcohol, Beverages, Dry
// Goods, Food, Miscellaneous, Seafood) get a fixed, semantically
// chosen color each — deterministic by name, not by array position, so
// "Alcohol" is always the same color regardless of what other
// categories exist that period, and two categories never coincidentally
// land on near-identical hues the way index-cycling risked (Alcohol and
// Seafood previously both landed on similar warm orange-reds). Any
// category not in this map (a new one added later) falls back to
// CATEGORY_COLORS, cycled only among the unmapped ones so it doesn't
// collide with a named color either.
const CATEGORY_COLOR_MAP: Record<string, string> = {
  alcohol: "hsl(35 65% 48%)",
  beverages: "hsl(190 55% 45%)",
  "dry goods": "hsl(28 35% 42%)",
  food: "hsl(120 30% 42%)",
  miscellaneous: "hsl(220 12% 55%)",
  seafood: "hsl(205 60% 48%)",
};

function KPI({
  label,
  value,
  delta,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  delta?: { value: string; positive?: boolean };
  hint?: string;
  icon: typeof Wallet;
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
      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        {delta && (
          <span
            className={`inline-flex items-center gap-0.5 font-medium ${
              delta.positive ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {delta.positive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {delta.value}
          </span>
        )}
        {hint && <span>{hint}</span>}
      </div>
    </Card>
  );
}

const INVOICES_PAGE_SIZE = 25;

function InvoicesPage() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending_review" | "approved">("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [ocrSheetInvoiceId, setOcrSheetInvoiceId] = useState<string | null | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [invoiceToDelete, setInvoiceToDelete] = useState<RealInvoice | null>(null);
  const deleteInvoice = useDeleteInvoice();
  const confirmDeleteInvoice = () => {
    if (!invoiceToDelete) return;
    deleteInvoice.mutate({ id: invoiceToDelete.id, sourceFileUrl: invoiceToDelete.sourceFileUrl });
    setInvoiceToDelete(null);
  };

  // Same global range as every other page (Home, Product Mix, etc.) —
  // set once in the Topbar, applies everywhere. Converted to the
  // "YYYY-MM-DD" string form the invoice queries/dateInRange expect.
  const { dateRange: globalDateRange } = useDateRange();
  const dateRange = useMemo(
    () => ({ from: isoDate(globalDateRange.from), to: isoDate(globalDateRange.to) }),
    [globalDateRange],
  );
  const rangeLabel = useMemo(() => formatDateRange(globalDateRange), [globalDateRange]);

  // Any change to what's being filtered should land back on page 1 —
  // otherwise a narrower filter can strand you on a now-empty page.
  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, vendorFilter, dateRange.from, dateRange.to]);

  const { data: realInvoices = [] } = useRealInvoices();
  const { data: realVendors = [] } = useRealVendors();
  const { data: vendorSpend = [] } = useVendorSpendSummary(dateRange);
  const { data: topLineItems = [] } = useTopLineItems(dateRange);
  const { data: categorySpend = [] } = useCategorySpend(dateRange);
  const { data: savingsSummary } = useSavingsSummary(dateRange);

  // Every invoice-derived calc on this page (KPIs, charts, the
  // "All invoices" table) filters from this one place, so the global
  // date range in the Topbar affects everything on this page
  // consistently.
  const dateFilteredInvoices = useMemo(
    () => realInvoices.filter((i) => dateInRange(i.invoiceDate ?? i.createdAt, dateRange)),
    [realInvoices, dateRange],
  );

  const realKpis = useMemo(() => {
    const approved = dateFilteredInvoices.filter((i) => i.status === "approved");
    const pending = dateFilteredInvoices.filter((i) => i.status === "pending_review");
    return {
      approvedSpendCents: approved.reduce((a, b) => a + (b.totalCents ?? 0), 0),
      approvedCount: approved.length,
      pendingCents: pending.reduce((a, b) => a + (b.totalCents ?? 0), 0),
      pendingCount: pending.length,
      thisMonthCount: dateFilteredInvoices.length,
    };
  }, [dateFilteredInvoices]);

  // Real approved spend by vendor, biggest first — savings is
  // deliberately left out of this chart, since it already has its own
  // KPI card above and its own tab.
  const VENDOR_MIX_TOP_N = 8;
  const vendorSpendMix = useMemo(() => {
    const withSpend = vendorSpend
      .filter((v) => v.approvedSpendCents > 0)
      .sort((a, b) => b.approvedSpendCents - a.approvedSpendCents);
    const total = withSpend.reduce((a, v) => a + v.approvedSpendCents, 0);
    if (total === 0) return [] as { name: string; value: number; color: string; pct: number }[];

    const top = withSpend.slice(0, VENDOR_MIX_TOP_N);
    const rest = withSpend.slice(VENDOR_MIX_TOP_N);
    const restCents = rest.reduce((a, v) => a + v.approvedSpendCents, 0);
    const slices = [
      ...top.map((v) => ({ name: v.name, cents: v.approvedSpendCents })),
      ...(restCents > 0 ? [{ name: "Other vendors", cents: restCents }] : []),
    ];
    return slices.map((s, i) => ({
      name: s.name,
      value: s.cents / 100,
      pct: Math.round((s.cents / total) * 100),
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    }));
  }, [vendorSpend]);

  const categoryMix = useMemo(() => {
    const total = categorySpend.reduce((a, b) => a + b.spendCents, 0);
    if (total === 0) return [] as { name: string; value: number; color: string; pct: number }[];
    let fallbackIndex = 0;
    return categorySpend.map((c) => {
      const mapped = CATEGORY_COLOR_MAP[c.category.trim().toLowerCase()];
      const color = mapped ?? CATEGORY_COLORS[fallbackIndex++ % CATEGORY_COLORS.length];
      return {
        name: c.category,
        value: c.spendCents / 100,
        pct: Math.round((c.spendCents / total) * 100),
        color,
      };
    });
  }, [categorySpend]);

  const filteredInvoices = useMemo(() => {
    return dateFilteredInvoices.filter((inv) => {
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (vendorFilter !== "all" && inv.vendorName !== vendorFilter) return false;
      if (query) {
        const haystack = `${inv.invoiceNumber ?? ""} ${inv.vendorName ?? ""}`.toLowerCase();
        if (!haystack.includes(query.toLowerCase())) return false;
      }
      return true;
    });
  }, [dateFilteredInvoices, query, statusFilter, vendorFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / INVOICES_PAGE_SIZE));
  const pagedInvoices = useMemo(
    () => filteredInvoices.slice((page - 1) * INVOICES_PAGE_SIZE, page * INVOICES_PAGE_SIZE),
    [filteredInvoices, page],
  );

  // Selection persists across page turns (same "build it up across
  // several views, act once" shape as Inventory's bulk vendor assign)
  // — "select all" toggles only the current page, since deleting is
  // destructive enough that silently selecting every filtered invoice
  // across every page from one click would be too easy to fire by
  // accident.
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const toggleInvoiceSelected = (id: string, checked: boolean) => {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const allPagedSelected =
    pagedInvoices.length > 0 && pagedInvoices.every((inv) => selectedInvoiceIds.has(inv.id));
  const toggleSelectAllPaged = (checked: boolean) => {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev);
      for (const inv of pagedInvoices) {
        if (checked) next.add(inv.id);
        else next.delete(inv.id);
      }
      return next;
    });
  };
  const deleteInvoices = useDeleteInvoices();
  const selectedInvoices = filteredInvoices.filter((inv) => selectedInvoiceIds.has(inv.id));
  const confirmBulkDelete = () => {
    deleteInvoices.mutate(
      selectedInvoices.map((inv) => ({ id: inv.id, sourceFileUrl: inv.sourceFileUrl })),
      { onSuccess: () => setSelectedInvoiceIds(new Set()) },
    );
    setBulkDeleteOpen(false);
  };

  return (
    <>
      <Topbar eyebrow="Accounts payable" title="Invoices" />
      <main className="space-y-6 px-6 py-6">
        {/* KPI row */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <KPI
            label="Total spend · approved"
            value={formatMoney(realKpis.approvedSpendCents / 100, { compact: true })}
            hint={`${realKpis.approvedCount} approved invoice${realKpis.approvedCount === 1 ? "" : "s"}`}
            icon={Wallet}
          />
          <KPI
            label="Savings captured"
            value={
              (savingsSummary?.totalDiscountCents ?? 0) >= 100000
                ? formatMoney((savingsSummary?.totalDiscountCents ?? 0) / 100, { compact: true })
                : `$${((savingsSummary?.totalDiscountCents ?? 0) / 100).toFixed(2)}`
            }
            hint={
              savingsSummary && savingsSummary.invoicesWithDiscountCount > 0
                ? `${savingsSummary.invoicesWithDiscountCount} invoice${savingsSummary.invoicesWithDiscountCount === 1 ? "" : "s"} with a discount`
                : "none logged yet"
            }
            icon={PiggyBank}
            tone="success"
          />
          <KPI
            label="Pending review"
            value={formatMoney(realKpis.pendingCents / 100, { compact: true })}
            hint={`${realKpis.pendingCount} invoice${realKpis.pendingCount === 1 ? "" : "s"}`}
            icon={FileText}
            tone={realKpis.pendingCount > 0 ? "warning" : "default"}
          />
          <KPI
            label="Active vendors"
            value={String(realVendors.length)}
            hint="in your vendor list"
            icon={Truck}
          />
          <KPI
            label="Invoices in period"
            value={String(realKpis.thisMonthCount)}
            hint={rangeLabel}
            icon={Inbox}
          />
        </div>

        {/* Charts row */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              By vendor
            </div>
            <h3 className="mt-1 font-display text-xl">Where spend goes</h3>
            {vendorSpendMix.length === 0 ? (
              <div className="mt-4 flex h-[260px] items-center justify-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
                {realInvoices.length === 0
                  ? "No approved invoices yet — approve invoices to see spend by vendor appear here."
                  : `No approved invoices in ${rangeLabel} — try a different period.`}
              </div>
            ) : (
              <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row">
                <div className="h-[260px] w-full max-w-[260px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={vendorSpendMix}
                        dataKey="value"
                        innerRadius={70}
                        outerRadius={110}
                        paddingAngle={2}
                        isAnimationActive={false}
                      >
                        {vendorSpendMix.map((v) => (
                          <Cell key={v.name} fill={v.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatMoney(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full space-y-2">
                  {vendorSpendMix.map((v) => (
                    <div key={v.name} className="flex items-center justify-between text-sm">
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: v.color }}
                        />
                        <span className="truncate">{v.name}</span>
                      </span>
                      <span className="ml-3 shrink-0 font-medium text-foreground">
                        {formatMoney(v.value)}{" "}
                        <span className="text-muted-foreground">({v.pct}%)</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Category mix
            </div>
            <h3 className="mt-1 font-display text-xl">Where your dollars go</h3>
            {categoryMix.length === 0 ? (
              <div className="mt-4 flex h-[200px] items-center justify-center rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                Category mix appears once invoice line items are matched to ingredients with a
                category.
              </div>
            ) : (
              <>
                <div className="mt-2 h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryMix}
                        dataKey="value"
                        innerRadius={56}
                        outerRadius={84}
                        paddingAngle={2}
                        isAnimationActive={false}
                      >
                        {categoryMix.map((c) => (
                          <Cell key={c.name} fill={c.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatMoney(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-2">
                  {categoryMix.map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-sm">
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: c.color }}
                        />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="ml-3 shrink-0 font-medium text-foreground">
                        {formatMoney(c.value)}{" "}
                        <span className="text-muted-foreground">({c.pct}%)</span>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="invoices" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="bg-card">
              <TabsTrigger value="invoices" className="gap-1.5">
                <Inbox className="h-3.5 w-3.5" /> All invoices
              </TabsTrigger>
              <TabsTrigger value="vendors" className="gap-1.5">
                <Truck className="h-3.5 w-3.5" /> Vendors
              </TabsTrigger>
              <TabsTrigger value="items" className="gap-1.5">
                <Receipt className="h-3.5 w-3.5" /> Line items
              </TabsTrigger>
              <TabsTrigger value="savings" className="gap-1.5">
                <PiggyBank className="h-3.5 w-3.5" /> Savings
              </TabsTrigger>
              <TabsTrigger value="automation" className="gap-1.5">
                <Bot className="h-3.5 w-3.5" /> Automation
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => setOcrSheetInvoiceId(null)}
              >
                <Upload className="h-3.5 w-3.5" /> Upload invoice
              </Button>
            </div>
          </div>

          {/* Invoices tab */}
          <TabsContent value="invoices" className="space-y-4">
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search invoice # or vendor"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="h-9 pl-9"
                  />
                </div>
                <div className="flex items-center gap-1">
                  {(["all", "pending_review", "approved"] as const).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={statusFilter === s ? "default" : "ghost"}
                      onClick={() => setStatusFilter(s)}
                      className="h-8 px-3 text-xs capitalize"
                    >
                      {s === "pending_review" ? "Pending review" : s}
                    </Button>
                  ))}
                </div>
                <select
                  value={vendorFilter}
                  onChange={(e) => setVendorFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All vendors</option>
                  {realVendors.map((v) => (
                    <option key={v.id} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </Card>

            {selectedInvoiceIds.size > 0 && (
              <Card className="border-primary/30 bg-primary/[0.04] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {selectedInvoiceIds.size} invoice{selectedInvoiceIds.size === 1 ? "" : "s"}{" "}
                    selected
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1.5"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete selected
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedInvoiceIds(new Set())}
                  >
                    Clear selection
                  </Button>
                </div>
              </Card>
            )}

            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-[44px]">
                      <Checkbox
                        checked={allPagedSelected}
                        onCheckedChange={(checked) => toggleSelectAllPaged(checked === true)}
                        aria-label="Select all invoices on this page"
                      />
                    </TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Savings</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedInvoices.map((inv) => (
                    <TableRow
                      key={inv.id}
                      className="cursor-pointer"
                      onClick={() => setOcrSheetInvoiceId(inv.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedInvoiceIds.has(inv.id)}
                          onCheckedChange={(checked) =>
                            toggleInvoiceSelected(inv.id, checked === true)
                          }
                          aria-label={`Select invoice${inv.vendorName ? ` from ${inv.vendorName}` : ""}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {inv.vendorName ?? (
                          <Badge
                            variant="outline"
                            className="border-amber-200 bg-amber-50 text-amber-800"
                          >
                            Needs vendor
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{inv.invoiceNumber ?? "—"}</TableCell>
                      <TableCell className="text-sm">{inv.invoiceDate ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {inv.totalCents != null ? formatMoney(inv.totalCents / 100) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {inv.discountCents ? (
                          <span className="text-emerald-700">
                            {formatMoney(inv.discountCents / 100)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {ocrStatusBadge(inv.ocrStatus, inv.status)}
                        {flagBadges(inv.flags, inv.documentType)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-8">
                            Review
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setInvoiceToDelete(inv);
                            }}
                            aria-label={`Delete invoice${inv.vendorName ? ` from ${inv.vendorName}` : ""}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredInvoices.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        {realInvoices.length === 0
                          ? "No invoices yet — upload one or connect email ingestion to get started."
                          : `No invoices in ${rangeLabel} — try a different period.`}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  {filteredInvoices.length === 0
                    ? "0 invoices"
                    : `Showing ${(page - 1) * INVOICES_PAGE_SIZE + 1}–${Math.min(page * INVOICES_PAGE_SIZE, filteredInvoices.length)} of ${filteredInvoices.length} invoice${filteredInvoices.length === 1 ? "" : "s"}`}
                </span>

                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}

                <span>
                  Total:{" "}
                  <span className="font-medium text-foreground">
                    {formatMoney(
                      filteredInvoices.reduce((a, b) => a + (b.totalCents ?? 0), 0) / 100,
                    )}
                  </span>
                </span>
              </div>
            </Card>
          </TabsContent>

          {/* Vendors tab */}
          <TabsContent value="vendors" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {vendorSpend.map((v) => (
                <Card key={v.vendorId} className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <div className="font-display text-lg">{v.name}</div>
                      {v.contactName && (
                        <div className="truncate text-xs text-muted-foreground">
                          {v.contactName}
                        </div>
                      )}
                    </div>
                    {v.terms && (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {v.terms}
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Approved spend
                      </div>
                      <div className="font-display text-lg">
                        {formatMoney(v.approvedSpendCents / 100, { compact: true })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Invoices
                      </div>
                      <div className="font-display text-lg">{v.approvedInvoiceCount}</div>
                      {v.pendingInvoiceCount > 0 && (
                        <div className="text-xs text-amber-700">
                          {v.pendingInvoiceCount} pending review
                        </div>
                      )}
                    </div>
                  </div>

                  {(v.email || v.phone) && (
                    <>
                      <Separator className="my-4" />
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {v.email && <div>{v.email}</div>}
                        {v.phone && <div>{v.phone}</div>}
                      </div>
                    </>
                  )}
                </Card>
              ))}
              {vendorSpend.length === 0 && (
                <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
                  No vendors yet — add one in Inventory &amp; Ordering.
                </p>
              )}
            </div>
          </TabsContent>

          {/* Line items tab — real spend/price-trend from invoice_lines
              on approved invoices. No time window applied (see
              useTopLineItems) since real invoice volume is still too
              low for "last 30 days"/"MTD" to be meaningful rather than
              just hiding real spend. "Savings" per item is dropped —
              discounts are only tracked at the invoice level. */}
          <TabsContent value="items" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-5 lg:col-span-2">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Top line items
                  </div>
                  <h3 className="mt-1 font-display text-xl">Where you're spending the most</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    All approved invoices — matched line items only
                  </p>
                </div>
                <Table className="mt-3">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">Δ price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topLineItems.map((i) => (
                      <TableRow key={i.ingredientId}>
                        <TableCell className="font-medium">{i.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {i.vendorLabel}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(i.spendCents / 100)}
                        </TableCell>
                        <TableCell className="text-right">
                          {i.priceChangePct == null ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                                i.priceChangePct > 0
                                  ? "text-rose-600"
                                  : i.priceChangePct < 0
                                    ? "text-emerald-600"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {i.priceChangePct > 0 ? (
                                <ArrowUpRight className="h-3 w-3" />
                              ) : i.priceChangePct < 0 ? (
                                <ArrowDownRight className="h-3 w-3" />
                              ) : null}
                              {i.priceChangePct === 0 ? "—" : `${Math.abs(i.priceChangePct)}%`}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {topLineItems.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="py-10 text-center text-sm text-muted-foreground"
                        >
                          No matched line items on approved invoices yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Card>

              <Card className="p-5">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Category spend
                </div>
                <h3 className="mt-1 font-display text-xl">By category</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">All approved invoices</p>
                {categorySpend.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No matched line items yet.
                  </p>
                ) : (
                  <div className="mt-3 h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={categorySpend.map((c) => ({
                          name: c.category,
                          value: c.spendCents / 100,
                        }))}
                        layout="vertical"
                        margin={{ left: 10, right: 10 }}
                      >
                        <CartesianGrid
                          stroke="var(--border)"
                          strokeDasharray="3 3"
                          horizontal={false}
                        />
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="name"
                          stroke="var(--muted-foreground)"
                          fontSize={11}
                          width={100}
                        />
                        <Tooltip formatter={(v: number) => formatMoney(v)} />
                        <Bar dataKey="value" radius={[0, 6, 6, 0]} fill="var(--primary)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
            </div>
          </TabsContent>

          {/* Savings tab — real discounts entered during invoice review,
              never projected/AI-estimated */}
          <TabsContent value="savings" className="space-y-4">
            <SavingsTab dateRange={dateRange} />
          </TabsContent>

          {/* Automation tab */}
          <TabsContent value="automation" className="space-y-4">
            <AutomationTab />
          </TabsContent>
        </Tabs>
      </main>

      <InvoiceOcrSheet
        invoiceId={ocrSheetInvoiceId}
        onClose={() => setOcrSheetInvoiceId(undefined)}
      />

      <AlertDialog open={!!invoiceToDelete} onOpenChange={(o) => !o && setInvoiceToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete invoice
              {invoiceToDelete?.vendorName ? ` from ${invoiceToDelete.vendorName}` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Removes the invoice and its line items
              {invoiceToDelete?.sourceFileUrl ? " and uploaded file" : ""}.
              {invoiceToDelete?.status === "approved" &&
                " This invoice was approved — deleting it will also remove its spend from every KPI, savings, and vendor total on this page."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteInvoice}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedInvoices.length} invoice{selectedInvoices.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Removes each invoice, its line items, and any uploaded file.
              {selectedInvoices.some((inv) => inv.status === "approved") &&
                " Some of these were approved — deleting them will also remove their spend from every KPI, savings, and vendor total on this page."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete {selectedInvoices.length} invoice{selectedInvoices.length === 1 ? "" : "s"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// =====================================================
// Real invoice OCR — upload + review, wired to the actual
// vendors/invoices/invoice_lines tables and the invoice-ocr
// Edge Function → Railway service. KPIs, the "All invoices" list,
// vendor cards, and the Automation tab are now also wired to real
// data (see InvoicesPage / AutomationTab below) — the Weekly trend
// chart, Category mix, and AI flags card above the tabs are still
// Lovable-generated placeholder, out of scope for now.
// =====================================================

function ocrStatusBadge(ocrStatus: string | null, status: "pending_review" | "approved") {
  if (status === "approved")
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        Approved
      </Badge>
    );
  if (ocrStatus === "ready")
    return (
      <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
        Ready for review
      </Badge>
    );
  if (ocrStatus === "failed")
    return (
      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
        Extraction failed
      </Badge>
    );
  return (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
      <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Processing
    </Badge>
  );
}

const FLAG_LABELS: Record<string, string> = {
  unknown_sender: "Unknown sender",
  sender_auth_failed: "Sender auth failed",
  not_an_invoice: "Not an invoice",
  totals_mismatch: "Totals don't match",
  low_confidence: "Low confidence",
  duplicate: "Possible duplicate",
};

const SKIP_REASON_LABELS: Record<string, string> = {
  wrong_type: "Unsupported file type",
  too_large: "File too large (>25MB)",
  too_small: "File too small — likely a logo/signature",
  no_attachment: "No attachment on this email",
  processing_error: "Upload/processing error — see logs",
};

// Sibling to ocrStatusBadge, not folded into it — that function is
// single-purpose (OCR pipeline state: processing/ready/failed/
// approved). Flags and document_type are a separate, cross-cutting
// concern that can be true on top of any of those states.
function flagBadges(flags: string[], documentType: string | null) {
  const badges: ReactNode[] = [];
  if (documentType === "credit_memo" || documentType === "statement") {
    badges.push(
      <Badge
        key="doc-type"
        variant="outline"
        className="border-purple-200 bg-purple-50 text-purple-700"
      >
        {documentType === "credit_memo" ? "Credit memo" : "Statement"}
      </Badge>,
    );
  }
  for (const flag of flags) {
    const label = FLAG_LABELS[flag];
    if (!label) continue;
    const severe = flag === "duplicate" || flag === "not_an_invoice";
    badges.push(
      <Badge
        key={flag}
        variant="outline"
        className={
          severe
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }
      >
        {label}
      </Badge>,
    );
  }
  if (badges.length === 0) return null;
  return <div className="mt-1 flex flex-wrap gap-1">{badges}</div>;
}

function RealInvoiceUploadsCard({ onOpenInvoice }: { onOpenInvoice: (id: string) => void }) {
  const { data: invoices = [], isLoading } = useRealInvoices();

  if (!isLoading && invoices.length === 0) return null;

  return (
    <Card className="overflow-hidden border-primary/30">
      <div className="flex items-center gap-2 border-b bg-primary/[0.04] px-4 py-3">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 text-primary">
          <FileSearch className="h-4 w-4" />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-primary/80">OCR uploads</div>
          <div className="text-sm font-medium">Invoices uploaded and extracted for review</div>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead>Vendor</TableHead>
            <TableHead>Invoice #</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((inv) => (
            <TableRow key={inv.id} className="cursor-pointer" onClick={() => onOpenInvoice(inv.id)}>
              <TableCell className="font-medium">
                {inv.vendorName ?? (
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                    Needs vendor
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-sm">{inv.invoiceNumber ?? "—"}</TableCell>
              <TableCell className="text-sm">{inv.invoiceDate ?? "—"}</TableCell>
              <TableCell className="text-right font-medium">
                {inv.totalCents != null ? formatMoney(inv.totalCents / 100) : "—"}
              </TableCell>
              <TableCell>
                {ocrStatusBadge(inv.ocrStatus, inv.status)}
                {flagBadges(inv.flags, inv.documentType)}
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="ghost" className="h-8">
                  Review
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// `invoiceId === undefined` → sheet closed. `null` → upload a new
// invoice. A real id → review that invoice's extraction.
function InvoiceOcrSheet({
  invoiceId,
  onClose,
}: {
  invoiceId: string | null | undefined;
  onClose: () => void;
}) {
  const [vendorId, setVendorId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const { data: vendors = [] } = useRealVendors();
  const { data: ingredients = [] } = useIngredients();
  const { data: invoices = [] } = useRealInvoices();
  const activeId = uploadedId ?? (typeof invoiceId === "string" ? invoiceId : null);
  const invoice = invoices.find((i) => i.id === activeId);
  const { data: lines = [] } = useRealInvoiceLines(activeId ?? undefined);
  const isExtracting = !invoice || invoice.ocrStatus === "processing" || invoice.ocrStatus == null;

  const uploadInvoice = useUploadInvoice();
  const enqueueOcr = useEnqueueOcr();
  const checkOcr = useCheckOcr();
  const approveInvoice = useApproveInvoice();
  const updateLineIngredient = useUpdateInvoiceLineIngredient();
  const setInvoiceVendor = useSetInvoiceVendor();
  const setInvoiceDiscount = useSetInvoiceDiscount();
  const [discountInput, setDiscountInput] = useState("");

  const open = invoiceId !== undefined;

  // Sync the discount field from the real value whenever a different
  // invoice loads — not on every render, so typing isn't clobbered by
  // the query re-fetching in the background.
  useEffect(() => {
    setDiscountInput(
      invoice?.discountCents != null ? (invoice.discountCents / 100).toFixed(2) : "",
    );
  }, [invoice?.id, invoice?.discountCents]);

  function commitDiscount() {
    if (!activeId) return;
    const trimmed = discountInput.trim();
    const cents = trimmed === "" ? null : Math.round(parseFloat(trimmed) * 100);
    if (trimmed !== "" && (cents === null || Number.isNaN(cents))) return;
    if (cents === invoice?.discountCents) return;
    setInvoiceDiscount.mutate({ invoiceId: activeId, discountCents: cents });
  }

  useEffect(() => {
    if (open) {
      setVendorId("");
      setFile(null);
      setUploadedId(null);
      setStarting(false);
      setStartError(null);
    }
  }, [open, invoiceId]);

  // Poll for a result only while the invoice is genuinely still
  // processing — re-checking an already-ready/failed job would just
  // re-insert its line items every time (the Railway service doesn't
  // dedupe on check).
  useEffect(() => {
    if (!activeId || invoice?.ocrStatus !== "processing") return;
    const t = setTimeout(() => {
      checkOcr.mutate(activeId);
    }, 3000);
    return () => clearTimeout(t);
    // checkOcr's identity changes every render; only isPending should re-arm the poll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, invoice?.ocrStatus, checkOcr.isPending]);

  async function handleStart() {
    if (!file) return;
    const gateError = attachmentGateError(file);
    if (gateError) {
      setStartError(gateError);
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const id = await uploadInvoice.mutateAsync({ vendorId: vendorId || null, file });
      await enqueueOcr.mutateAsync(id);
      setUploadedId(id);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">
            {activeId ? "Invoice review" : "Upload invoice"}
          </SheetTitle>
          <SheetDescription>
            {activeId
              ? "Extracted with Mindee OCR — confirm the ingredient match on each line before approving."
              : "Upload a photo or PDF of a vendor invoice — from your phone or computer. Pick the vendor if you know it, or leave it blank and we'll try to match it from the invoice itself."}
          </SheetDescription>
        </SheetHeader>

        {!activeId && (
          <div className="mt-5 space-y-4">
            <div>
              <Label>Vendor</Label>
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="mt-1.5 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select a vendor (optional — we'll try to detect it)…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              {vendors.length === 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  No vendors yet — add one in the Vendors tab of Inventory first.
                </p>
              )}
            </div>
            <div>
              <Label>Invoice file</Label>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/jpg,image/png"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setStartError(null);
                }}
                className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                PDF, JPG, or PNG — on your phone this offers the camera directly. Max 25MB.
              </p>
            </div>
            {startError && <p className="text-sm text-rose-600">{startError}</p>}
            <Button onClick={handleStart} disabled={!file || starting} className="gap-1.5">
              {starting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {starting ? "Uploading…" : "Upload & extract"}
            </Button>
          </div>
        )}

        {activeId && isExtracting && (
          <div className="mt-8 flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div className="text-sm font-medium">Extracting with Mindee…</div>
            <div className="text-xs text-muted-foreground">This usually takes 10–20 seconds.</div>
          </div>
        )}

        {activeId && invoice?.ocrStatus === "failed" && (
          <div className="mt-8 flex flex-col items-center gap-3 py-12 text-center">
            <XCircle className="h-6 w-6 text-rose-600" />
            <div className="text-sm font-medium">Extraction failed</div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => enqueueOcr.mutate(activeId)}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        )}

        {activeId && invoice?.ocrStatus === "ready" && !invoice.vendorId && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-amber-800">
              No vendor matched yet — pick one
            </div>
            {(invoice.sourceEmailFrom || invoice.sourceEmailSubject) && (
              <div className="mt-1.5 text-xs text-amber-900">
                {invoice.sourceEmailFrom && <div>From: {invoice.sourceEmailFrom}</div>}
                {invoice.sourceEmailSubject && <div>Subject: {invoice.sourceEmailSubject}</div>}
              </div>
            )}
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  setInvoiceVendor.mutate({ invoiceId: activeId, vendorId: e.target.value });
                }
              }}
              className="mt-2.5 h-9 w-full rounded-md border border-amber-300 bg-white px-3 text-sm"
            >
              <option value="">Select a vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {activeId && invoice?.ocrStatus === "ready" && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Total
                </div>
                <div className="font-display text-xl">
                  {invoice.totalCents != null ? formatMoney(invoice.totalCents / 100) : "—"}
                </div>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Invoice #
                </div>
                <div className="font-display text-xl">{invoice.invoiceNumber ?? "—"}</div>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Items
                </div>
                <div className="font-display text-xl">{lines.length}</div>
              </div>
              <div className="rounded-xl border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Discount
                </div>
                <div className="mt-0.5 flex items-center gap-1">
                  <span className="text-muted-foreground">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    onBlur={commitDiscount}
                    className="w-full bg-transparent font-display text-xl outline-none placeholder:text-muted-foreground/50"
                  />
                </div>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Enter the discount printed on the invoice (e.g. "TOTAL DISCOUNTS" or "Discount$") —
              not extracted automatically.
            </p>

            <div className="mt-5">
              <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Line items — match to an ingredient
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Extracted description</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Ingredient match</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="font-medium">{l.rawDescription || "—"}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {l.quantity != null ? `${l.quantity} ${l.unit ?? ""}` : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {l.lineTotalCents != null ? formatMoney(l.lineTotalCents / 100) : "—"}
                      </TableCell>
                      <TableCell>
                        <select
                          value={l.ingredientId ?? ""}
                          onChange={(e) =>
                            updateLineIngredient.mutate({
                              lineId: l.id,
                              ingredientId: e.target.value || null,
                            })
                          }
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                        >
                          <option value="">Unmatched</option>
                          {ingredients.map((ing) => (
                            <option key={ing.id} value={ing.id}>
                              {ing.name}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Separator className="my-5" />

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {lines.filter((l) => l.ingredientId).length}/{lines.length} lines matched
              </span>
              {invoice.status === "approved" ? (
                <Badge
                  variant="outline"
                  className="border-emerald-200 bg-emerald-50 text-emerald-700"
                >
                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approved
                </Badge>
              ) : (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => approveInvoice.mutate(activeId)}
                  disabled={approveInvoice.isPending || !invoice.vendorId}
                  title={!invoice.vendorId ? "Pick a vendor above before approving" : undefined}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve invoice
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// =====================================================
// Savings tab — real discounts, typed in by the reviewer off the
// actual invoice at approve time (see useSetInvoiceDiscount). No
// projected/AI-estimated savings anywhere on this tab.
// =====================================================

function SavingsTab({ dateRange }: { dateRange: DateRange }) {
  const { data } = useSavingsSummary(dateRange);
  const totalDiscountCents = data?.totalDiscountCents ?? 0;
  const invoicesWithDiscountCount = data?.invoicesWithDiscountCount ?? 0;
  const approvedInvoiceCount = data?.approvedInvoiceCount ?? 0;
  const byVendor = data?.byVendor ?? [];
  const invoices = data?.invoices ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Total savings captured
          </div>
          <div className="mt-1 font-display text-3xl">${(totalDiscountCents / 100).toFixed(2)}</div>
          <div className="mt-1 text-xs text-muted-foreground">from approved invoices</div>
        </Card>
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Invoices with a discount logged
          </div>
          <div className="mt-1 font-display text-3xl">
            {invoicesWithDiscountCount}
            <span className="text-lg text-muted-foreground">/{approvedInvoiceCount}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            of approved invoices — discount is entered manually during review
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Avg. savings per logged invoice
          </div>
          <div className="mt-1 font-display text-3xl">
            $
            {(
              (invoicesWithDiscountCount > 0 ? totalDiscountCents / invoicesWithDiscountCount : 0) /
              100
            ).toFixed(2)}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Savings by vendor
          </div>
          <h3 className="mt-1 font-display text-xl">Where the discounts came from</h3>
          <div className="mt-4 space-y-3">
            {byVendor.map((v) => (
              <div key={v.vendorId} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{v.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {v.invoiceCount} invoice{v.invoiceCount === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="font-display">{formatMoney(v.discountCents / 100)}</div>
              </div>
            ))}
            {byVendor.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No discounts logged yet.
              </p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Recent
          </div>
          <h3 className="mt-1 font-display text-xl">Invoices with a discount</h3>
          <div className="mt-4 space-y-3">
            {invoices.map((i) => (
              <div key={i.id} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{i.vendorName ?? "Unknown vendor"}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.invoiceNumber ?? "—"} · {i.invoiceDate ?? "—"}
                  </div>
                </div>
                <div className="font-display text-emerald-700">
                  −{formatMoney(i.discountCents / 100)}
                </div>
              </div>
            ))}
            {invoices.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No discounts logged yet.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// =====================================================
// Automation tab — real Gmail-based invoice ingestion.
// Replaces the old email/portal/API/EDI mockup with the one real
// connected source (Gmail), a real recent-activity feed from
// processed_email_messages, and the real pending-review queue.
// =====================================================

// The From: header is "Display Name <address@domain.com>" (or just a
// bare address) — same extraction email-ingest does server-side, kept
// duplicated here since the frontend doesn't share code with the
// Railway services.
function extractEmailFromHeader(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/<([^>]+)>/);
  const candidate = (match ? match[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function AutomationTab() {
  const { data: status } = useEmailIngestionStatus();
  const { data: activity = [] } = useEmailIngestionActivity();
  const { data: allInvoices = [] } = useRealInvoices();
  const { data: vendors = [] } = useRealVendors();
  const promoteSender = usePromoteSenderAndAssignVendor();
  const pending = allInvoices.filter((i) => i.status === "pending_review");
  const unknownSenderQueue = allInvoices.filter((i) => i.flags.includes("unknown_sender"));

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/[0.04] p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/15 text-primary">
            <Mail className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.18em] text-primary/80">
              Email ingestion
            </div>
            {status ? (
              <>
                <h3 className="font-display text-xl">{status.connectedEmail}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {status.labelFilter
                    ? `Watching the "${status.labelFilter}" label · checks every 15 minutes`
                    : "No label set — checks every message with a PDF attachment"}
                  {status.lastSyncedAt &&
                    ` · last ran ${new Date(status.lastSyncedAt).toLocaleString()}`}
                </p>
              </>
            ) : (
              <>
                <h3 className="font-display text-xl">No inbox connected</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Email ingestion hasn't been set up for this restaurant yet.
                </p>
              </>
            )}
          </div>
        </div>
      </Card>

      {unknownSenderQueue.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40 p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" /> Unknown sender queue
          </div>
          <h3 className="mt-1 font-display text-xl">
            {unknownSenderQueue.length} invoice{unknownSenderQueue.length === 1 ? "" : "s"} from an
            unrecognized sender
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick the real vendor for each — the sender gets remembered on that vendor's invoicing
            list, so future emails from them are matched automatically.
          </p>
          <div className="mt-4 space-y-3">
            {unknownSenderQueue.map((inv) => {
              const senderEmail = extractEmailFromHeader(inv.sourceEmailFrom);
              const suggestedVendor = inv.vendorId
                ? vendors.find((v) => v.id === inv.vendorId)
                : null;
              return (
                  <div key={inv.id} className="rounded-xl border border-amber-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {inv.sourceEmailFrom ?? "Unknown sender"}
                        </div>
                        {inv.sourceEmailSubject && (
                          <div className="truncate text-xs text-muted-foreground">
                            {inv.sourceEmailSubject}
                          </div>
                        )}
                      </div>
                      <div className="font-display text-sm">
                        {inv.totalCents != null ? formatMoney(inv.totalCents / 100) : "—"}
                      </div>
                    </div>
                    {/* Vendor-name fallback (ocr/'s persistResult) may have already
                        resolved this from the invoice content itself, even though
                        the sender is unrecognized — surfaced as an explicit confirm
                        rather than a pre-selected <select> option, since re-picking
                        an already-selected <option> doesn't fire onChange. */}
                    {suggestedVendor && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        <span>
                          Matched to <span className="font-medium">{suggestedVendor.name}</span>{" "}
                          from the invoice content — confirm to also remember this sender.
                        </span>
                        <Button
                          size="sm"
                          className="h-7 gap-1 text-xs"
                          disabled={promoteSender.isPending}
                          onClick={() =>
                            promoteSender.mutate({
                              invoiceId: inv.id,
                              vendorId: suggestedVendor.id,
                              currentFlags: inv.flags,
                              senderEmail,
                            })
                          }
                        >
                          Confirm {suggestedVendor.name}
                        </Button>
                      </div>
                    )}
                    <select
                      defaultValue=""
                      disabled={promoteSender.isPending}
                      onChange={(e) => {
                        if (e.target.value) {
                          promoteSender.mutate({
                            invoiceId: inv.id,
                            vendorId: e.target.value,
                            currentFlags: inv.flags,
                            senderEmail,
                          });
                        }
                      }}
                      className="mt-2.5 h-9 w-full rounded-md border border-amber-300 bg-white px-3 text-sm"
                    >
                      <option value="">
                        {suggestedVendor
                          ? "Or pick a different vendor…"
                          : "Assign vendor & remember this sender…"}
                      </option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
            })}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Recent activity
          </div>
          <h3 className="mt-1 font-display text-xl">Emails processed</h3>
          <div className="mt-4 space-y-3">
            {activity.map((e) => (
              <div key={e.id} className="border-l-2 border-primary/40 pl-3">
                <div className="text-xs text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString()}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {e.vendorName ?? (e.invoiceId ? "Needs vendor" : (e.filename ?? "No attachment"))}
                  </span>
                  {e.outcome === "processed" ? (
                    e.flags.length > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-amber-200 bg-amber-50 text-amber-800"
                      >
                        Flagged: {e.flags.map((f) => FLAG_LABELS[f] ?? f).join(", ")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                        Invoice created
                      </Badge>
                    )
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-muted bg-muted/40 text-muted-foreground"
                    >
                      Skipped: {SKIP_REASON_LABELS[e.reason] ?? e.reason}
                    </Badge>
                  )}
                </div>
                {e.totalCents != null && (
                  <div className="text-xs text-muted-foreground">
                    {formatMoney(e.totalCents / 100)}
                  </div>
                )}
              </div>
            ))}
            {activity.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No emails processed yet.
              </p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <FileSearch className="h-3.5 w-3.5" /> Needs your eye
          </div>
          <h3 className="mt-1 font-display text-xl">Pending review · {pending.length}</h3>
          <div className="mt-4 space-y-3">
            {pending.map((i) => (
              <div key={i.id} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{i.vendorName ?? "Needs vendor"}</div>
                  <div className="text-xs text-muted-foreground">{i.invoiceNumber ?? "—"}</div>
                </div>
                <div className="font-display">
                  {i.totalCents != null ? formatMoney(i.totalCents / 100) : "—"}
                </div>
              </div>
            ))}
            {pending.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing pending.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// Label primitive (kept local to avoid extra import)
function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-medium">{children}</div>;
}
