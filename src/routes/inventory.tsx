import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  useVendors,
  useCreateVendor,
  useUpdateVendor,
  useDeleteVendor,
  useInventoryItems,
  useCreateInventoryItem,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useUpdateOnHand,
  useUpdatePar,
  useMarkOrdered,
  useBulkAssignVendor,
  useRecomputeParLevels,
  useUsageTrend,
  useCreatePurchaseOrders,
  usePurchaseOrders,
  useSendPurchaseOrderEmail,
  useExtractInventoryItems,
  useBulkCreateInventoryItems,
  type Vendor,
  type InventoryItem,
  type ExtractedInventoryItem,
  type BulkCreateResult,
} from "@/lib/boh/queries";
import { isFreeEmailProviderDomain } from "@/lib/boh/emailDomains";
import { VENDOR_CATEGORIES } from "@/lib/boh/vendor-categories";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle,
  Bot,
  Brain,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Filter,
  Mail,
  Minus,
  Package,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShoppingCart,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Truck,
  Upload,
  UserPlus,
  Wand2,
  X,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { AiRecommendationsPanel } from "@/components/insights/AiRecommendationsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIES as SHARED_CATEGORIES } from "@/lib/boh/ingredient-categories";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory & Ordering · Thrasher's Pub" },
      {
        name: "description",
        content:
          "Track par levels across beverages, alcohol, food and dry goods. Build smart carts and let the AI ordering agent send POs to vendors automatically.",
      },
    ],
  }),
  component: InventoryPage,
});

// A fixed category list still constrains the "Add item" form dropdown
// (see the dialog below), but the type itself is a plain string since
// ingredients.category is free-text in the schema. The list itself
// comes from ingredient-categories.ts — shared with recipes.tsx's
// menu-category-to-bucket mapping so the two pages' filters never
// drift apart.
type Category = string;
type Item = InventoryItem;

const CATEGORIES: Category[] = [...SHARED_CATEGORIES];
const ORDERS_PAGE_SIZE = 50;
const ITEMS_PAGE_SIZE = 50;
const VENDORS_PAGE_SIZE = 50;

// Editable review row for the bulk-import dialog — one per real item
// Claude extracted from the uploaded photo/document, mapped toward
// the same shape useBulkCreateInventoryItems expects. `include` lets
// the owner drop a row (a misread line, a duplicate) before
// committing; nothing is written until they do.
type BulkImportRow = {
  name: string;
  category: Category;
  unit: string;
  onHand: number;
  par: number;
  vendorId: string | null;
  cost: number;
  include: boolean;
};

function toBulkImportRow(vendors: Vendor[]) {
  return (item: ExtractedInventoryItem): BulkImportRow => {
    const matchedVendor = item.vendorGuess
      ? vendors.find((v) => v.name.toLowerCase() === item.vendorGuess!.toLowerCase())
      : undefined;
    return {
      name: item.name,
      category: item.category && CATEGORIES.includes(item.category) ? item.category : "Food",
      unit: item.unit ?? "",
      onHand: item.quantity ?? 0,
      par: 1,
      vendorId: matchedVendor?.id ?? null,
      cost: item.unitCost ?? 0,
      include: true,
    };
  };
}

function suggestedQty(item: Item) {
  // suggested = par - onHand, padded by ~10% safety stock, min 0
  const base = Math.max(0, item.par - item.onHand);
  const safety = Math.ceil(item.weeklyUsage * 0.15);
  return base > 0 ? base + safety : 0;
}

function stockState(item: Item): { label: string; tone: string } {
  const ratio = item.onHand / item.par;
  if (ratio <= 0.34)
    return {
      label: "Critical",
      tone: "bg-terracotta/15 text-terracotta border-terracotta/30",
    };
  if (ratio <= 0.6) return { label: "Low", tone: "bg-amber-100 text-amber-900 border-amber-300" };
  if (ratio >= 1)
    return { label: "Stocked", tone: "bg-emerald-100 text-emerald-900 border-emerald-300" };
  return { label: "OK", tone: "bg-stone-100 text-stone-700 border-stone-300" };
}

type ItemDraft = {
  name: string;
  category: Category;
  unit: string;
  onHand: number;
  par: number;
  vendor: string;
  cost: number;
  weeklyUsage: number;
  // How much volume (ml) is in one purchase unit — e.g. 750 for a
  // standard wine bottle bought "each." Only relevant for items also
  // used in recipes by the oz/ml/L; 0 means "not set."
  containerSizeMl: number;
};

function InventoryPage() {
  const { data: items = [] } = useInventoryItems();
  const createItem = useCreateInventoryItem();
  const updateItem = useUpdateInventoryItem();
  const deleteItemMutation = useDeleteInventoryItem();
  const updateOnHandMutation = useUpdateOnHand();
  const updateParMutation = useUpdatePar();
  const recomputeParLevels = useRecomputeParLevels();
  const markOrdered = useMarkOrdered();
  const bulkAssignVendor = useBulkAssignVendor();
  const { data: usageTrend = [] } = useUsageTrend();
  const createPurchaseOrders = useCreatePurchaseOrders();
  const { data: purchaseOrders = [] } = usePurchaseOrders();
  const sendEmail = useSendPurchaseOrderEmail();
  const { data: vendors = [] } = useVendors();
  const createVendor = useCreateVendor();
  const updateVendor = useUpdateVendor();
  const deleteVendorMutation = useDeleteVendor();
  const [view, setView] = useState<"items" | "vendors" | "orders">("items");
  const [tab, setTab] = useState<Category | "All">("All");
  const [query, setQuery] = useState("");
  const [vendorFilter, setVendorFilter] = useState<string>("All");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  // Per-item override of the AI-suggested reorder quantity — lets a
  // manager correct a suggestion (e.g. AI says 10 but they know 6 is
  // coming from another source) before it's added to the cart. Only
  // stored once the user actually edits a value; otherwise the raw
  // suggestedQty() keeps driving the displayed number.
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkVendorId, setBulkVendorId] = useState("");
  const [ordersPage, setOrdersPage] = useState(1);
  const ordersTotalPages = Math.max(1, Math.ceil(purchaseOrders.length / ORDERS_PAGE_SIZE));
  const pagedPurchaseOrders = useMemo(
    () => purchaseOrders.slice((ordersPage - 1) * ORDERS_PAGE_SIZE, ordersPage * ORDERS_PAGE_SIZE),
    [purchaseOrders, ordersPage],
  );
  const [itemsPage, setItemsPage] = useState(1);
  const [vendorsPage, setVendorsPage] = useState(1);

  const [agentOpen, setAgentOpen] = useState(false);
  const [sentToast, setSentToast] = useState<string | null>(null);

  // Item dialog — same dialog/draft state for both Add and Edit,
  // mirroring the Vendor dialog's vendorEditing pattern. null means
  // "creating a new item"; set means "editing this existing item".
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [itemEditingId, setItemEditingId] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft>({
    name: "",
    category: "Food",
    unit: "case",
    onHand: 0,
    par: 1,
    vendor: vendors[0]?.name ?? "",
    cost: 0,
    weeklyUsage: 0,
    containerSizeMl: 0,
  });
  const [itemToDelete, setItemToDelete] = useState<Item | null>(null);

  // Bulk import — extract from an uploaded photo/document, then let
  // the owner review/edit every row before anything is written; no
  // auto-import path exists.
  const extractInventoryItems = useExtractInventoryItems();
  const bulkCreateInventoryItems = useBulkCreateInventoryItems();
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportRows, setBulkImportRows] = useState<BulkImportRow[]>([]);
  const [bulkImportResult, setBulkImportResult] = useState<BulkCreateResult | null>(null);
  const [bulkImportVendorId, setBulkImportVendorId] = useState("");

  const openBulkImport = () => {
    setBulkImportRows([]);
    setBulkImportResult(null);
    setBulkImportVendorId("");
    extractInventoryItems.reset();
    setBulkImportOpen(true);
  };

  const handleBulkImportFile = (file: File) => {
    setBulkImportResult(null);
    extractInventoryItems.mutate(
      { file, vendorNames },
      {
        onSuccess: (items) => setBulkImportRows(items.map(toBulkImportRow(vendors))),
      },
    );
  };

  const updateBulkImportRow = (index: number, patch: Partial<BulkImportRow>) => {
    setBulkImportRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeBulkImportRow = (index: number) => {
    setBulkImportRows((rows) => rows.filter((_, i) => i !== index));
  };

  // Applies one vendor to every currently-checked row at once — the
  // common case for a bulk import, since most of a single supplier's
  // price list/order guide shares one vendor. Reuses each row's
  // "include" checkbox as the selection, rather than a second
  // checkbox column, since the rows you'd bulk-assign a vendor to are
  // exactly the rows you're planning to import anyway.
  const applyBulkImportVendor = () => {
    if (!bulkImportVendorId) return;
    setBulkImportRows((rows) =>
      rows.map((r) => (r.include ? { ...r, vendorId: bulkImportVendorId } : r)),
    );
  };

  const commitBulkImport = () => {
    const included = bulkImportRows.filter((r) => r.include && r.name.trim());
    bulkCreateInventoryItems.mutate(
      included.map((r) => ({
        name: r.name.trim(),
        category: r.category,
        unit: r.unit || "unit",
        onHand: r.onHand,
        par: r.par,
        vendorId: r.vendorId,
        costCents: r.cost > 0 ? Math.round(r.cost * 100) : null,
      })),
      { onSuccess: (result) => setBulkImportResult(result) },
    );
  };

  // Vendor dialog
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [vendorEditing, setVendorEditing] = useState<Vendor | null>(null);
  const [vendorDraft, setVendorDraft] = useState<Omit<Vendor, "id">>({
    name: "",
    contactName: "",
    email: "",
    phone: "",
    accountNo: "",
    deliveryDays: "",
    terms: "Net 30",
    notes: "",
    invoicingSenderEmails: [],
    category: "food_beverage",
  });
  // Kept as free-typed text, not the draft's string[] directly — parsing
  // every keystroke into an array and joining it back for display would
  // fight the cursor position while typing "a, b, ". Parsed into
  // vendorDraft.invoicingSenderEmails only in saveVendor.
  const [vendorSenderEmailsText, setVendorSenderEmailsText] = useState("");
  const [vendorSenderEmailsError, setVendorSenderEmailsError] = useState<string | null>(null);
  const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null);

  const vendorNames = useMemo(() => vendors.map((v) => v.name), [vendors]);
  // An ingredient's "preferred vendor" only ever makes sense as a real
  // food/bev supplier — a Utilities or Rent vendor should never be
  // selectable here, or in the bulk-assign/bulk-import vendor pickers.
  const foodBeverageVendors = useMemo(
    () => vendors.filter((v) => v.category === "food_beverage"),
    [vendors],
  );
  const foodBeverageVendorNames = useMemo(
    () => foodBeverageVendors.map((v) => v.name),
    [foodBeverageVendors],
  );
  const vendorsTotalPages = Math.max(1, Math.ceil(vendors.length / VENDORS_PAGE_SIZE));
  const pagedVendors = useMemo(
    () => vendors.slice((vendorsPage - 1) * VENDORS_PAGE_SIZE, vendorsPage * VENDORS_PAGE_SIZE),
    [vendors, vendorsPage],
  );

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (tab !== "All" && i.category !== tab) return false;
      if (vendorFilter !== "All" && i.vendor !== vendorFilter) return false;
      if (query && !i.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [items, tab, vendorFilter, query]);

  // Any change to what's being filtered should land back on page 1 —
  // otherwise a narrower filter can strand you on a now-empty page.
  useEffect(() => {
    setItemsPage(1);
  }, [tab, vendorFilter, query]);

  const itemsTotalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PAGE_SIZE));
  const pagedFiltered = useMemo(
    () => filtered.slice((itemsPage - 1) * ITEMS_PAGE_SIZE, itemsPage * ITEMS_PAGE_SIZE),
    [filtered, itemsPage],
  );

  // Category now reads as a section heading instead of a per-row column.
  // Only needed while the "All" tab is active — a single-category tab
  // already scopes the table to one category, so a repeated heading
  // would just be noise. `category` is free-text on the ingredients
  // table, so any value outside the fixed CATEGORIES list (e.g. a
  // one-off "Seafood" added from a real invoice) still gets its own
  // section rather than being silently dropped from view. Grouped from
  // the current page's slice, not the full filtered list — pagination
  // and category sections both apply together, same as scrolling any
  // other paginated, grouped table.
  const itemSections = useMemo(() => {
    if (tab !== "All") return [{ category: tab, items: pagedFiltered }];
    const extraCategories = Array.from(
      new Set(pagedFiltered.map((i) => i.category).filter((c) => !CATEGORIES.includes(c))),
    ).sort();
    return [...CATEGORIES, ...extraCategories]
      .map((c) => ({ category: c, items: pagedFiltered.filter((i) => i.category === c) }))
      .filter((s) => s.items.length > 0);
  }, [pagedFiltered, tab]);

  // Selection deliberately persists across tab/search/vendor-filter
  // changes — the point of bulk assignment is to build a selection
  // across several different searches (e.g. search "vodka", select
  // some, search "rum", select more) before applying one vendor to
  // everything at once. The "N selected" bar stays visible regardless
  // of the active filter as the reminder that a selection exists.
  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id));
  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(filtered.map((i) => i.id)) : new Set());
  };
  const applyBulkVendor = () => {
    if (!bulkVendorId || selectedIds.size === 0) return;
    bulkAssignVendor.mutate(
      { ingredientIds: Array.from(selectedIds), vendorId: bulkVendorId },
      {
        onSuccess: () => {
          setSelectedIds(new Set());
          setBulkVendorId("");
        },
      },
    );
  };

  const kpis = useMemo(() => {
    const critical = items.filter((i) => i.onHand / i.par <= 0.34).length;
    const low = items.filter((i) => {
      const r = i.onHand / i.par;
      return r > 0.34 && r <= 0.6;
    }).length;
    const inventoryValue = items.reduce((s, i) => s + i.onHand * i.cost, 0);
    const cartValue = Object.entries(cart).reduce((s, [id, q]) => {
      const it = items.find((x) => x.id === id);
      return s + (it ? it.cost * q : 0);
    }, 0);
    return { critical, low, inventoryValue, cartValue };
  }, [items, cart]);

  // Real reorder summary for the hero strip — same suggestedQty() par-
  // level math the "Auto-fill cart" button already uses, just totaled
  // across every item instead of applied to one. Not a forecast; a
  // straightforward par - on-hand + safety-stock calculation from real
  // par levels, on-hand counts, and weekly usage.
  const reorderSummary = useMemo(() => {
    const needsReorder = items.filter((i) => suggestedQty(i) > 0);
    const vendorIds = new Set(
      needsReorder.map((i) => i.vendorId).filter((id): id is string => !!id),
    );
    const estimatedTotal = needsReorder.reduce((sum, i) => sum + suggestedQty(i) * i.cost, 0);
    return { itemCount: needsReorder.length, vendorCount: vendorIds.size, estimatedTotal };
  }, [items]);

  const addToCart = (id: string, qty: number) => {
    if (qty <= 0) return;
    setCart((c) => ({ ...c, [id]: (c[id] || 0) + qty }));
  };
  const setQtyOverride = (id: string, qty: number) => {
    setQtyOverrides((o) => ({ ...o, [id]: Math.max(0, qty) }));
  };
  const setCartQty = (id: string, qty: number) => {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = qty;
      return next;
    });
  };
  const updatePar = (id: string, par: number) => {
    updateParMutation.mutate({ ingredientId: id, par });
  };
  const updateOnHand = (id: string, onHand: number) => {
    updateOnHandMutation.mutate({ ingredientId: id, onHand });
  };

  // ----- Item CRUD -----
  const openAddItem = () => {
    setItemEditingId(null);
    setItemDraft({
      name: "",
      category: tab === "All" ? "Food" : tab,
      unit: "case",
      onHand: 0,
      par: 1,
      vendor: vendorNames[0] ?? "",
      cost: 0,
      weeklyUsage: 0,
      containerSizeMl: 0,
    });
    setItemDialogOpen(true);
  };
  const openEditItem = (item: Item) => {
    setItemEditingId(item.id);
    setItemDraft({
      name: item.name,
      category: item.category,
      unit: item.unit,
      onHand: item.onHand,
      par: item.par,
      vendor: item.vendor,
      cost: item.cost,
      weeklyUsage: item.weeklyUsage,
      containerSizeMl: item.containerSizeMl ?? 0,
    });
    setItemDialogOpen(true);
  };
  const saveItem = () => {
    if (!itemDraft.name.trim()) return;
    const vendorId = vendors.find((v) => v.name === itemDraft.vendor)?.id ?? null;
    const costCents = itemDraft.cost ? Math.round(itemDraft.cost * 100) : null;
    const containerSizeMl = itemDraft.containerSizeMl > 0 ? itemDraft.containerSizeMl : null;
    if (itemEditingId) {
      updateItem.mutate({
        id: itemEditingId,
        name: itemDraft.name.trim(),
        category: itemDraft.category,
        unit: itemDraft.unit,
        vendorId,
        costCents,
        containerSizeMl,
      });
      updateOnHand(itemEditingId, itemDraft.onHand);
      updatePar(itemEditingId, itemDraft.par);
    } else {
      createItem.mutate({
        name: itemDraft.name.trim(),
        category: itemDraft.category,
        unit: itemDraft.unit,
        onHand: itemDraft.onHand,
        par: itemDraft.par,
        vendorId,
        costCents,
        containerSizeMl,
      });
    }
    setItemDialogOpen(false);
    setItemEditingId(null);
  };
  const confirmDeleteItem = () => {
    if (!itemToDelete) return;
    deleteItemMutation.mutate(itemToDelete.id);
    setCart((c) => {
      const next = { ...c };
      delete next[itemToDelete.id];
      return next;
    });
    setItemToDelete(null);
  };

  // ----- Vendor CRUD -----
  const openAddVendor = () => {
    setVendorEditing(null);
    setVendorDraft({
      name: "",
      contactName: "",
      email: "",
      phone: "",
      accountNo: "",
      deliveryDays: "",
      terms: "Net 30",
      notes: "",
      invoicingSenderEmails: [],
      category: "food_beverage",
    });
    setVendorSenderEmailsText("");
    setVendorSenderEmailsError(null);
    setVendorDialogOpen(true);
  };
  const openEditVendor = (v: Vendor) => {
    setVendorEditing(v);
    const { id: _id, ...rest } = v;
    setVendorDraft(rest);
    setVendorSenderEmailsText(v.invoicingSenderEmails.join(", "));
    setVendorSenderEmailsError(null);
    setVendorDialogOpen(true);
  };
  const saveVendor = () => {
    if (!vendorDraft.name.trim()) return;
    const name = vendorDraft.name.trim();
    const invoicingSenderEmails = vendorSenderEmailsText
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    // A free-email-provider domain entry (@gmail.com etc) would trust
    // literally anyone with an account there — only an exact address
    // on those providers is allowed, never the whole domain.
    const badDomainEntry = invoicingSenderEmails.find(
      (e) => e.startsWith("@") && isFreeEmailProviderDomain(e.slice(1)),
    );
    if (badDomainEntry) {
      setVendorSenderEmailsError(
        `"${badDomainEntry}" is a free email provider — add the specific address(es) this vendor invoices from instead of the whole domain.`,
      );
      return;
    }
    setVendorSenderEmailsError(null);
    if (vendorEditing) {
      updateVendor.mutate({ id: vendorEditing.id, ...vendorDraft, name, invoicingSenderEmails });
      // Items still reference vendors by name (mock data, not yet wired
      // to real ingredients) — this cascade is dropped since it can't
      // stay correct once vendors are real and items aren't. Revisit
      // when ingredients/items are wired to real data.
    } else {
      createVendor.mutate({ ...vendorDraft, name, invoicingSenderEmails });
    }
    setVendorDialogOpen(false);
  };
  const confirmDeleteVendor = () => {
    if (!vendorToDelete) return;
    deleteVendorMutation.mutate(vendorToDelete.id);
    setVendorToDelete(null);
  };
  const vendorItemCount = (name: string) => items.filter((i) => i.vendor === name).length;

  const autoFillCart = () => {
    const next: Record<string, number> = { ...cart };
    items.forEach((i) => {
      const q = qtyOverrides[i.id] ?? suggestedQty(i);
      if (q > 0) next[i.id] = q;
    });
    setCart(next);
    setCartOpen(true);
  };

  // Group cart by vendor for the "send to vendors" view
  const cartByVendor = useMemo(() => {
    const groups: Record<
      string,
      { items: Array<Item & { qty: number; lineTotal: number }>; total: number }
    > = {};
    Object.entries(cart).forEach(([id, qty]) => {
      const it = items.find((x) => x.id === id);
      if (!it) return;
      const lineTotal = it.cost * qty;
      if (!groups[it.vendor]) groups[it.vendor] = { items: [], total: 0 };
      groups[it.vendor].items.push({ ...it, qty, lineTotal });
      groups[it.vendor].total += lineTotal;
    });
    return groups;
  }, [cart, items]);

  const cartCount = Object.values(cart).reduce((s, q) => s + q, 0);

  const sendToVendors = () => {
    // Real purchase orders need a real vendor_id — items with no
    // vendor assigned yet can't be part of one, so they're skipped
    // rather than silently attached to the wrong vendor or dropped
    // without explanation. (The bulk-assign-vendor feature is the
    // fix for that gap.)
    const groupsByVendorId = new Map<
      string,
      { ingredientId: string; quantity: number; unit: string; unitCostCents: number | null }[]
    >();
    const skippedNames: string[] = [];
    const orderedIngredientIds: string[] = [];

    Object.entries(cart).forEach(([id, qty]) => {
      const it = items.find((x) => x.id === id);
      if (!it) return;
      if (!it.vendorId) {
        skippedNames.push(it.name);
        return;
      }
      const list = groupsByVendorId.get(it.vendorId) ?? [];
      list.push({
        ingredientId: id,
        quantity: qty,
        unit: it.unit,
        unitCostCents: Math.round(it.cost * 100),
      });
      groupsByVendorId.set(it.vendorId, list);
      orderedIngredientIds.push(id);
    });

    const vendorGroups = Array.from(groupsByVendorId.entries()).map(([vendorId, lines]) => ({
      vendorId,
      lines,
    }));

    if (vendorGroups.length === 0) {
      setSentToast(
        "No items could be ordered — none of the items in your cart have a vendor assigned yet.",
      );
      setTimeout(() => setSentToast(null), 4500);
      return;
    }

    createPurchaseOrders.mutate(vendorGroups, {
      onSuccess: (results) => {
        markOrdered.mutate(orderedIngredientIds);
        const sent = results.filter((r) => r.emailStatus === "sent");
        const noEmail = results.filter((r) => r.emailStatus === "no_email");
        const failed = results.filter((r) => r.emailStatus === "failed");

        const parts = [
          `Created ${results.length} purchase order${results.length === 1 ? "" : "s"}.`,
        ];
        if (sent.length > 0) {
          parts.push(`Emailed ${sent.map((r) => r.vendorName).join(", ")}.`);
        }
        if (noEmail.length > 0) {
          parts.push(`No email on file for ${noEmail.map((r) => r.vendorName).join(", ")}.`);
        }
        if (failed.length > 0) {
          parts.push(`Failed to email ${failed.map((r) => r.vendorName).join(", ")}.`);
        }
        if (skippedNames.length > 0) {
          parts.push(
            `${skippedNames.length} item${skippedNames.length === 1 ? "" : "s"} skipped — no vendor assigned.`,
          );
        }
        setSentToast(parts.join(" "));
        setCart({});
        setCartOpen(false);
        setTimeout(() => setSentToast(null), 6000);
      },
    });
  };

  return (
    <div className="min-h-screen bg-cream">
      <Topbar eyebrow="Stock & purchasing" title="Inventory & Ordering" />

      <main className="px-8 py-8 max-w-[1500px] mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-terracotta font-semibold">
              Stock & purchasing
            </p>
            <h1 className="font-serif text-4xl text-ink mt-2">
              Inventory & Ordering
            </h1>
            <p className="text-sm text-stone-600 mt-2 max-w-xl">
              Live counts across beverages, alcohol, food and dry goods. Update par levels, build a
              cart from AI suggestions, and dispatch POs to vendors automatically.
            </p>
          </div>
        </div>

        <AiRecommendationsPanel tab="inventory" />

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiCard
            icon={<AlertTriangle className="h-4 w-4 text-terracotta" />}
            label="Critical items"
            value={String(kpis.critical)}
            hint="≤ 34% of par"
            trend="down"
          />
          <KpiCard
            icon={<TrendingDown className="h-4 w-4 text-amber-700" />}
            label="Low stock"
            value={String(kpis.low)}
            hint="Suggested reorder"
          />
          <KpiCard
            icon={<Package className="h-4 w-4 text-ink" />}
            label="On-hand value"
            value={`$${kpis.inventoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            hint="Across all categories"
          />
          <KpiCard
            icon={<ShoppingCart className="h-4 w-4 text-emerald-700" />}
            label="Cart subtotal"
            value={`$${kpis.cartValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            hint={`${cartCount} units staged`}
            trend="up"
          />
        </div>

        {/* AI Agent strip */}
        <Card className="p-5 bg-gradient-to-br from-ink to-stone-800 text-cream border-0">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="h-11 w-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <Brain className="h-5 w-5 text-amber-200" />
            </div>
            <div className="flex-1 min-w-[260px] text-stone-100">
              <div className="flex items-center gap-2">
                <p className="font-serif text-lg">Ordering Co-pilot</p>
                <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/30">
                  Active
                </Badge>
              </div>
              <p className="text-sm text-stone-300 mt-1">
                Based on current par levels, on-hand counts and weekly usage,{" "}
                <span className="text-amber-200 font-medium">
                  {reorderSummary.itemCount} item{reorderSummary.itemCount === 1 ? "" : "s"}
                </span>{" "}
                need reorder
                {reorderSummary.vendorCount > 0 &&
                  ` across ${reorderSummary.vendorCount} vendor${reorderSummary.vendorCount === 1 ? "" : "s"}`}
                . Estimated cost:{" "}
                <span className="text-amber-200 font-medium">
                  $
                  {reorderSummary.estimatedTotal.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  })}
                </span>
                .
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button size="sm" variant="secondary" onClick={autoFillCart}>
                  <Sparkles className="h-3.5 w-3.5" /> Build smart cart
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-stone-200 hover:text-white hover:bg-white/10"
                  onClick={() => setAgentOpen(true)}
                >
                  Agent settings
                </Button>
              </div>
            </div>
            <div className="w-[280px] h-[80px] hidden lg:block">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={usageTrend.map((p) => ({ week: p.week, usage: p.usageCents / 100 }))}
                >
                  <Bar dataKey="usage" fill="var(--terracotta)" radius={[4, 4, 0, 0]} />
                  <XAxis
                    dataKey="week"
                    tick={{ fill: "#d6d3d1", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v: number) =>
                      `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    }
                    contentStyle={{
                      background: "#1c1917",
                      border: "none",
                      borderRadius: 8,
                      color: "#fafaf9",
                    }}
                    cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>

        {/* Items vs Vendors */}
        <Tabs value={view} onValueChange={(v) => setView(v as "items" | "vendors" | "orders")}>
          <div className="max-w-full overflow-x-auto">
            <TabsList className="bg-cream border border-stone-200">
              <TabsTrigger value="items">
                <Package className="h-3.5 w-3.5" /> Items
                <Badge variant="outline" className="ml-2 font-normal">
                  {items.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="vendors">
                <Building2 className="h-3.5 w-3.5" /> Vendors
                <Badge variant="outline" className="ml-2 font-normal">
                  {vendors.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="orders">
                <ClipboardList className="h-3.5 w-3.5" /> Purchase orders
                <Badge variant="outline" className="ml-2 font-normal">
                  {purchaseOrders.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ITEMS TAB */}
          <TabsContent value="items" className="space-y-5 mt-5">
            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="max-w-full overflow-x-auto">
                <Tabs value={tab} onValueChange={(v) => setTab(v as Category | "All")}>
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
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search items"
                  className="pl-9 bg-white"
                />
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Filter className="h-4 w-4 text-stone-500" />
                <select
                  value={vendorFilter}
                  onChange={(e) => setVendorFilter(e.target.value)}
                  className="h-9 rounded-md border border-stone-200 bg-white px-2 text-sm"
                >
                  <option value="All">All vendors</option>
                  {vendorNames.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                <Button
                  variant="outline"
                  onClick={() => recomputeParLevels.mutate()}
                  disabled={recomputeParLevels.isPending}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${recomputeParLevels.isPending ? "animate-spin" : ""}`}
                  />
                  Recompute par levels
                </Button>
                <Button variant="outline" onClick={openAddItem}>
                  <Plus className="h-4 w-4" /> Add item
                </Button>
                <Button variant="outline" onClick={openBulkImport}>
                  <Upload className="h-4 w-4" /> Bulk import
                </Button>
                <Button variant="outline" onClick={() => setAgentOpen(true)}>
                  <Settings2 className="h-4 w-4" /> AI agent
                </Button>
                <Button variant="outline" onClick={autoFillCart}>
                  <Wand2 className="h-4 w-4" /> Auto-fill cart
                </Button>
                <Button onClick={() => setCartOpen(true)} className="relative">
                  <ShoppingCart className="h-4 w-4" /> Cart
                  {cartCount > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-white/25 px-2 text-xs">
                      {cartCount}
                    </span>
                  )}
                </Button>
              </div>
            </div>

            {/* Bulk vendor assignment */}
            {selectedIds.size > 0 && (
              <Card className="border-stone-200 bg-cream p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"} selected
                  </span>
                  <select
                    value={bulkVendorId}
                    onChange={(e) => setBulkVendorId(e.target.value)}
                    className="h-9 rounded-md border border-stone-200 bg-white px-2 text-sm"
                  >
                    <option value="">Assign vendor…</option>
                    {foodBeverageVendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={!bulkVendorId || bulkAssignVendor.isPending}
                    onClick={applyBulkVendor}
                  >
                    {bulkAssignVendor.isPending ? "Assigning…" : "Assign"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                    Clear selection
                  </Button>
                </div>
              </Card>
            )}

            {/* Items table */}
            <Card className="border-stone-200 overflow-hidden">
              <div className="overflow-x-auto">
              <Table className="[&_th]:px-4 [&_th]:py-3 [&_td]:px-4 [&_td]:py-4">
                <TableHeader>
                  <TableRow className="bg-stone-50/60">
                    <TableHead className="w-[44px]">
                      <Checkbox
                        checked={allFilteredSelected}
                        onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                        aria-label="Select all items"
                      />
                    </TableHead>
                    <TableHead className="w-[22%]">Item</TableHead>
                    <TableHead className="w-[14%]">Vendor</TableHead>
                    <TableHead className="w-[140px] text-center">On hand</TableHead>
                    <TableHead className="w-[150px] text-center">Par</TableHead>
                    <TableHead className="w-[110px] text-center">Status</TableHead>
                    <TableHead className="w-[170px] text-center">AI suggested</TableHead>
                    <TableHead className="w-[110px] text-right">Action</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itemSections.map(({ category, items: sectionItems }) => (
                    <Fragment key={category}>
                      {itemSections.length > 1 && (
                        <TableRow className="bg-stone-100/70 hover:bg-stone-100/70">
                          <TableCell
                            colSpan={9}
                            className="py-2 text-xs font-semibold uppercase tracking-wider text-stone-600"
                          >
                            {category}
                            <span className="ml-1.5 font-normal normal-case text-stone-400">
                              · {sectionItems.length}
                            </span>
                          </TableCell>
                        </TableRow>
                      )}
                      {sectionItems.map((item) => {
                        const state = stockState(item);
                        const draftQty = qtyOverrides[item.id] ?? suggestedQty(item);
                        const ratio = Math.min(1, item.onHand / item.par);
                        return (
                          <TableRow key={item.id} className="hover:bg-stone-50/50">
                            <TableCell>
                              <Checkbox
                                checked={selectedIds.has(item.id)}
                                onCheckedChange={(checked) =>
                                  toggleSelected(item.id, checked === true)
                                }
                                aria-label={`Select ${item.name}`}
                              />
                            </TableCell>
                            <TableCell>
                              <p className="font-medium text-ink">{item.name}</p>
                            </TableCell>
                            <TableCell className="text-sm text-stone-700">{item.vendor}</TableCell>
                            <TableCell>
                              <div className="flex flex-col items-center gap-1.5">
                                <InlineNumber
                                  value={item.onHand}
                                  unit={item.unit}
                                  onChange={(v) => updateOnHand(item.id, v)}
                                />
                                <Progress value={ratio * 100} className="h-1 w-20" />
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col items-center gap-1.5">
                                <InlineNumber
                                  value={item.par}
                                  unit={item.unit}
                                  onChange={(v) => updatePar(item.id, v)}
                                />
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className={state.tone}>
                                {state.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col items-center gap-1.5">
                                <InlineNumber
                                  value={draftQty}
                                  unit={item.unit}
                                  onChange={(v) => setQtyOverride(item.id, v)}
                                />
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                disabled={draftQty <= 0}
                                onClick={() => addToCart(item.id, draftQty)}
                              >
                                <Plus className="h-3.5 w-3.5" /> Cart
                              </Button>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-stone-500"
                                  onClick={() => openEditItem(item)}
                                  aria-label={`Edit ${item.name}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-stone-500 hover:text-terracotta"
                                  onClick={() => setItemToDelete(item)}
                                  aria-label={`Delete ${item.name}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </Fragment>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-sm text-stone-500">
                        No items match your filters.
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
                    : `Showing ${(itemsPage - 1) * ITEMS_PAGE_SIZE + 1}–${Math.min(itemsPage * ITEMS_PAGE_SIZE, filtered.length)} of ${filtered.length} item${filtered.length === 1 ? "" : "s"}`}
                </span>
                {itemsTotalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={itemsPage <= 1}
                      onClick={() => setItemsPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs text-stone-500">
                      Page {itemsPage} of {itemsTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={itemsPage >= itemsTotalPages}
                      onClick={() => setItemsPage((p) => Math.min(itemsTotalPages, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* VENDORS TAB */}
          <TabsContent value="vendors" className="space-y-5 mt-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="font-serif text-2xl text-ink">Vendor management</p>
                <p className="text-sm text-stone-600">
                  {vendors.length} vendors · {items.length} items assigned · used by Inventory,
                  Invoices and the Ordering agent.
                </p>
              </div>
              <Button onClick={openAddVendor}>
                <UserPlus className="h-4 w-4" /> Add vendor
              </Button>
            </div>

            <Card className="border-stone-200 overflow-hidden">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/60">
                    <TableHead className="w-[18%]">Vendor</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Invoicing senders</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Terms</TableHead>
                    <TableHead className="text-center">Items</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedVendors.map((v) => {
                    const count = vendorItemCount(v.name);
                    return (
                      <TableRow key={v.id} className="hover:bg-stone-50/50">
                        <TableCell>
                          <p className="font-medium text-ink">{v.name}</p>
                          {v.notes && <p className="text-xs text-stone-500 mt-0.5">{v.notes}</p>}
                        </TableCell>
                        <TableCell>
                          <p className="text-sm">{v.contactName}</p>
                          <p className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                            <Mail className="h-3 w-3" /> {v.email}
                          </p>
                          <p className="text-xs text-stone-500 flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {v.phone}
                          </p>
                        </TableCell>
                        <TableCell>
                          {v.invoicingSenderEmails.length === 0 ? (
                            <span className="text-xs text-stone-400">— none set</span>
                          ) : (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {v.invoicingSenderEmails.map((email) => (
                                <Badge
                                  key={email}
                                  variant="outline"
                                  className="font-normal text-[11px] font-mono"
                                >
                                  {email}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-mono text-stone-700">
                          {v.accountNo}
                        </TableCell>
                        <TableCell className="text-sm text-stone-700">{v.deliveryDays}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal">
                            {v.terms}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="text-sm tabular-nums font-medium">{count}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => openEditVendor(v)}
                              aria-label={`Edit ${v.name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-stone-500 hover:text-terracotta"
                              onClick={() => setVendorToDelete(v)}
                              aria-label={`Delete ${v.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {vendors.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10 text-sm text-stone-500">
                        No vendors yet. Add one to start assigning items.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-stone-50/60 px-4 py-3 text-sm">
                <span className="text-stone-500">
                  {vendors.length === 0
                    ? "0 vendors"
                    : `Showing ${(vendorsPage - 1) * VENDORS_PAGE_SIZE + 1}–${Math.min(vendorsPage * VENDORS_PAGE_SIZE, vendors.length)} of ${vendors.length} vendor${vendors.length === 1 ? "" : "s"}`}
                </span>
                {vendorsTotalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={vendorsPage <= 1}
                      onClick={() => setVendorsPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs text-stone-500">
                      Page {vendorsPage} of {vendorsTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={vendorsPage >= vendorsTotalPages}
                      onClick={() => setVendorsPage((p) => Math.min(vendorsTotalPages, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          {/* ORDERS TAB — real purchase order history. Creating a PO
              also attempts a real vendor email (see sendToVendors);
              this tab shows exactly what happened and lets you retry
              a failed or not-yet-sent email. */}
          <TabsContent value="orders" className="space-y-5 mt-5">
            <Card className="border-stone-200 overflow-hidden">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/60">
                    <TableHead>Vendor</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-center">Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Email</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedPurchaseOrders.map((po) => (
                    <TableRow key={po.id} className="hover:bg-stone-50/50">
                      <TableCell className="font-medium text-ink">
                        {po.vendorName}
                      </TableCell>
                      <TableCell className="text-sm text-stone-700">
                        {new Date(po.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell className="text-center text-sm">{po.lineCount}</TableCell>
                      <TableCell className="text-right font-medium">
                        {po.totalCents != null ? `$${(po.totalCents / 100).toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize font-normal">
                          {po.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {po.emailedAt ? (
                          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Emailed{" "}
                            {new Date(po.emailedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        ) : !po.vendorEmail ? (
                          <span className="text-xs text-stone-400">No email on file</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            {po.emailError && (
                              <span
                                className="text-xs text-terracotta"
                                title={po.emailError}
                              >
                                Failed
                              </span>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={sendEmail.isPending && sendEmail.variables === po.id}
                              onClick={() => sendEmail.mutate(po.id)}
                            >
                              {sendEmail.isPending && sendEmail.variables === po.id
                                ? "Sending…"
                                : po.emailError
                                  ? "Retry"
                                  : "Send"}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {purchaseOrders.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-sm text-stone-500">
                        No purchase orders yet — build a cart and create one from the Items tab.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-stone-50/60 px-4 py-3 text-sm">
                <span className="text-stone-500">
                  {purchaseOrders.length === 0
                    ? "0 purchase orders"
                    : `Showing ${(ordersPage - 1) * ORDERS_PAGE_SIZE + 1}–${Math.min(ordersPage * ORDERS_PAGE_SIZE, purchaseOrders.length)} of ${purchaseOrders.length} purchase order${purchaseOrders.length === 1 ? "" : "s"}`}
                </span>
                {ordersTotalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={ordersPage <= 1}
                      onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs text-stone-500">
                      Page {ordersPage} of {ordersTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      disabled={ordersPage >= ordersTotalPages}
                      onClick={() => setOrdersPage((p) => Math.min(ordersTotalPages, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Cart drawer */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-serif text-2xl flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" /> Order cart
            </SheetTitle>
            <SheetDescription>
              {cartCount === 0
                ? "Your cart is empty — add items or auto-fill from suggested reorders."
                : "Grouped by vendor — creates one real purchase order per vendor and emails each vendor with a contact email on file. Items with no vendor assigned yet will be skipped."}
            </SheetDescription>
          </SheetHeader>

          {cartCount === 0 ? (
            <div className="mt-10 text-center">
              <Button variant="outline" onClick={autoFillCart}>
                <Wand2 className="h-4 w-4" /> Auto-fill from AI
              </Button>
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              {Object.entries(cartByVendor).map(([vendor, group]) => (
                <div key={vendor} className="border border-stone-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between bg-stone-50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-stone-500" />
                      <p className="font-medium text-sm">{vendor}</p>
                    </div>
                    <p className="text-sm tabular-nums font-medium">${group.total.toFixed(2)}</p>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {group.items.map((line) => (
                      <div key={line.id} className="flex items-center gap-2 p-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{line.name}</p>
                          <p className="text-xs text-stone-500">
                            ${line.cost.toFixed(2)} / {line.unit}
                          </p>
                        </div>
                        <div className="flex items-center border border-stone-200 rounded-md">
                          <button
                            className="h-7 w-7 flex items-center justify-center hover:bg-stone-50"
                            onClick={() => setCartQty(line.id, line.qty - 1)}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center tabular-nums text-sm">{line.qty}</span>
                          <button
                            className="h-7 w-7 flex items-center justify-center hover:bg-stone-50"
                            onClick={() => setCartQty(line.id, line.qty + 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="w-16 text-right text-sm tabular-nums">
                          ${line.lineTotal.toFixed(2)}
                        </p>
                        <button
                          className="text-stone-400 hover:text-terracotta"
                          onClick={() => setCartQty(line.id, 0)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <Separator />

              <div className="flex items-center justify-between text-sm">
                <p className="text-stone-600">Subtotal</p>
                <p className="font-semibold text-base tabular-nums">${kpis.cartValue.toFixed(2)}</p>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                <ClipboardList className="h-4 w-4 text-amber-700 mt-0.5" />
                <div className="text-xs text-amber-900">
                  <p className="font-medium">Creating a purchase order</p>
                  <p className="mt-0.5">
                    On submit, this cart is split into one real purchase order per vendor and
                    emailed to any vendor with a contact email on file — you can review the history
                    and delivery status below.
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setCart({})}>
                  Clear
                </Button>
                <Button
                  className="flex-1"
                  onClick={sendToVendors}
                  disabled={createPurchaseOrders.isPending}
                >
                  <Send className="h-4 w-4" />
                  {createPurchaseOrders.isPending ? "Creating…" : "Create purchase orders"}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Agent settings drawer */}
      <Sheet open={agentOpen} onOpenChange={setAgentOpen}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-serif text-2xl flex items-center gap-2">
              <Brain className="h-5 w-5" /> How reorder suggestions work
            </SheetTitle>
            <SheetDescription>
              Real par-level math, not an autonomous agent — nothing here emails or contacts a
              vendor automatically.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-5">
            <div>
              <p className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                What drives a suggested quantity
              </p>
              <ul className="text-sm space-y-1.5 text-stone-700">
                <li className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-terracotta" /> Current par level
                  minus current on-hand count
                </li>
                <li className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-terracotta" /> Weekly usage, from
                  real POS sales mapped through each item's recipe
                </li>
                <li className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-terracotta" /> +15% padded on top
                  as safety stock
                </li>
              </ul>
            </div>

            <Separator />

            <div>
              <p className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                Vendor contacts
              </p>
              <div className="space-y-2">
                {vendors.slice(0, 5).map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between border border-stone-200 rounded-md px-3 py-2 text-sm"
                  >
                    <span className="font-medium">{v.name}</span>
                    {v.email ? (
                      <span className="flex items-center gap-1.5 text-stone-600">
                        <Mail className="h-3.5 w-3.5 text-stone-500" /> {v.email}
                      </span>
                    ) : (
                      <span className="text-xs text-stone-400">No contact on file</span>
                    )}
                  </div>
                ))}
                {vendors.length === 0 && <p className="text-sm text-stone-500">No vendors yet.</p>}
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setAgentOpen(false);
                setView("orders");
              }}
            >
              <ClipboardList className="h-4 w-4" /> View purchase order history
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Toast */}
      {sentToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm bg-ink text-cream rounded-lg shadow-xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-300 mt-0.5 shrink-0" />
          <div className="flex-1 text-sm text-stone-100">{sentToast}</div>
          <button onClick={() => setSentToast(null)} className="text-stone-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Add/Edit Item dialog */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {itemEditingId ? "Edit inventory item" : "Add inventory item"}
            </DialogTitle>
            <DialogDescription>
              {itemEditingId
                ? "Changes apply immediately across Inventory & Ordering."
                : "The Ordering agent will start tracking par levels and usage as soon as you save."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label htmlFor="item-name">Item name</Label>
              <Input
                id="item-name"
                value={itemDraft.name}
                onChange={(e) => setItemDraft({ ...itemDraft, name: e.target.value })}
                placeholder="e.g. Hendrick's Gin 1L"
              />
            </div>
            <div>
              <Label htmlFor="item-cat">Category</Label>
              <select
                id="item-cat"
                value={itemDraft.category}
                onChange={(e) =>
                  setItemDraft({ ...itemDraft, category: e.target.value as Category })
                }
                className="h-10 w-full rounded-md border border-stone-200 bg-white px-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="item-vendor">Vendor</Label>
              <select
                id="item-vendor"
                value={itemDraft.vendor}
                onChange={(e) => setItemDraft({ ...itemDraft, vendor: e.target.value })}
                className="h-10 w-full rounded-md border border-stone-200 bg-white px-2 text-sm"
              >
                <option value="">No vendor</option>
                {foodBeverageVendorNames.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="item-unit">Unit</Label>
              <Input
                id="item-unit"
                value={itemDraft.unit}
                onChange={(e) => setItemDraft({ ...itemDraft, unit: e.target.value })}
                placeholder="btl, case, lb…"
              />
            </div>
            <div>
              <Label htmlFor="item-container-size">Container size (ml)</Label>
              <Input
                id="item-container-size"
                type="number"
                min="0"
                step="1"
                value={itemDraft.containerSizeMl || ""}
                onChange={(e) =>
                  setItemDraft({ ...itemDraft, containerSizeMl: parseFloat(e.target.value) || 0 })
                }
                placeholder="e.g. 750"
              />
              <p className="mt-1 text-xs text-stone-500">
                Optional — set this so recipes can measure this item by the oz/ml/L even though
                you buy it as "{itemDraft.unit || "each"}."
              </p>
            </div>
            <div>
              <Label htmlFor="item-cost">Cost / unit ($)</Label>
              <Input
                id="item-cost"
                type="number"
                step="0.01"
                value={itemDraft.cost}
                onChange={(e) =>
                  setItemDraft({ ...itemDraft, cost: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <Label htmlFor="item-onhand">On hand</Label>
              <Input
                id="item-onhand"
                type="number"
                value={itemDraft.onHand}
                onChange={(e) =>
                  setItemDraft({ ...itemDraft, onHand: parseInt(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <Label htmlFor="item-par">Par</Label>
              <Input
                id="item-par"
                type="number"
                value={itemDraft.par}
                onChange={(e) => setItemDraft({ ...itemDraft, par: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="item-usage">Est. weekly usage ({itemDraft.unit || "units"})</Label>
              {itemEditingId ? (
                <>
                  <Input id="item-usage" type="number" value={itemDraft.weeklyUsage} disabled />
                  <p className="text-xs text-stone-500 mt-1">
                    Computed from real POS sales — not directly editable here.
                  </p>
                </>
              ) : (
                <>
                  <Input
                    id="item-usage"
                    type="number"
                    value={itemDraft.weeklyUsage}
                    onChange={(e) =>
                      setItemDraft({ ...itemDraft, weeklyUsage: parseInt(e.target.value) || 0 })
                    }
                  />
                  <p className="text-xs text-stone-500 mt-1">
                    Seed value — the agent will refine this from product mix once sales come in.
                  </p>
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveItem} disabled={!itemDraft.name.trim()}>
              {itemEditingId ? (
                "Save changes"
              ) : (
                <>
                  <Plus className="h-4 w-4" /> Add item
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk import dialog */}
      <Dialog open={bulkImportOpen} onOpenChange={setBulkImportOpen}>
        <DialogContent className="sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Bulk import inventory items</DialogTitle>
            <DialogDescription>
              Upload a photo or PDF of a supplier price list, order guide, or stock count sheet —
              Claude reads it and lists what it finds below. Nothing is added until you review and
              confirm.
            </DialogDescription>
          </DialogHeader>

          {bulkImportResult ? (
            <div className="space-y-3 py-4">
              <p className="text-sm">
                Added <strong>{bulkImportResult.created}</strong> item
                {bulkImportResult.created === 1 ? "" : "s"}.
              </p>
              {bulkImportResult.failed.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                  <p className="font-medium text-amber-900">
                    {bulkImportResult.failed.length} row
                    {bulkImportResult.failed.length === 1 ? "" : "s"} skipped:
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-amber-900">
                    {bulkImportResult.failed.map((f, i) => (
                      <li key={i}>
                        {f.name} — {f.error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : bulkImportRows.length > 0 ? (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto py-2">
              <p className="text-xs text-stone-500">
                {bulkImportRows.length} item{bulkImportRows.length === 1 ? "" : "s"} found. Edit
                anything Claude got wrong, uncheck rows to skip, then confirm.
              </p>

              <Card className="border-stone-200 bg-cream p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">
                    {bulkImportRows.filter((r) => r.include).length} row
                    {bulkImportRows.filter((r) => r.include).length === 1 ? "" : "s"} checked
                  </span>
                  <select
                    value={bulkImportVendorId}
                    onChange={(e) => setBulkImportVendorId(e.target.value)}
                    className="h-9 rounded-md border border-stone-200 bg-white px-2 text-sm"
                  >
                    <option value="">Assign vendor to checked rows…</option>
                    {foodBeverageVendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" disabled={!bulkImportVendorId} onClick={applyBulkImportVendor}>
                    Assign
                  </Button>
                </div>
              </Card>

              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>On hand</TableHead>
                    <TableHead>Par</TableHead>
                    <TableHead>Cost/unit ($)</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bulkImportRows.map((row, i) => (
                    <TableRow key={i} className={row.include ? "" : "opacity-40"}>
                      <TableCell>
                        <Checkbox
                          checked={row.include}
                          onCheckedChange={(v) => updateBulkImportRow(i, { include: !!v })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 min-w-[160px]"
                          value={row.name}
                          onChange={(e) => updateBulkImportRow(i, { name: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <select
                          value={row.category}
                          onChange={(e) => updateBulkImportRow(i, { category: e.target.value })}
                          className="h-8 rounded-md border border-stone-200 bg-white px-2 text-sm"
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell>
                        <select
                          value={row.vendorId ?? ""}
                          onChange={(e) =>
                            updateBulkImportRow(i, { vendorId: e.target.value || null })
                          }
                          className="h-8 rounded-md border border-stone-200 bg-white px-2 text-sm"
                        >
                          <option value="">No vendor</option>
                          {foodBeverageVendors.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-20"
                          value={row.unit}
                          placeholder="case, lb…"
                          onChange={(e) => updateBulkImportRow(i, { unit: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-16"
                          type="number"
                          value={row.onHand}
                          onChange={(e) =>
                            updateBulkImportRow(i, { onHand: parseInt(e.target.value) || 0 })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-16"
                          type="number"
                          value={row.par}
                          onChange={(e) =>
                            updateBulkImportRow(i, { par: parseInt(e.target.value) || 0 })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-20"
                          type="number"
                          step="0.01"
                          value={row.cost}
                          onChange={(e) =>
                            updateBulkImportRow(i, { cost: parseFloat(e.target.value) || 0 })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => removeBulkImportRow(i)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            </div>
          ) : (
            <div className="py-6">
              <label
                htmlFor="bulk-import-file"
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center ${
                  extractInventoryItems.isPending
                    ? "border-stone-200 opacity-60"
                    : "cursor-pointer border-stone-300 hover:border-stone-400"
                }`}
              >
                <Upload
                  className={`h-6 w-6 text-stone-400 ${extractInventoryItems.isPending ? "animate-pulse" : ""}`}
                />
                <p className="text-sm font-medium">
                  {extractInventoryItems.isPending
                    ? "Reading document…"
                    : "Click to upload a photo or PDF"}
                </p>
                <p className="text-xs text-stone-500">
                  Supplier price lists, order guides, stock count sheets — up to 15MB
                </p>
                <input
                  id="bulk-import-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                  className="hidden"
                  disabled={extractInventoryItems.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleBulkImportFile(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {extractInventoryItems.isError && (
                <p className="mt-3 text-center text-sm text-destructive">
                  {(extractInventoryItems.error as Error).message}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkImportOpen(false)}>
              {bulkImportResult ? "Close" : "Cancel"}
            </Button>
            {bulkImportRows.length > 0 && !bulkImportResult && (
              <Button
                onClick={commitBulkImport}
                disabled={
                  bulkCreateInventoryItems.isPending ||
                  bulkImportRows.filter((r) => r.include && r.name.trim()).length === 0
                }
              >
                {bulkCreateInventoryItems.isPending
                  ? "Adding…"
                  : `Add ${bulkImportRows.filter((r) => r.include).length} item${bulkImportRows.filter((r) => r.include).length === 1 ? "" : "s"}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete item confirm */}
      <AlertDialog open={!!itemToDelete} onOpenChange={(o) => !o && setItemToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {itemToDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the item from inventory and any pending cart line. Historical invoices stay
              intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteItem}
              className="bg-terracotta hover:bg-terracotta/90"
            >
              Delete item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Vendor dialog */}
      <Dialog open={vendorDialogOpen} onOpenChange={setVendorDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {vendorEditing ? "Edit vendor" : "Add vendor"}
            </DialogTitle>
            <DialogDescription>
              Vendor details are shared with the Invoices tab and the Ordering agent for
              auto-dispatch.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label htmlFor="v-name">Vendor name</Label>
              <Input
                id="v-name"
                value={vendorDraft.name}
                onChange={(e) => setVendorDraft({ ...vendorDraft, name: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="v-category">Expense category</Label>
              <select
                id="v-category"
                value={vendorDraft.category}
                onChange={(e) =>
                  setVendorDraft({ ...vendorDraft, category: e.target.value as Vendor["category"] })
                }
                className="h-10 w-full rounded-md border border-stone-200 bg-white px-2 text-sm"
              >
                {VENDOR_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="v-contact">Contact name</Label>
              <Input
                id="v-contact"
                value={vendorDraft.contactName}
                onChange={(e) => setVendorDraft({ ...vendorDraft, contactName: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="v-account">Account #</Label>
              <Input
                id="v-account"
                value={vendorDraft.accountNo}
                onChange={(e) => setVendorDraft({ ...vendorDraft, accountNo: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="v-email">Order email</Label>
              <Input
                id="v-email"
                type="email"
                value={vendorDraft.email}
                onChange={(e) => setVendorDraft({ ...vendorDraft, email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="v-phone">Phone</Label>
              <Input
                id="v-phone"
                value={vendorDraft.phone}
                onChange={(e) => setVendorDraft({ ...vendorDraft, phone: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="v-days">Delivery days</Label>
              <Input
                id="v-days"
                placeholder="e.g. Mon, Wed, Fri"
                value={vendorDraft.deliveryDays}
                onChange={(e) => setVendorDraft({ ...vendorDraft, deliveryDays: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="v-terms">Payment terms</Label>
              <select
                id="v-terms"
                value={vendorDraft.terms}
                onChange={(e) => setVendorDraft({ ...vendorDraft, terms: e.target.value })}
                className="h-10 w-full rounded-md border border-stone-200 bg-white px-2 text-sm"
              >
                {["COD", "Net 7", "Net 15", "Net 21", "Net 30", "Net 45", "Net 60"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="v-senders">Invoicing senders</Label>
              <Input
                id="v-senders"
                value={vendorSenderEmailsText}
                onChange={(e) => {
                  setVendorSenderEmailsText(e.target.value);
                  if (vendorSenderEmailsError) setVendorSenderEmailsError(null);
                }}
                placeholder="e.g. invoices@vendor.com, @vendor.com"
                className={vendorSenderEmailsError ? "border-terracotta" : ""}
              />
              {vendorSenderEmailsError ? (
                <p className="mt-1 text-xs text-terracotta">{vendorSenderEmailsError}</p>
              ) : (
                <p className="mt-1 text-xs text-stone-500">
                  Comma-separated — full addresses (invoices@vendor.com) and/or whole domains
                  (@vendor.com) this vendor invoices from. An invoice email matching one of these
                  is auto-assigned to this vendor instead of needing a manual pick. Free providers
                  (Gmail, Outlook, etc) can only be added as specific addresses, never a whole
                  domain.
                </p>
              )}
            </div>
            <div className="col-span-2">
              <Label htmlFor="v-notes">Notes</Label>
              <Textarea
                id="v-notes"
                rows={2}
                value={vendorDraft.notes ?? ""}
                onChange={(e) => setVendorDraft({ ...vendorDraft, notes: e.target.value })}
                placeholder="Optional — minimum orders, rep schedule, special instructions…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVendorDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveVendor} disabled={!vendorDraft.name.trim()}>
              {vendorEditing ? "Save changes" : "Add vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete vendor confirm */}
      <AlertDialog open={!!vendorToDelete} onOpenChange={(o) => !o && setVendorToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {vendorToDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {vendorToDelete && vendorItemCount(vendorToDelete.name) > 0 ? (
                <>
                  <span className="text-terracotta font-medium">
                    {vendorItemCount(vendorToDelete.name)} item(s) are still assigned to this
                    vendor.
                  </span>{" "}
                  Reassign or delete those items first — otherwise the Ordering agent won't know
                  where to send their POs.
                </>
              ) : (
                "This vendor has no items assigned and can be safely removed."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteVendor}
              disabled={!!vendorToDelete && vendorItemCount(vendorToDelete.name) > 0}
              className="bg-terracotta hover:bg-terracotta/90"
            >
              Delete vendor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
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
        {trend === "down" && (
          <TrendingDown className="h-3 w-3 text-terracotta ml-auto" />
        )}
      </div>
      <p className="font-serif text-3xl text-ink mt-2 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-stone-500 mt-1">{hint}</p>}
    </Card>
  );
}

function InlineNumber({
  value,
  unit,
  onChange,
}: {
  value: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1">
      <button
        className="h-6 w-6 flex items-center justify-center rounded border border-stone-200 hover:bg-stone-50"
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        <Minus className="h-3 w-3" />
      </button>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value || "0", 10)))}
        className="h-7 w-14 text-center tabular-nums px-1"
      />
      <button
        className="h-6 w-6 flex items-center justify-center rounded border border-stone-200 hover:bg-stone-50"
        onClick={() => onChange(value + 1)}
      >
        <Plus className="h-3 w-3" />
      </button>
      <span className="text-xs text-stone-500 ml-1">{unit}</span>
    </div>
  );
}

function NumberRow({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-stone-500 mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => onChange(Math.max(0, value - 1))}>
          <Minus className="h-3 w-3" />
        </Button>
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(Math.max(0, parseInt(e.target.value || "0", 10)))}
          className="text-center tabular-nums"
        />
        <Button variant="outline" size="icon" onClick={() => onChange(value + 1)}>
          <Plus className="h-3 w-3" />
        </Button>
        <span className="text-sm text-stone-500 w-12">{unit}</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-stone-200 rounded-md p-3">
      <p className="text-xs uppercase tracking-wider text-stone-500">{label}</p>
      <p className="text-sm font-medium text-ink mt-1">{value}</p>
    </div>
  );
}
