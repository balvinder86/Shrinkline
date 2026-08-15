import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useLocationIds, useRestaurantIds } from "@/lib/supabase/scope";
import { VENDOR_CATEGORIES, type VendorCategory } from "@/lib/boh/vendor-categories";
import { type WasteReason } from "@/lib/boh/waste-reasons";
import { fetchRecipeCostContext } from "@/lib/pos/queries";
import { resolvePrepRecipeCostPerYieldUnit, wouldCreateCycle } from "@/lib/boh/recipeCost";
import { convertQuantityToIngredientUnit } from "@/lib/units";
// Aliased — this file already exports its own string-based DateRange
// (see dateInRange below) for the Invoices dashboard's date filter;
// this is the app-wide Date-based range from the global date picker
// (useDateRange()), which is what Waste Log's period filter uses.
import { type DateRange as GlobalDateRange, isoDate } from "@/lib/date-range";

// A user's dashboard today only ever shows one location — same
// simplification as useCurrentRestaurantId, revisit when multi-location
// restaurants are onboarded.
function useCurrentLocationId(): string | undefined {
  return useLocationIds().data?.[0];
}

// A user can belong to more than one restaurant, but the dashboard
// today only ever shows one at a time — this picks the first as the
// "current" restaurant for writes. Revisit when a restaurant switcher
// exists (Phase 3 multi-tenant onboarding).
function useCurrentRestaurantId(): string | undefined {
  return useRestaurantIds()[0];
}

// Field names (email/terms, not contactEmail/paymentTerms) match what
// the existing Lovable-generated inventory.tsx/invoices.tsx UI already
// uses, to keep the diff on those large files minimal.
export type Vendor = {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  accountNo: string;
  deliveryDays: string;
  terms: string;
  notes?: string;
  // What kind of expense this vendor's invoices represent — drives
  // whether their approved-invoice totals count toward Food Cost %
  // (see useFoodCostSummary in lib/pos/queries.ts) and the Invoices
  // page's expense-category breakdown.
  category: VendorCategory;
  // Inbound addresses this vendor's invoices actually arrive from
  // (distinct from `email`, the outbound order-contact address) —
  // email-ingest matches an incoming message's From: header against
  // this list to auto-assign vendor_id instead of leaving every
  // email-ingested invoice for manual review.
  invoicingSenderEmails: string[];
};

function fromRow(row: any): Vendor {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name ?? "",
    email: row.contact_email ?? "",
    phone: row.phone ?? "",
    accountNo: row.account_no ?? "",
    deliveryDays: row.delivery_days ?? "",
    terms: row.payment_terms ?? "",
    notes: row.notes ?? undefined,
    invoicingSenderEmails: row.invoicing_sender_emails ?? [],
    category: (row.category as VendorCategory) ?? "food_beverage",
  };
}

export function useVendors() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["vendors", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<Vendor[]> => {
      const { data, error } = await supabase
        .from("vendors")
        .select("*")
        .eq("restaurant_id", restaurantId!)
        .order("name");
      if (error) throw error;
      return (data ?? []).map(fromRow);
    },
  });
}

export type VendorInput = Omit<Vendor, "id">;

function toRow(input: VendorInput) {
  return {
    name: input.name,
    contact_name: input.contactName || null,
    contact_email: input.email || null,
    phone: input.phone || null,
    account_no: input.accountNo || null,
    delivery_days: input.deliveryDays || null,
    payment_terms: input.terms || null,
    notes: input.notes || null,
    category: input.category,
    // Normalized here (not just trimmed) so email-ingest's lookup can
    // do a plain case-sensitive array match against a lowercased
    // From: address, no matter how the user typed it in the UI.
    invoicing_sender_emails: (input.invoicingSenderEmails ?? [])
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function useCreateVendor() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: VendorInput) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { error } = await supabase
        .from("vendors")
        .insert({ restaurant_id: restaurantId, ...toRow(input) });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendors"] }),
  });
}

export function useUpdateVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: VendorInput & { id: string }) => {
      const { error } = await supabase.from("vendors").update(toRow(input)).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendors"] });
      // Purchase order rows embed vendor name/email via a join, so a
      // vendor edit (e.g. adding a missing contact email) needs this
      // invalidated too, or the Orders tab's "Send" button stays hidden
      // until something else happens to trigger a refetch.
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export function useDeleteVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vendors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendors"] }),
  });
}

export type Ingredient = {
  id: string;
  name: string;
  unit: string;
  unitCostCents: number | null;
  category: string | null;
  containerSizeMl: number | null;
  containerSizeG: number | null;
};

export function useIngredients() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["ingredients", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<Ingredient[]> => {
      const { data, error } = await supabase
        .from("ingredients")
        .select("*")
        .eq("restaurant_id", restaurantId!)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        unit: row.unit,
        unitCostCents: row.unit_cost_cents,
        category: row.category,
        containerSizeMl: row.container_size_ml,
        containerSizeG: row.container_size_g,
      }));
    },
  });
}

export type IngredientInput = {
  name: string;
  unit: string;
  unitCostCents?: number | null;
  containerSizeMl?: number | null;
  containerSizeG?: number | null;
};

export function useCreateIngredient() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: IngredientInput) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { error } = await supabase.from("ingredients").insert({
        restaurant_id: restaurantId,
        name: input.name,
        unit: input.unit,
        unit_cost_cents: input.unitCostCents ?? null,
        container_size_ml: input.containerSizeMl ?? null,
        container_size_g: input.containerSizeG ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ingredients"] }),
  });
}

export function useUpdateIngredient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: IngredientInput & { id: string }) => {
      const { error } = await supabase
        .from("ingredients")
        .update({
          name: input.name,
          unit: input.unit,
          unit_cost_cents: input.unitCostCents ?? null,
          container_size_ml: input.containerSizeMl ?? null,
          container_size_g: input.containerSizeG ?? null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ingredients"] }),
  });
}

export function useDeleteIngredient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ingredients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ingredients"] }),
  });
}

// ------------------------------------------------------------
// Waste Log — record ingredient waste (spoilage, over-production,
// breakage, spills, expired stock, prep errors) with its dollar cost.
// Ingredient-only (no menu items) and cost-only — doesn't touch
// ingredient_stock.on_hand_quantity. See db/phase2/64_waste_log.sql.
// ------------------------------------------------------------
export type WasteLogEntry = {
  id: string;
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  reason: WasteReason;
  // Resolved and stored at log time, not recomputed live — see the
  // migration's comment on why. Null means the ingredient had no cost
  // yet, or the logged unit couldn't convert to its priced unit.
  costCents: number | null;
  notes: string | null;
  loggedAt: string;
};

type WasteLogDbRow = {
  id: string;
  ingredient_id: string;
  quantity: number;
  unit: string;
  reason: string;
  cost_cents: number | null;
  notes: string | null;
  logged_at: string;
  ingredients: { name: string } | null;
};

export function useWasteLog(range: GlobalDateRange) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);
  return useQuery({
    queryKey: ["waste-log", locationIds, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<WasteLogEntry[]> => {
      const { data, error } = await supabase
        .from("waste_log")
        .select(
          "id, ingredient_id, quantity, unit, reason, cost_cents, notes, logged_at, ingredients (name)",
        )
        .in("location_id", locationIds!)
        .gte("logged_at", fromIso)
        .lte("logged_at", toIso)
        .order("logged_at", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as WasteLogDbRow[]).map((row) => ({
        id: row.id,
        ingredientId: row.ingredient_id,
        ingredientName: row.ingredients?.name ?? "Unknown ingredient",
        quantity: Number(row.quantity),
        unit: row.unit,
        reason: row.reason as WasteReason,
        costCents: row.cost_cents,
        notes: row.notes,
        loggedAt: row.logged_at,
      }));
    },
  });
}

export type AddWasteEntryInput = {
  ingredientId: string;
  quantity: number;
  unit: string;
  reason: WasteReason;
  notes: string | null;
  loggedAt: string;
};

export function useAddWasteEntry() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddWasteEntryInput) => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const { data: ingredient, error: ingredientErr } = await supabase
        .from("ingredients")
        .select("unit, unit_cost_cents, container_size_ml, container_size_g")
        .eq("id", input.ingredientId)
        .single();
      if (ingredientErr) throw ingredientErr;

      let costCents: number | null = null;
      if (ingredient.unit_cost_cents != null) {
        const converted = convertQuantityToIngredientUnit(
          input.quantity,
          input.unit,
          ingredient.unit,
          ingredient.container_size_ml,
          ingredient.container_size_g,
        );
        if (converted != null) costCents = Math.round(converted * ingredient.unit_cost_cents);
      }

      const { error } = await supabase.from("waste_log").insert({
        restaurant_id: restaurantId,
        location_id: locationId,
        ingredient_id: input.ingredientId,
        quantity: input.quantity,
        unit: input.unit,
        reason: input.reason,
        cost_cents: costCents,
        notes: input.notes,
        logged_at: input.loggedAt,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["waste-log"] }),
  });
}

export function useDeleteWasteEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("waste_log").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["waste-log"] }),
  });
}

// ------------------------------------------------------------
// Inventory items — the shape inventory.tsx's UI expects: an
// ingredient joined with its current on-hand quantity (ingredient_stock),
// its par target (par_levels), and its preferred vendor's name.
// weeklyUsage and suggestedPar come from par_levels.avg_daily_usage /
// suggested_par_quantity, computed by the compute_par_levels() SQL
// function (see useRecomputeParLevels below) from real recipe_lines x
// pmix_sales — null until that's been run at least once for this
// ingredient (e.g. no recipe_lines mapped to it yet).
// ------------------------------------------------------------
export type InventoryItem = {
  id: string;
  name: string;
  category: string;
  unit: string;
  onHand: number;
  par: number;
  vendor: string;
  vendorId: string | null;
  cost: number;
  weeklyUsage: number;
  suggestedPar: number | null;
  lastOrdered: string;
  // How much volume (ml) or weight (g) is in one purchase unit — e.g.
  // 750 for a standard wine bottle bought "each," or 20000 for a case
  // of chicken. Only meaningful/set for count-purchased ingredients
  // also used in recipes by the oz/ml/L or lb/kg/oz; lets recipe lines
  // convert between the two. Exactly one of these two is ever set for
  // a given ingredient — Inventory's own form only lets you pick one
  // unit family at a time.
  containerSizeMl: number | null;
  containerSizeG: number | null;
};

function formatLastOrdered(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

export function useInventoryItems() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  return useQuery({
    queryKey: ["inventory-items", restaurantId, locationId],
    enabled: !!restaurantId && !!locationId,
    queryFn: async (): Promise<InventoryItem[]> => {
      const [ingredientsRes, stockRes, parRes, vendorsRes] = await Promise.all([
        supabase.from("ingredients").select("*").eq("restaurant_id", restaurantId!).order("name"),
        supabase.from("ingredient_stock").select("*").eq("location_id", locationId!),
        supabase.from("par_levels").select("*").eq("location_id", locationId!),
        supabase.from("vendors").select("id, name").eq("restaurant_id", restaurantId!),
      ]);
      if (ingredientsRes.error) throw ingredientsRes.error;
      if (stockRes.error) throw stockRes.error;
      if (parRes.error) throw parRes.error;
      if (vendorsRes.error) throw vendorsRes.error;

      const stockByIngredient = new Map((stockRes.data ?? []).map((r) => [r.ingredient_id, r]));
      const parByIngredient = new Map((parRes.data ?? []).map((r) => [r.ingredient_id, r]));
      const vendorNameById = new Map((vendorsRes.data ?? []).map((v) => [v.id, v.name as string]));

      return (ingredientsRes.data ?? []).map((ing) => {
        const stock = stockByIngredient.get(ing.id);
        const par = parByIngredient.get(ing.id);
        const avgDailyUsage = par?.avg_daily_usage != null ? Number(par.avg_daily_usage) : null;
        return {
          id: ing.id,
          name: ing.name,
          category: ing.category ?? "Miscellaneous",
          unit: ing.unit,
          onHand: stock?.on_hand_quantity != null ? Number(stock.on_hand_quantity) : 0,
          par: par?.par_quantity != null ? Number(par.par_quantity) : 1,
          vendor: ing.vendor_id ? (vendorNameById.get(ing.vendor_id) ?? "") : "",
          vendorId: ing.vendor_id,
          cost: (ing.unit_cost_cents ?? 0) / 100,
          weeklyUsage: avgDailyUsage != null ? Math.round(avgDailyUsage * 7) : 0,
          suggestedPar:
            par?.suggested_par_quantity != null ? Number(par.suggested_par_quantity) : null,
          lastOrdered: formatLastOrdered(stock?.last_ordered_at ?? null),
          containerSizeMl: ing.container_size_ml != null ? Number(ing.container_size_ml) : null,
          containerSizeG: ing.container_size_g != null ? Number(ing.container_size_g) : null,
        };
      });
    },
  });
}

export function useRecomputeParLevels() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const { error } = await supabase.rpc("compute_par_levels", {
        p_restaurant_id: restaurantId,
        p_location_id: locationId,
        p_window_days: 28,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inventory-items"] }),
  });
}

// Real weekly ingredient-usage trend — same theoretical-cost math as
// useFoodCostSummary (recipe cost-per-unit × units sold, from real
// pmix_sales x recipe_lines), just bucketed by week instead of summed
// over one window. Weeks with no matched recipe_lines/sales show as a
// real $0, not hidden — the point is honesty about what's actually
// been sold and costed, not a smoothed-looking trend line.
export type UsageTrendPoint = { week: string; usageCents: number };

export function useUsageTrend(weeks = 8) {
  const locationId = useCurrentLocationId();
  return useQuery({
    queryKey: ["usage-trend", locationId, weeks],
    enabled: !!locationId,
    queryFn: async (): Promise<UsageTrendPoint[]> => {
      const startOfWeek = (d: Date) => {
        const c = new Date(d);
        c.setHours(0, 0, 0, 0);
        const day = c.getDay();
        const diff = (day + 6) % 7; // days since Monday
        c.setDate(c.getDate() - diff);
        return c;
      };
      const now = new Date();
      const windowStart = startOfWeek(new Date(now.getTime() - (weeks - 1) * 7 * 86400000));

      const [salesRes, recipeRes] = await Promise.all([
        supabase
          .from("pmix_sales")
          .select("business_date, menu_item_pos_id, quantity_sold")
          .eq("location_id", locationId!)
          .gte("business_date", windowStart.toISOString().slice(0, 10)),
        supabase
          .from("recipe_lines")
          .select(
            "menu_item_pos_id, quantity, unit, ingredients(unit_cost_cents, unit, container_size_ml, container_size_g)",
          )
          .eq("location_id", locationId!),
      ]);
      if (salesRes.error) throw salesRes.error;
      if (recipeRes.error) throw recipeRes.error;

      type RecipeRow = {
        menu_item_pos_id: string;
        quantity: number;
        unit: string;
        ingredients: {
          unit_cost_cents: number | null;
          unit: string;
          container_size_ml: number | null;
          container_size_g: number | null;
        } | null;
      };
      const costPerUnit = new Map<string, number>();
      for (const row of (recipeRes.data ?? []) as unknown as RecipeRow[]) {
        const unitCost = row.ingredients?.unit_cost_cents;
        if (unitCost == null || !row.ingredients) continue;
        const converted = convertQuantityToIngredientUnit(
          Number(row.quantity),
          row.unit,
          row.ingredients.unit,
          row.ingredients.container_size_ml,
          row.ingredients.container_size_g,
        );
        if (converted == null) continue;
        const cur = costPerUnit.get(row.menu_item_pos_id) ?? 0;
        costPerUnit.set(row.menu_item_pos_id, cur + converted * unitCost);
      }

      const buckets = new Map<string, { usageCents: number; date: Date }>();
      for (let i = weeks - 1; i >= 0; i--) {
        const w = startOfWeek(new Date(now.getTime() - i * 7 * 86400000));
        buckets.set(w.toISOString().slice(0, 10), { usageCents: 0, date: w });
      }
      for (const row of salesRes.data ?? []) {
        const perUnit = costPerUnit.get(row.menu_item_pos_id);
        if (perUnit == null) continue;
        const w = startOfWeek(new Date(row.business_date));
        const key = w.toISOString().slice(0, 10);
        const bucket = buckets.get(key);
        if (!bucket) continue;
        bucket.usageCents += perUnit * Number(row.quantity_sold);
      }

      return Array.from(buckets.values()).map((b) => ({
        week: b.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        usageCents: Math.round(b.usageCents),
      }));
    },
  });
}

export type InventoryItemInput = {
  name: string;
  category: string;
  unit: string;
  onHand: number;
  par: number;
  vendorId: string | null;
  costCents: number | null;
  containerSizeMl?: number | null;
  containerSizeG?: number | null;
};

export function useCreateInventoryItem() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: InventoryItemInput) => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const { data: ingredient, error: ingErr } = await supabase
        .from("ingredients")
        .insert({
          restaurant_id: restaurantId,
          name: input.name,
          category: input.category,
          unit: input.unit,
          unit_cost_cents: input.costCents,
          vendor_id: input.vendorId,
          container_size_ml: input.containerSizeMl ?? null,
          container_size_g: input.containerSizeG ?? null,
        })
        .select("id")
        .single();
      if (ingErr) throw ingErr;

      const [stockRes, parRes] = await Promise.all([
        supabase.from("ingredient_stock").insert({
          restaurant_id: restaurantId,
          location_id: locationId,
          ingredient_id: ingredient.id,
          on_hand_quantity: input.onHand,
        }),
        supabase.from("par_levels").insert({
          restaurant_id: restaurantId,
          location_id: locationId,
          ingredient_id: ingredient.id,
          par_quantity: input.par,
        }),
      ]);
      if (stockRes.error) throw stockRes.error;
      if (parRes.error) throw parRes.error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inventory-items"] }),
  });
}

export type ExtractedInventoryItem = {
  name: string;
  category: string | null;
  unit: string | null;
  quantity: number | null;
  unitCost: number | null;
  vendorGuess: string | null;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // dataURL looks like "data:image/png;base64,AAAA..." — Claude's
      // API wants just the base64 payload, not the data: prefix.
      const result = reader.result as string;
      const commaIdx = result.indexOf(",");
      resolve(commaIdx === -1 ? result : result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.readAsDataURL(file);
  });
}

// Real Claude-drafted extraction from an uploaded photo or document
// (supplier price list, order guide, handwritten count sheet) — reads
// the image/PDF directly, no separate OCR step. Extraction only:
// nothing is written to the database until the owner reviews and
// commits via useBulkCreateInventoryItems below.
export function useExtractInventoryItems() {
  const restaurantId = useCurrentRestaurantId();
  return useMutation({
    mutationFn: async (input: {
      file: File;
      vendorNames: string[];
    }): Promise<ExtractedInventoryItem[]> => {
      if (!restaurantId) throw new Error("no current restaurant");
      const base64 = await fileToBase64(input.file);
      const { data, error } = await supabase.functions.invoke("inventory-bulk-import", {
        body: {
          restaurant_id: restaurantId,
          file_base64: base64,
          media_type: input.file.type,
          vendor_names: input.vendorNames,
        },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "extraction failed",
        );
      }
      return (data as { items: ExtractedInventoryItem[] }).items;
    },
  });
}

export type BulkCreateResult = {
  created: number;
  failed: { name: string; error: string }[];
};

// Reuses the exact same three-table insert shape as
// useCreateInventoryItem (ingredients + ingredient_stock + par_levels)
// per row, run concurrently with independent error handling — one bad
// or duplicate-name row (the `ingredients` unique(restaurant_id, name)
// constraint) is reported and skipped rather than failing the whole
// batch, since a bulk import is exactly the case where a few rows
// colliding with existing items is the expected common case.
export function useBulkCreateInventoryItems() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: InventoryItemInput[]): Promise<BulkCreateResult> => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");

      const results = await Promise.allSettled(
        rows.map(async (row) => {
          const { data: ingredient, error: ingErr } = await supabase
            .from("ingredients")
            .insert({
              restaurant_id: restaurantId,
              name: row.name,
              category: row.category,
              unit: row.unit,
              unit_cost_cents: row.costCents,
              vendor_id: row.vendorId,
            })
            .select("id")
            .single();
          if (ingErr) throw new Error(ingErr.message);

          const [stockRes, parRes] = await Promise.all([
            supabase.from("ingredient_stock").insert({
              restaurant_id: restaurantId,
              location_id: locationId,
              ingredient_id: ingredient.id,
              on_hand_quantity: row.onHand,
            }),
            supabase.from("par_levels").insert({
              restaurant_id: restaurantId,
              location_id: locationId,
              ingredient_id: ingredient.id,
              par_quantity: row.par,
            }),
          ]);
          if (stockRes.error) throw new Error(stockRes.error.message);
          if (parRes.error) throw new Error(parRes.error.message);
        }),
      );

      const failed: { name: string; error: string }[] = [];
      let created = 0;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") created++;
        else failed.push({ name: rows[i].name, error: r.reason?.message ?? String(r.reason) });
      });

      return { created, failed };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inventory-items"] }),
  });
}

// Edits an existing item's ingredient-level fields (name, category, unit,
// cost, vendor). On-hand and par already have their own real mutations
// (useUpdateOnHand/useUpdatePar, used by the inline steppers) — the Edit
// dialog calls those directly alongside this one rather than duplicating
// their upsert logic here.
export type InventoryItemFieldsInput = {
  name: string;
  category: string;
  unit: string;
  vendorId: string | null;
  costCents: number | null;
  containerSizeMl?: number | null;
  containerSizeG?: number | null;
};

export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: InventoryItemFieldsInput & { id: string }) => {
      const { error } = await supabase
        .from("ingredients")
        .update({
          name: input.name,
          category: input.category,
          unit: input.unit,
          unit_cost_cents: input.costCents,
          vendor_id: input.vendorId,
          container_size_ml: input.containerSizeMl ?? null,
          container_size_g: input.containerSizeG ?? null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inventory-items"] }),
  });
}

export function useDeleteInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Cascades to ingredient_stock/par_levels/recipe_lines via FK.
      const { error } = await supabase.from("ingredients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inventory-items"] }),
  });
}

export function useUpdateOnHand() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ingredientId, onHand }: { ingredientId: string; onHand: number }) => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const { error } = await supabase.from("ingredient_stock").upsert(
        {
          restaurant_id: restaurantId,
          location_id: locationId,
          ingredient_id: ingredientId,
          on_hand_quantity: onHand,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "location_id,ingredient_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inventory-items"] }),
  });
}

// ------------------------------------------------------------
// Inventory Counts — a dated, historical physical-count record with
// its own priced-out total value, separate from ingredient_stock's
// day-to-day running on-hand number. See db/phase2/65_inventory_counts.sql.
// ------------------------------------------------------------
export type InventoryCountSummary = {
  id: string;
  countedAt: string;
  totalValueCents: number;
  itemCount: number;
  notes: string | null;
};

export function useInventoryCounts() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["inventory-counts", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<InventoryCountSummary[]> => {
      const { data, error } = await supabase
        .from("inventory_counts")
        .select("id, counted_at, total_value_cents, item_count, notes")
        .eq("restaurant_id", restaurantId!)
        .order("counted_at", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        countedAt: row.counted_at,
        totalValueCents: row.total_value_cents,
        itemCount: row.item_count,
        notes: row.notes,
      }));
    },
  });
}

export type SaveInventoryCountLine = {
  ingredientId: string;
  // Exactly what was typed and which unit it was typed in — a keg
  // counted in oz, a case-purchased item counted directly in cases,
  // etc. — kept as-entered for the historical record, same convention
  // recipe_lines/waste_log already use.
  quantity: number;
  unit: string;
  // `quantity` converted to the ingredient's own priced unit (via
  // convertQuantityToIngredientUnit, computed by the caller — it
  // already has every ingredient's unit/container-size loaded). Null
  // when the entered unit can't convert to the ingredient's own unit
  // — the line still gets recorded, but contributes nothing to the
  // total value and its on-hand isn't synced, rather than silently
  // syncing a wrong number.
  nativeQuantity: number | null;
  // Passed straight from the count page's already-loaded ingredient
  // list rather than re-fetched — avoids a redundant round trip and a
  // race against a cost that could change between page load and save.
  unitCostCents: number | null;
};

export function useSaveInventoryCount() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lines,
      notes,
    }: {
      lines: SaveInventoryCountLine[];
      notes: string | null;
    }) => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const totalValueCents = lines.reduce(
        (sum, l) =>
          sum +
          (l.nativeQuantity != null && l.unitCostCents != null
            ? Math.round(l.nativeQuantity * l.unitCostCents)
            : 0),
        0,
      );
      const { data: countRow, error: countErr } = await supabase
        .from("inventory_counts")
        .insert({
          restaurant_id: restaurantId,
          location_id: locationId,
          total_value_cents: totalValueCents,
          item_count: lines.length,
          notes,
        })
        .select("id")
        .single();
      if (countErr) throw countErr;

      const { error: linesErr } = await supabase.from("inventory_count_lines").insert(
        lines.map((l) => ({
          restaurant_id: restaurantId,
          inventory_count_id: countRow.id,
          ingredient_id: l.ingredientId,
          quantity: l.quantity,
          unit: l.unit,
          unit_cost_cents: l.unitCostCents,
          value_cents:
            l.nativeQuantity != null && l.unitCostCents != null
              ? Math.round(l.nativeQuantity * l.unitCostCents)
              : null,
        })),
      );
      if (linesErr) throw linesErr;

      // A real physical count is the most authoritative on-hand number
      // available — becomes the new baseline for par-level/reorder math
      // too, not just its own historical record. Only for lines that
      // actually converted to the ingredient's own unit — never write
      // a number that isn't really in that unit.
      const convertible = lines.filter((l) => l.nativeQuantity != null);
      const { error: stockErr } =
        convertible.length === 0
          ? { error: null }
          : await supabase.from("ingredient_stock").upsert(
              convertible.map((l) => ({
                restaurant_id: restaurantId,
                location_id: locationId,
                ingredient_id: l.ingredientId,
                on_hand_quantity: l.nativeQuantity,
                updated_at: new Date().toISOString(),
              })),
              { onConflict: "location_id,ingredient_id" },
            );
      if (stockErr) throw stockErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-counts"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    },
  });
}

// Marks ingredients as just-ordered (PO dispatched) — separate from
// on-hand count, which only changes when stock is actually counted or
// a delivery is received.
export function useMarkOrdered() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ingredientIds: string[]) => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const now = new Date().toISOString();
      const { error } = await supabase.from("ingredient_stock").upsert(
        ingredientIds.map((ingredientId) => ({
          restaurant_id: restaurantId,
          location_id: locationId,
          ingredient_id: ingredientId,
          last_ordered_at: now,
          updated_at: now,
        })),
        { onConflict: "location_id,ingredient_id", ignoreDuplicates: false },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inventory-items"] }),
  });
}

// Assigns one vendor to many ingredients at once — a single query
// rather than looping individual updates, since the whole point is
// bulk-editing items that were created without a vendor set (or need
// a vendor corrected) without clicking through each one.
export function useBulkAssignVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ingredientIds,
      vendorId,
    }: {
      ingredientIds: string[];
      vendorId: string;
    }) => {
      const { error } = await supabase
        .from("ingredients")
        .update({ vendor_id: vendorId })
        .in("id", ingredientIds);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inventory-items"] }),
  });
}

// Real purchase orders — replaces the old "AI agent dispatched N
// purchase orders to vendors" toast, which never created any actual
// record, only bumped ingredient_stock.last_ordered_at. Creating a PO
// now also attempts a real email to the vendor (send-purchase-order-email
// Edge Function, via Gmail) right after the record is written — each
// vendor's outcome (sent / no email on file / send failed) comes back
// so the UI can report exactly what happened instead of assuming success.
export type PurchaseOrderVendorGroup = {
  vendorId: string;
  lines: { ingredientId: string; quantity: number; unit: string; unitCostCents: number | null }[];
};

export type PurchaseOrderCreateResult = {
  poId: string;
  vendorId: string;
  vendorName: string;
  emailStatus: "sent" | "no_email" | "failed";
  emailError?: string;
};

export function useCreatePurchaseOrders() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      groups: PurchaseOrderVendorGroup[],
    ): Promise<PurchaseOrderCreateResult[]> => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");

      const vendorIds = groups.map((g) => g.vendorId);
      const { data: vendorRows, error: vendorErr } = await supabase
        .from("vendors")
        .select("id, name, contact_email")
        .in("id", vendorIds);
      if (vendorErr) throw vendorErr;
      const vendorById = new Map((vendorRows ?? []).map((v) => [v.id, v]));

      return Promise.all(
        groups.map(async (group) => {
          const vendor = vendorById.get(group.vendorId);
          const totalCents = group.lines.reduce(
            (sum, l) => sum + (l.unitCostCents ?? 0) * l.quantity,
            0,
          );
          const { data: po, error: poErr } = await supabase
            .from("purchase_orders")
            .insert({
              restaurant_id: restaurantId,
              location_id: locationId,
              vendor_id: group.vendorId,
              total_cents: Math.round(totalCents),
            })
            .select("id")
            .single();
          if (poErr) throw poErr;

          const { error: linesErr } = await supabase.from("purchase_order_lines").insert(
            group.lines.map((l) => ({
              restaurant_id: restaurantId,
              purchase_order_id: po.id,
              ingredient_id: l.ingredientId,
              quantity: l.quantity,
              unit: l.unit,
              unit_cost_cents: l.unitCostCents,
            })),
          );
          if (linesErr) throw linesErr;

          const vendorName = vendor?.name ?? "Unknown vendor";
          if (!vendor?.contact_email) {
            return {
              poId: po.id as string,
              vendorId: group.vendorId,
              vendorName,
              emailStatus: "no_email" as const,
            };
          }

          const { data: sendRes, error: sendErr } = await supabase.functions.invoke(
            "send-purchase-order-email",
            { body: { purchase_order_id: po.id } },
          );
          if (sendErr || !(sendRes as { ok?: boolean } | null)?.ok) {
            const emailError =
              (sendRes as { error?: string } | null)?.error ?? sendErr?.message ?? "unknown error";
            return {
              poId: po.id as string,
              vendorId: group.vendorId,
              vendorName,
              emailStatus: "failed" as const,
              emailError,
            };
          }

          return {
            poId: po.id as string,
            vendorId: group.vendorId,
            vendorName,
            emailStatus: "sent" as const,
          };
        }),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
    },
  });
}

export function useSendPurchaseOrderEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (purchaseOrderId: string) => {
      const { data, error } = await supabase.functions.invoke("send-purchase-order-email", {
        body: { purchase_order_id: purchaseOrderId },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "send failed",
        );
      }
      return data;
    },
    // onSettled, not onSuccess — the Edge Function writes email_error to
    // the PO row even when the send fails, so a failed attempt still
    // needs the cache invalidated or the "Failed" badge never shows up
    // without an unrelated refetch happening to fire first.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export type PurchaseOrderSummary = {
  id: string;
  vendorName: string;
  vendorEmail: string | null;
  status: string;
  totalCents: number | null;
  createdAt: string;
  lineCount: number;
  emailedAt: string | null;
  emailError: string | null;
};

export function usePurchaseOrders() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["purchase-orders", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<PurchaseOrderSummary[]> => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select(
          "id, status, total_cents, created_at, emailed_at, email_error, vendors(name, contact_email), purchase_order_lines(id)",
        )
        .eq("restaurant_id", restaurantId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      type Row = {
        id: string;
        status: string;
        total_cents: number | null;
        created_at: string;
        emailed_at: string | null;
        email_error: string | null;
        vendors: { name: string; contact_email: string | null } | null;
        purchase_order_lines: { id: string }[] | null;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        vendorName: r.vendors?.name ?? "Unknown vendor",
        vendorEmail: r.vendors?.contact_email ?? null,
        status: r.status,
        totalCents: r.total_cents,
        createdAt: r.created_at,
        lineCount: r.purchase_order_lines?.length ?? 0,
        emailedAt: r.emailed_at,
        emailError: r.email_error,
      }));
    },
  });
}

export function useUpdatePar() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ingredientId, par }: { ingredientId: string; par: number }) => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const { error } = await supabase.from("par_levels").upsert(
        {
          restaurant_id: restaurantId,
          location_id: locationId,
          ingredient_id: ingredientId,
          par_quantity: par,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "location_id,ingredient_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inventory-items"] }),
  });
}

// ------------------------------------------------------------
// Recipe bridge — maps a menu item to the ingredients it consumes.
// This is what turns "sold 40 burgers" (real Toast sales) into
// "used 40 buns, 13.3 lbs ground beef" — required for both real
// food cost % and real par-level usage, neither of which exist yet
// (see pos/queries.ts's useProductMix: cost falls back to a manual
// override until an item has recipe lines).
// ------------------------------------------------------------
// A line is either a raw ingredient OR a prep recipe (e.g. a house
// sauce used across dishes) — never both, matching the DB check
// constraint. Exactly one of the ingredient*/prepRecipe* groups below
// is non-null on any given line.
export type RecipeLine = {
  id: string;
  ingredientId: string | null;
  ingredientName: string | null;
  ingredientUnit: string | null;
  ingredientCostCents: number | null;
  ingredientContainerSizeMl: number | null;
  ingredientContainerSizeG: number | null;
  prepRecipeId: string | null;
  prepRecipeName: string | null;
  prepRecipeCostPerYieldUnitCents: number | null;
  quantity: number;
  unit: string;
};

// A menu item that sells at more than one real price (Bottle/Pint/
// Pitcher, well-liquor Single/Double, a Happy Hour variant...) gets
// one row per distinct size actually observed in Toast sales — see
// db/phase2/63_menu_item_price_tiers.sql. Most items have none of
// these at all, in which case the item just keeps its one plain
// recipe like before (priceTierId null throughout).
export type MenuItemPriceTier = {
  id: string;
  tierName: string;
  lastPriceCents: number | null;
};

export function useMenuItemPriceTiers(menuItemPosId: string | undefined) {
  const locationId = useCurrentLocationId();
  return useQuery({
    queryKey: ["menu-item-price-tiers", locationId, menuItemPosId],
    enabled: !!locationId && !!menuItemPosId,
    queryFn: async (): Promise<MenuItemPriceTier[]> => {
      const { data, error } = await supabase
        .from("menu_item_price_tiers")
        .select("id, tier_name, last_price_cents")
        .eq("location_id", locationId!)
        .eq("menu_item_pos_id", menuItemPosId!)
        .order("tier_name");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        tierName: r.tier_name,
        lastPriceCents: r.last_price_cents,
      }));
    },
  });
}

// priceTierId: null (the default) means "the" recipe for this item —
// exactly today's behavior, matching every existing real recipe_lines
// row. Pass a real tier id to read/write that specific size's own
// recipe instead.
export function useRecipeLinesForItem(
  menuItemPosId: string | undefined,
  priceTierId: string | null = null,
) {
  const locationId = useCurrentLocationId();
  const { data: locationIds } = useLocationIds();
  return useQuery({
    queryKey: ["recipe-lines", locationId, menuItemPosId, priceTierId],
    enabled: !!locationId && !!menuItemPosId,
    queryFn: async (): Promise<RecipeLine[]> => {
      let linesQuery = supabase
        .from("recipe_lines")
        .select(
          "id, quantity, unit, ingredient_id, prep_recipe_id, ingredients (id, name, unit, unit_cost_cents, container_size_ml, container_size_g), prep_recipes (id, name)",
        )
        .eq("location_id", locationId!)
        .eq("menu_item_pos_id", menuItemPosId!);
      linesQuery = priceTierId
        ? linesQuery.eq("price_tier_id", priceTierId)
        : linesQuery.is("price_tier_id", null);
      const [linesRes, ctx] = await Promise.all([
        linesQuery,
        fetchRecipeCostContext(locationIds ?? []),
      ]);
      if (linesRes.error) throw linesRes.error;
      return (linesRes.data ?? []).map((row: any) => ({
        id: row.id,
        ingredientId: row.ingredient_id,
        ingredientName: row.ingredients?.name ?? null,
        ingredientUnit: row.ingredients?.unit ?? null,
        ingredientCostCents: row.ingredients?.unit_cost_cents ?? null,
        ingredientContainerSizeMl: row.ingredients?.container_size_ml ?? null,
        ingredientContainerSizeG: row.ingredients?.container_size_g ?? null,
        prepRecipeId: row.prep_recipe_id,
        prepRecipeName: row.prep_recipes?.name ?? null,
        prepRecipeCostPerYieldUnitCents: row.prep_recipe_id
          ? resolvePrepRecipeCostPerYieldUnit(
              row.prep_recipe_id,
              ctx.prepRecipeLinesByPrepId,
              ctx.prepRecipeYieldById,
              ctx.ingredientById,
            )
          : null,
        quantity: Number(row.quantity),
        unit: row.unit,
      }));
    },
  });
}

export function useAddRecipeLine() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: {
        menuItemPosId: string;
        quantity: number;
        unit: string;
        priceTierId?: string | null;
      } & (
        | { ingredientId: string; prepRecipeId?: never }
        | { prepRecipeId: string; ingredientId?: never }
      ),
    ) => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const { error } = await supabase.from("recipe_lines").insert({
        restaurant_id: restaurantId,
        location_id: locationId,
        menu_item_pos_id: input.menuItemPosId,
        ingredient_id: input.ingredientId ?? null,
        prep_recipe_id: input.prepRecipeId ?? null,
        quantity: input.quantity,
        unit: input.unit,
        price_tier_id: input.priceTierId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-lines"] });
      queryClient.invalidateQueries({ queryKey: ["product-mix"] });
      queryClient.invalidateQueries({ queryKey: ["food-cost-summary"] });
    },
  });
}

// A draft only — nothing here is ever written to the database by this
// hook. Every line is reviewed and, if kept, committed individually via
// the normal useAddRecipeLine/useAddPrepRecipeLine mutations, exactly
// as if it had been typed in by hand.
export type GeneratedRecipeLine = {
  kind: "ingredient" | "prep_recipe" | "new_ingredient" | "new_prep_recipe";
  ingredientId: string | null;
  prepRecipeId: string | null;
  quantity: number | null;
  unit: string;
  proposedName: string | null;
  proposedSubIngredients: { name: string; quantity: number; unit: string }[] | null;
  confidence: "high" | "medium" | "low";
  notes: string | null;
};
export type GeneratedRecipe = { menuItemPosId: string; lines: GeneratedRecipeLine[] };

export function useGenerateRecipe() {
  const restaurantId = useCurrentRestaurantId();
  return useMutation({
    mutationFn: async (menuItemPosIds: string[]): Promise<GeneratedRecipe[]> => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase.functions.invoke("generate-recipe", {
        body: { restaurant_id: restaurantId, menu_item_pos_ids: menuItemPosIds },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ??
            error?.message ??
            "recipe generation failed",
        );
      }
      return (data as { recipes: GeneratedRecipe[] }).recipes;
    },
  });
}

// ---------- Bulk recipe import from Word/PDF ----------
// Mirrors useUploadInvoice/useEnqueueOcr/useCheckOcr exactly — same
// upload-then-enqueue-then-poll shape, just against the recipe-doc-
// uploads bucket / recipe_imports table / recipe-doc-import function
// instead of their invoice equivalents. `lines` on each draft recipe
// reuses GeneratedRecipeLine — same shape the AI generator's own
// review UI (GeneratedRecipeReview) already renders, so importing a
// doc needs zero new line-review code, only a "which real menu item
// (or new prep recipe) is this?" step in front of it.
export type RecipeImportDraft = {
  proposedName: string;
  targetKind: "menu_item" | "prep_recipe";
  matchedMenuItemPosId: string | null;
  matchConfidence: "high" | "medium" | "low" | "none";
  lines: GeneratedRecipeLine[];
};
export type RecipeImportCheckResult = {
  status: "pending" | "processing" | "ready" | "failed";
  result?: { recipes: RecipeImportDraft[] } | null;
  error?: string | null;
};

export function useUploadRecipeDoc() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const path = `${restaurantId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("recipe-doc-uploads")
        .upload(path, file);
      if (uploadErr) throw uploadErr;

      const { data, error: insertErr } = await supabase
        .from("recipe_imports")
        .insert({
          restaurant_id: restaurantId,
          location_id: locationId,
          file_name: file.name,
          source_file_url: path,
          status: "pending",
        })
        .select("id")
        .single();
      if (insertErr) throw insertErr;
      return data.id as string;
    },
  });
}

export function useEnqueueRecipeImport() {
  return useMutation({
    mutationFn: async (recipeImportId: string) => {
      const { data, error } = await supabase.functions.invoke("recipe-doc-import", {
        body: { recipe_import_id: recipeImportId, action: "enqueue" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "enqueue failed");
      return data;
    },
  });
}

export function useCheckRecipeImport() {
  return useMutation({
    mutationFn: async (recipeImportId: string): Promise<RecipeImportCheckResult> => {
      const { data, error } = await supabase.functions.invoke("recipe-doc-import", {
        body: { recipe_import_id: recipeImportId, action: "check" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "check failed");
      return data as RecipeImportCheckResult;
    },
  });
}

export function useDeleteRecipeLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recipe_lines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipe-lines"] });
      queryClient.invalidateQueries({ queryKey: ["product-mix"] });
      queryClient.invalidateQueries({ queryKey: ["food-cost-summary"] });
    },
  });
}

// ------------------------------------------------------------
// Prep recipes — a recipe that isn't sold directly on the POS (e.g. a
// house sauce), used as an ingredient-like component inside a menu
// item's recipe OR inside another prep recipe. Cost rolls up
// recursively via src/lib/boh/recipeCost.ts; cycles (a prep recipe
// transitively containing itself) are rejected client-side before any
// write, since the DB can't cleanly express "no transitive cycle."
// ------------------------------------------------------------
export type PrepRecipe = {
  id: string;
  name: string;
  yieldQty: number;
  yieldUnit: string;
  costPerYieldUnitCents: number | null;
  // What actually uses this prep recipe right now — a dish's own name
  // (via recipe_lines) and/or another prep recipe's name (as a
  // sub-recipe). Empty on both means it's created but not attached to
  // anything real yet, which otherwise looks identical to one that's
  // genuinely rolled into a dish's cost.
  usedByMenuItemNames: string[];
  usedByPrepRecipeNames: string[];
};

export function usePrepRecipes() {
  const { data: locationIds } = useLocationIds();
  return useQuery({
    queryKey: ["prep-recipes", locationIds],
    enabled: !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<PrepRecipe[]> => {
      const [prepRecipesRes, menuItemsRes, ctx] = await Promise.all([
        supabase
          .from("prep_recipes")
          .select("id, name, yield_qty, yield_unit")
          .in("location_id", locationIds!)
          .order("name"),
        supabase.from("menu_items").select("pos_id, name").in("location_id", locationIds!),
        fetchRecipeCostContext(locationIds!),
      ]);
      if (prepRecipesRes.error) throw prepRecipesRes.error;
      if (menuItemsRes.error) throw menuItemsRes.error;

      const menuItemNameById = new Map((menuItemsRes.data ?? []).map((m) => [m.pos_id, m.name]));
      const prepRecipeNameById = new Map((prepRecipesRes.data ?? []).map((p) => [p.id, p.name]));

      return (prepRecipesRes.data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        yieldQty: Number(r.yield_qty),
        yieldUnit: r.yield_unit,
        costPerYieldUnitCents: resolvePrepRecipeCostPerYieldUnit(
          r.id,
          ctx.prepRecipeLinesByPrepId,
          ctx.prepRecipeYieldById,
          ctx.ingredientById,
        ),
        usedByMenuItemNames: Array.from(ctx.menuItemsUsingPrepRecipe.get(r.id) ?? [])
          .map((posId) => menuItemNameById.get(posId))
          .filter((name): name is string => !!name)
          .sort(),
        usedByPrepRecipeNames: Array.from(ctx.prepRecipesUsingPrepRecipe.get(r.id) ?? [])
          .map((prepId) => prepRecipeNameById.get(prepId))
          .filter((name): name is string => !!name)
          .sort(),
      }));
    },
  });
}

export type PrepRecipeInput = { name: string; yieldQty: number; yieldUnit: string };

export function useCreatePrepRecipe() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PrepRecipeInput): Promise<string> => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const { data, error } = await supabase
        .from("prep_recipes")
        .insert({
          restaurant_id: restaurantId,
          location_id: locationId,
          name: input.name,
          yield_qty: input.yieldQty,
          yield_unit: input.yieldUnit,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["prep-recipes"] }),
  });
}

export function useUpdatePrepRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: PrepRecipeInput & { id: string }) => {
      const { error } = await supabase
        .from("prep_recipes")
        .update({
          name: input.name,
          yield_qty: input.yieldQty,
          yield_unit: input.yieldUnit,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["prep-recipes"] });
      queryClient.invalidateQueries({ queryKey: ["prep-recipe-lines", id] });
      queryClient.invalidateQueries({ queryKey: ["product-mix"] });
      queryClient.invalidateQueries({ queryKey: ["food-cost-summary"] });
    },
  });
}

export function useDeletePrepRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // FK is ON DELETE RESTRICT on both recipe_lines.prep_recipe_id
      // and prep_recipe_lines.sub_prep_recipe_id — Postgres rejects
      // this outright if the recipe is still used anywhere, rather
      // than silently orphaning whatever referenced it.
      const { error } = await supabase.from("prep_recipes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["prep-recipes"] }),
  });
}

export type PrepRecipeLine = {
  id: string;
  ingredientId: string | null;
  ingredientName: string | null;
  ingredientUnit: string | null;
  ingredientCostCents: number | null;
  ingredientContainerSizeMl: number | null;
  ingredientContainerSizeG: number | null;
  subPrepRecipeId: string | null;
  subPrepRecipeName: string | null;
  subPrepRecipeCostPerYieldUnitCents: number | null;
  quantity: number;
  unit: string;
};

export function usePrepRecipeLinesFor(prepRecipeId: string | undefined) {
  const { data: locationIds } = useLocationIds();
  return useQuery({
    queryKey: ["prep-recipe-lines", prepRecipeId],
    enabled: !!prepRecipeId && !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<PrepRecipeLine[]> => {
      const [linesRes, ctx] = await Promise.all([
        supabase
          .from("prep_recipe_lines")
          .select(
            "id, quantity, unit, ingredient_id, sub_prep_recipe_id, ingredients (name, unit, unit_cost_cents, container_size_ml, container_size_g), sub_recipe:prep_recipes!sub_prep_recipe_id (id, name)",
          )
          .eq("prep_recipe_id", prepRecipeId!),
        fetchRecipeCostContext(locationIds!),
      ]);
      if (linesRes.error) throw linesRes.error;
      return (linesRes.data ?? []).map((row: any) => ({
        id: row.id,
        ingredientId: row.ingredient_id,
        ingredientName: row.ingredients?.name ?? null,
        ingredientUnit: row.ingredients?.unit ?? null,
        ingredientCostCents: row.ingredients?.unit_cost_cents ?? null,
        ingredientContainerSizeMl: row.ingredients?.container_size_ml ?? null,
        ingredientContainerSizeG: row.ingredients?.container_size_g ?? null,
        subPrepRecipeId: row.sub_prep_recipe_id,
        subPrepRecipeName: row.sub_recipe?.name ?? null,
        subPrepRecipeCostPerYieldUnitCents: row.sub_prep_recipe_id
          ? resolvePrepRecipeCostPerYieldUnit(
              row.sub_prep_recipe_id,
              ctx.prepRecipeLinesByPrepId,
              ctx.prepRecipeYieldById,
              ctx.ingredientById,
            )
          : null,
        quantity: Number(row.quantity),
        unit: row.unit,
      }));
    },
  });
}

export function useAddPrepRecipeLine() {
  const restaurantId = useCurrentRestaurantId();
  const { data: locationIds } = useLocationIds();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: {
        prepRecipeId: string;
        quantity: number;
        unit: string;
      } & (
        | { ingredientId: string; subPrepRecipeId?: never }
        | { subPrepRecipeId: string; ingredientId?: never }
      ),
    ) => {
      if (!restaurantId) throw new Error("no current restaurant");
      if (input.subPrepRecipeId) {
        if (!locationIds || locationIds.length === 0) throw new Error("no current location");
        const ctx = await fetchRecipeCostContext(locationIds);
        if (
          wouldCreateCycle(input.prepRecipeId, input.subPrepRecipeId, ctx.prepRecipeLinesByPrepId)
        ) {
          throw new Error(
            "That would create a circular recipe — a prep recipe can't contain itself, even indirectly.",
          );
        }
      }
      const { error } = await supabase.from("prep_recipe_lines").insert({
        restaurant_id: restaurantId,
        prep_recipe_id: input.prepRecipeId,
        ingredient_id: input.ingredientId ?? null,
        sub_prep_recipe_id: input.subPrepRecipeId ?? null,
        quantity: input.quantity,
        unit: input.unit,
      });
      if (error) throw error;
    },
    onSuccess: (_data, { prepRecipeId }) => {
      queryClient.invalidateQueries({ queryKey: ["prep-recipe-lines", prepRecipeId] });
      queryClient.invalidateQueries({ queryKey: ["prep-recipes"] });
      queryClient.invalidateQueries({ queryKey: ["recipe-lines"] });
      queryClient.invalidateQueries({ queryKey: ["product-mix"] });
      queryClient.invalidateQueries({ queryKey: ["food-cost-summary"] });
    },
  });
}

export function useDeletePrepRecipeLine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("prep_recipe_lines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prep-recipe-lines"] });
      queryClient.invalidateQueries({ queryKey: ["prep-recipes"] });
      queryClient.invalidateQueries({ queryKey: ["recipe-lines"] });
      queryClient.invalidateQueries({ queryKey: ["product-mix"] });
      queryClient.invalidateQueries({ queryKey: ["food-cost-summary"] });
    },
  });
}

// =====================================================
// Invoice OCR — upload a vendor invoice PDF, run it through
// Mindee (via the invoice-ocr Edge Function → Railway service),
// and review/approve the extracted line items.
// =====================================================

export type RealInvoice = {
  id: string;
  vendorId: string | null;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalCents: number | null;
  // Entered by the reviewer at approve time (e.g. the "TOTAL
  // DISCOUNTS"/"Discount$" figure vendors print on the invoice) — not
  // OCR-extracted, since the Mindee model wasn't trained on this field.
  discountCents: number | null;
  status: "pending_review" | "approved";
  ocrStatus: string | null;
  sourceFileUrl: string | null;
  createdAt: string;
  // Set when this invoice arrived via email ingestion (no vendor was
  // known at creation time) — surfaced so a reviewer has something to
  // go on when picking the vendor, instead of guessing blind.
  sourceEmailFrom: string | null;
  sourceEmailSubject: string | null;
  // Issues on an otherwise-real invoice (unknown_sender,
  // sender_auth_failed, not_an_invoice, totals_mismatch,
  // low_confidence, duplicate) — can co-occur, hence an array.
  flags: string[];
  // What kind of document this is; a credit memo or statement is
  // never a normal invoice regardless of anything else, so this is a
  // separate axis from `flags`, not folded into it.
  documentType: string | null;
};

export function useRealInvoices() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["real-invoices", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<RealInvoice[]> => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id, vendor_id, invoice_number, invoice_date, total_cents, discount_cents, status, ocr_status, source_file_url, created_at, source_email_from, source_email_subject, flags, document_type, vendors(name)",
        )
        .eq("restaurant_id", restaurantId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      type Row = {
        id: string;
        vendor_id: string | null;
        invoice_number: string | null;
        invoice_date: string | null;
        total_cents: number | null;
        discount_cents: number | null;
        status: "pending_review" | "approved";
        ocr_status: string | null;
        source_file_url: string | null;
        created_at: string;
        source_email_from: string | null;
        source_email_subject: string | null;
        flags: string[] | null;
        document_type: string | null;
        vendors: { name: string } | null;
      };
      return ((data ?? []) as unknown as Row[]).map((row) => ({
        id: row.id,
        vendorId: row.vendor_id,
        vendorName: row.vendors?.name ?? null,
        invoiceNumber: row.invoice_number,
        invoiceDate: row.invoice_date,
        totalCents: row.total_cents,
        discountCents: row.discount_cents,
        status: row.status,
        ocrStatus: row.ocr_status,
        sourceFileUrl: row.source_file_url,
        createdAt: row.created_at,
        sourceEmailFrom: row.source_email_from,
        sourceEmailSubject: row.source_email_subject,
        flags: row.flags ?? [],
        documentType: row.document_type,
      }));
    },
  });
}

export function useDeleteInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, sourceFileUrl }: { id: string; sourceFileUrl: string | null }) => {
      // invoice_lines cascades via FK; an email-ingested invoice's
      // processed_email_messages row goes to invoice_id = null (same
      // FK behavior as every other "processed, no invoice" row) rather
      // than being deleted itself — so the cron can't re-ingest the
      // same email and recreate this invoice right after deleting it.
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;

      if (sourceFileUrl) {
        // Best-effort — a storage cleanup failure shouldn't block the
        // real deletion the user asked for, which already succeeded.
        await supabase.storage.from("invoice-uploads").remove([sourceFileUrl]);
      }
    },
    onSuccess: () => {
      // A deleted invoice's approved spend/discount was already baked
      // into every one of these aggregates — all need a refetch, not
      // just the raw list.
      queryClient.invalidateQueries({ queryKey: ["real-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-spend-summary"] });
      queryClient.invalidateQueries({ queryKey: ["savings-summary"] });
      queryClient.invalidateQueries({ queryKey: ["top-line-items"] });
      queryClient.invalidateQueries({ queryKey: ["category-spend"] });
    },
  });
}

// Same real deletion as useDeleteInvoice, just batched — one
// .in("id", ids) delete for the rows plus one storage .remove() call
// for every uploaded file, instead of N round trips for a multi-select
// delete.
export function useDeleteInvoices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoices: { id: string; sourceFileUrl: string | null }[]) => {
      if (invoices.length === 0) return;
      const { error } = await supabase
        .from("invoices")
        .delete()
        .in(
          "id",
          invoices.map((i) => i.id),
        );
      if (error) throw error;

      const sourceFileUrls = invoices
        .map((i) => i.sourceFileUrl)
        .filter((url): url is string => !!url);
      if (sourceFileUrls.length > 0) {
        // Best-effort — a storage cleanup failure shouldn't block the
        // real deletion the user asked for, which already succeeded.
        await supabase.storage.from("invoice-uploads").remove(sourceFileUrls);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["real-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-spend-summary"] });
      queryClient.invalidateQueries({ queryKey: ["savings-summary"] });
      queryClient.invalidateQueries({ queryKey: ["top-line-items"] });
      queryClient.invalidateQueries({ queryKey: ["category-spend"] });
    },
  });
}

export function useSetInvoiceVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, vendorId }: { invoiceId: string; vendorId: string }) => {
      const { error } = await supabase
        .from("invoices")
        .update({ vendor_id: vendorId })
        .eq("id", invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["real-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-spend-summary"] });
      queryClient.invalidateQueries({ queryKey: ["savings-summary"] });
      queryClient.invalidateQueries({ queryKey: ["top-line-items"] });
      queryClient.invalidateQueries({ queryKey: ["category-spend"] });
    },
  });
}

// One-click action from the Unknown sender queue: assigns the vendor
// AND remembers this sender for next time, both in one mutation.
// Always appends the exact sender address (never a domain), so this
// path can never violate the free-email-provider rule the manual
// vendor-edit path enforces — there's no extra guard needed here.
export function usePromoteSenderAndAssignVendor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      invoiceId,
      vendorId,
      currentFlags,
      senderEmail,
    }: {
      invoiceId: string;
      vendorId: string;
      currentFlags: string[];
      senderEmail: string | null;
    }) => {
      // Both sender-trust flags are resolved by this action — a human
      // just explicitly vouched for this sender on this vendor.
      const nextFlags = currentFlags.filter(
        (f) => f !== "unknown_sender" && f !== "sender_auth_failed",
      );
      const { error: invoiceError } = await supabase
        .from("invoices")
        .update({ vendor_id: vendorId, flags: nextFlags })
        .eq("id", invoiceId);
      if (invoiceError) throw invoiceError;

      if (senderEmail) {
        const { data: vendor, error: vendorReadError } = await supabase
          .from("vendors")
          .select("invoicing_sender_emails")
          .eq("id", vendorId)
          .single();
        if (vendorReadError) throw vendorReadError;
        const existing: string[] = vendor?.invoicing_sender_emails ?? [];
        const normalized = senderEmail.trim().toLowerCase();
        if (!existing.some((e) => e.toLowerCase() === normalized)) {
          const { error: vendorWriteError } = await supabase
            .from("vendors")
            .update({ invoicing_sender_emails: [...existing, normalized] })
            .eq("id", vendorId);
          if (vendorWriteError) throw vendorWriteError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["real-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["vendors"] });
    },
  });
}

export function useSetInvoiceDiscount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      invoiceId,
      discountCents,
    }: {
      invoiceId: string;
      discountCents: number | null;
    }) => {
      const { error } = await supabase
        .from("invoices")
        .update({ discount_cents: discountCents })
        .eq("id", invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["real-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["savings-summary"] });
    },
  });
}

// Shared date-range filter for the Invoices dashboard — applied
// client-side against invoice_date (falling back to created_at when an
// email-ingested invoice has no confirmed date yet), consistent with
// how every other date-based calc on this page already works. `from`/
// `to` are inclusive "YYYY-MM-DD" strings; either or both may be null
// for an open-ended range, and {from: null, to: null} means no filter.
export type DateRange = { from: string | null; to: string | null };

export function dateInRange(dateStr: string | null | undefined, range: DateRange): boolean {
  if (!range.from && !range.to) return true;
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

// Real per-vendor spend, computed from approved invoices only (spend
// that's actually been confirmed, not just drafted). No on-time
// delivery % or price-accuracy score — those aren't tracked anywhere
// in the schema, so they're not surfaced rather than being faked.
export type VendorSpendSummary = {
  vendorId: string;
  name: string;
  terms: string;
  contactName: string;
  email: string;
  phone: string;
  category: VendorCategory;
  approvedSpendCents: number;
  approvedInvoiceCount: number;
  pendingInvoiceCount: number;
};

export function useVendorSpendSummary(dateRange?: DateRange) {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["vendor-spend-summary", restaurantId, dateRange?.from, dateRange?.to],
    enabled: !!restaurantId,
    queryFn: async (): Promise<VendorSpendSummary[]> => {
      const [vendorsRes, invoicesRes] = await Promise.all([
        supabase.from("vendors").select("*").eq("restaurant_id", restaurantId!).order("name"),
        supabase
          .from("invoices")
          .select("vendor_id, status, total_cents, invoice_date, created_at")
          .eq("restaurant_id", restaurantId!),
      ]);
      if (vendorsRes.error) throw vendorsRes.error;
      if (invoicesRes.error) throw invoicesRes.error;

      const byVendor = new Map<
        string,
        { approvedCents: number; approvedCount: number; pendingCount: number }
      >();
      for (const inv of invoicesRes.data ?? []) {
        if (!inv.vendor_id) continue;
        if (dateRange && !dateInRange(inv.invoice_date ?? inv.created_at, dateRange)) continue;
        const cur = byVendor.get(inv.vendor_id) ?? {
          approvedCents: 0,
          approvedCount: 0,
          pendingCount: 0,
        };
        if (inv.status === "approved") {
          cur.approvedCents += inv.total_cents ?? 0;
          cur.approvedCount += 1;
        } else {
          cur.pendingCount += 1;
        }
        byVendor.set(inv.vendor_id, cur);
      }

      return (vendorsRes.data ?? []).map((v) => {
        const stats = byVendor.get(v.id) ?? { approvedCents: 0, approvedCount: 0, pendingCount: 0 };
        return {
          vendorId: v.id,
          name: v.name,
          terms: v.payment_terms ?? "",
          contactName: v.contact_name ?? "",
          email: v.contact_email ?? "",
          phone: v.phone ?? "",
          category: (v.category as VendorCategory) ?? "food_beverage",
          approvedSpendCents: stats.approvedCents,
          approvedInvoiceCount: stats.approvedCount,
          pendingInvoiceCount: stats.pendingCount,
        };
      });
    },
  });
}

// Real operating-expense breakdown by category (Food & Beverage,
// Utilities, Maintenance, Rent, Insurance, Other) — the direct answer
// to "what am I actually spending on non-food costs." All 6
// categories are always present, 0 if unused, so the chart never
// silently omits a category that genuinely has no spend yet.
export type ExpenseCategorySpend = {
  category: VendorCategory;
  spendCents: number;
  invoiceCount: number;
};

export function useExpenseCategorySpend(dateRange?: DateRange) {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["expense-category-spend", restaurantId, dateRange?.from, dateRange?.to],
    enabled: !!restaurantId,
    queryFn: async (): Promise<ExpenseCategorySpend[]> => {
      const [vendorsRes, invoicesRes] = await Promise.all([
        supabase.from("vendors").select("id, category").eq("restaurant_id", restaurantId!),
        supabase
          .from("invoices")
          .select("vendor_id, status, total_cents, invoice_date, created_at")
          .eq("restaurant_id", restaurantId!)
          .eq("status", "approved"),
      ]);
      if (vendorsRes.error) throw vendorsRes.error;
      if (invoicesRes.error) throw invoicesRes.error;

      const categoryByVendorId = new Map<string, VendorCategory>(
        (vendorsRes.data ?? []).map((v) => [
          v.id,
          (v.category as VendorCategory) ?? "food_beverage",
        ]),
      );

      const byCategory = new Map<VendorCategory, { spendCents: number; invoiceCount: number }>();
      for (const c of VENDOR_CATEGORIES)
        byCategory.set(c.value, { spendCents: 0, invoiceCount: 0 });

      for (const inv of invoicesRes.data ?? []) {
        if (!inv.vendor_id) continue;
        if (dateRange && !dateInRange(inv.invoice_date ?? inv.created_at, dateRange)) continue;
        const category = categoryByVendorId.get(inv.vendor_id) ?? "food_beverage";
        const cur = byCategory.get(category)!;
        cur.spendCents += inv.total_cents ?? 0;
        cur.invoiceCount += 1;
      }

      return VENDOR_CATEGORIES.map((c) => ({ category: c.value, ...byCategory.get(c.value)! }));
    },
  });
}

// Real savings, built entirely from discount_cents values a reviewer
// typed in off the actual invoice (see useSetInvoiceDiscount) — not
// projected/AI-estimated. Only approved invoices count, and only ones
// where a discount was actually entered; invoices with no discount
// entered yet are excluded rather than treated as $0 savings, since
// "not yet reviewed for a discount" and "genuinely had none" aren't
// the same thing.
export type SavingsSummary = {
  totalDiscountCents: number;
  invoicesWithDiscountCount: number;
  approvedInvoiceCount: number;
  byVendor: { vendorId: string; name: string; discountCents: number; invoiceCount: number }[];
  invoices: {
    id: string;
    vendorName: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    discountCents: number;
    totalCents: number | null;
  }[];
};

export function useSavingsSummary(dateRange?: DateRange) {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["savings-summary", restaurantId, dateRange?.from, dateRange?.to],
    enabled: !!restaurantId,
    queryFn: async (): Promise<SavingsSummary> => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id, invoice_number, invoice_date, created_at, total_cents, discount_cents, status, vendor_id, vendors(name)",
        )
        .eq("restaurant_id", restaurantId!)
        .eq("status", "approved")
        .order("invoice_date", { ascending: false });
      if (error) throw error;
      type Row = {
        id: string;
        invoice_number: string | null;
        invoice_date: string | null;
        created_at: string;
        total_cents: number | null;
        discount_cents: number | null;
        vendor_id: string | null;
        vendors: { name: string } | null;
      };
      const allRows = (data ?? []) as unknown as Row[];
      const rows = dateRange
        ? allRows.filter((r) => dateInRange(r.invoice_date ?? r.created_at, dateRange))
        : allRows;
      const withDiscount = rows.filter((r) => r.discount_cents != null && r.discount_cents > 0);

      const byVendor = new Map<
        string,
        { name: string; discountCents: number; invoiceCount: number }
      >();
      for (const r of withDiscount) {
        if (!r.vendor_id) continue;
        const cur = byVendor.get(r.vendor_id) ?? {
          name: r.vendors?.name ?? "Unknown vendor",
          discountCents: 0,
          invoiceCount: 0,
        };
        cur.discountCents += r.discount_cents ?? 0;
        cur.invoiceCount += 1;
        byVendor.set(r.vendor_id, cur);
      }

      return {
        totalDiscountCents: withDiscount.reduce((sum, r) => sum + (r.discount_cents ?? 0), 0),
        invoicesWithDiscountCount: withDiscount.length,
        approvedInvoiceCount: rows.length,
        byVendor: Array.from(byVendor.entries())
          .map(([vendorId, v]) => ({ vendorId, ...v }))
          .sort((a, b) => b.discountCents - a.discountCents),
        invoices: withDiscount.map((r) => ({
          id: r.id,
          vendorName: r.vendors?.name ?? null,
          invoiceNumber: r.invoice_number,
          invoiceDate: r.invoice_date,
          discountCents: r.discount_cents ?? 0,
          totalCents: r.total_cents,
        })),
      };
    },
  });
}

// Real top line items + category spend, computed from invoice_lines on
// approved invoices. No time window (last-30-days/MTD) is applied —
// with only a handful of real invoices spanning several months so
// far, a strict window would hide real spend rather than reveal a
// trend. Only lines matched to an ingredient are included, since an
// unmatched line's raw_description isn't a stable identity to
// aggregate across invoices. "Savings per item" from the old mock is
// dropped entirely — discounts are only tracked at the invoice level,
// there's no real per-line-item discount to show.
export type TopLineItem = {
  ingredientId: string;
  name: string;
  vendorLabel: string;
  spendCents: number;
  priceChangePct: number | null;
};

export type CategorySpend = { category: string; spendCents: number };

export function useTopLineItems(dateRange?: DateRange) {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["top-line-items", restaurantId, dateRange?.from, dateRange?.to],
    enabled: !!restaurantId,
    queryFn: async (): Promise<TopLineItem[]> => {
      const { data, error } = await supabase
        .from("invoice_lines")
        .select(
          "line_total_cents, ingredient_id, ingredients(name), invoices!inner(status, invoice_date, created_at, vendors(name))",
        )
        .eq("restaurant_id", restaurantId!);
      if (error) throw error;
      type Row = {
        line_total_cents: number | null;
        ingredient_id: string | null;
        ingredients: { name: string } | null;
        invoices: {
          status: string;
          invoice_date: string | null;
          created_at: string;
          vendors: { name: string } | null;
        } | null;
      };
      const rows = ((data ?? []) as unknown as Row[]).filter(
        (r) =>
          r.invoices?.status === "approved" &&
          r.ingredient_id &&
          (!dateRange || dateInRange(r.invoices.invoice_date ?? r.invoices.created_at, dateRange)),
      );

      const byIngredient = new Map<
        string,
        { name: string; spendCents: number; vendors: Set<string> }
      >();
      for (const r of rows) {
        const id = r.ingredient_id!;
        const cur = byIngredient.get(id) ?? {
          name: r.ingredients?.name ?? "Unknown item",
          spendCents: 0,
          vendors: new Set<string>(),
        };
        cur.spendCents += r.line_total_cents ?? 0;
        if (r.invoices?.vendors?.name) cur.vendors.add(r.invoices.vendors.name);
        byIngredient.set(id, cur);
      }

      const ingredientIds = Array.from(byIngredient.keys());
      const priceChangeByIngredient = new Map<string, number | null>();
      if (ingredientIds.length > 0) {
        const { data: historyData, error: historyError } = await supabase
          .from("ingredient_cost_history")
          .select("ingredient_id, unit_cost_cents, effective_date, created_at")
          .in("ingredient_id", ingredientIds)
          .order("effective_date", { ascending: true })
          .order("created_at", { ascending: true });
        if (historyError) throw historyError;
        const history = new Map<string, { unit_cost_cents: number }[]>();
        for (const h of historyData ?? []) {
          const list = history.get(h.ingredient_id) ?? [];
          list.push({ unit_cost_cents: h.unit_cost_cents });
          history.set(h.ingredient_id, list);
        }
        for (const [id, entries] of history) {
          if (entries.length < 2) {
            priceChangeByIngredient.set(id, null);
            continue;
          }
          const prev = entries[entries.length - 2].unit_cost_cents;
          const latest = entries[entries.length - 1].unit_cost_cents;
          priceChangeByIngredient.set(
            id,
            prev > 0 ? Math.round(((latest - prev) / prev) * 100) : null,
          );
        }
      }

      return Array.from(byIngredient.entries())
        .map(([ingredientId, v]) => ({
          ingredientId,
          name: v.name,
          vendorLabel:
            v.vendors.size === 0
              ? "—"
              : v.vendors.size === 1
                ? Array.from(v.vendors)[0]
                : "Multiple vendors",
          spendCents: v.spendCents,
          priceChangePct: priceChangeByIngredient.get(ingredientId) ?? null,
        }))
        .sort((a, b) => b.spendCents - a.spendCents)
        .slice(0, 8);
    },
  });
}

export function useCategorySpend(dateRange?: DateRange) {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["category-spend", restaurantId, dateRange?.from, dateRange?.to],
    enabled: !!restaurantId,
    queryFn: async (): Promise<CategorySpend[]> => {
      const { data, error } = await supabase
        .from("invoice_lines")
        .select(
          "line_total_cents, ingredients(category), invoices!inner(status, invoice_date, created_at)",
        )
        .eq("restaurant_id", restaurantId!);
      if (error) throw error;
      type Row = {
        line_total_cents: number | null;
        ingredients: { category: string | null } | null;
        invoices: { status: string; invoice_date: string | null; created_at: string } | null;
      };
      const rows = ((data ?? []) as unknown as Row[]).filter(
        (r) =>
          r.invoices?.status === "approved" &&
          r.ingredients?.category &&
          (!dateRange || dateInRange(r.invoices.invoice_date ?? r.invoices.created_at, dateRange)),
      );
      const byCategory = new Map<string, number>();
      for (const r of rows) {
        const cat = r.ingredients!.category!;
        byCategory.set(cat, (byCategory.get(cat) ?? 0) + (r.line_total_cents ?? 0));
      }
      return Array.from(byCategory.entries())
        .map(([category, spendCents]) => ({ category, spendCents }))
        .sort((a, b) => b.spendCents - a.spendCents);
    },
  });
}

// Real Gmail ingestion status — surfaced instead of the fictional
// multi-source (email/portal/API/EDI) automation mockup, since Gmail
// is the one real connected source right now.
export type EmailIngestionStatus = {
  connectedEmail: string;
  labelFilter: string | null;
  lastSyncedAt: string | null;
};

export function useEmailIngestionStatus() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["email-ingestion-status", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<EmailIngestionStatus | null> => {
      const { data, error } = await supabase
        .from("email_ingestion_credentials")
        .select("connected_email, label_filter, last_synced_at")
        .eq("restaurant_id", restaurantId!)
        .eq("provider", "gmail")
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        connectedEmail: data.connected_email,
        labelFilter: data.label_filter,
        lastSyncedAt: data.last_synced_at,
      };
    },
  });
}

// One row per attachment candidate email-ingest ever evaluated
// (whether it became an invoice or was rejected before OCR), sourced
// from email_ingestion_events — the per-attachment audit log the
// agent-rules spec requires ("log every decision"). Replaces the old
// processed_email_messages-backed feed, which was message-level only
// and had no column for *why* something was skipped.
// processed_email_messages itself is unchanged — it's still the
// dedup table, a separate concern from this activity feed.
export type EmailIngestionEvent = {
  id: string;
  createdAt: string;
  outcome: "processed" | "skipped";
  reason: string;
  filename: string | null;
  invoiceId: string | null;
  vendorName: string | null;
  totalCents: number | null;
  flags: string[];
};

export function useEmailIngestionActivity() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["email-ingestion-activity", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<EmailIngestionEvent[]> => {
      const { data, error } = await supabase
        .from("email_ingestion_events")
        .select(
          "id, created_at, outcome, reason, filename, invoice_id, invoices(total_cents, flags, vendors(name))",
        )
        .eq("restaurant_id", restaurantId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      type Row = {
        id: string;
        created_at: string;
        outcome: "processed" | "skipped";
        reason: string;
        filename: string | null;
        invoice_id: string | null;
        invoices: {
          total_cents: number | null;
          flags: string[] | null;
          vendors: { name: string } | null;
        } | null;
      };
      return ((data ?? []) as unknown as Row[]).map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        outcome: row.outcome,
        reason: row.reason,
        filename: row.filename,
        invoiceId: row.invoice_id,
        vendorName: row.invoices?.vendors?.name ?? null,
        totalCents: row.invoices?.total_cents ?? null,
        flags: row.invoices?.flags ?? [],
      }));
    },
  });
}

export type RealInvoiceLine = {
  id: string;
  ingredientId: string | null;
  rawDescription: string;
  quantity: number | null;
  unit: string | null;
  unitCostCents: number | null;
  lineTotalCents: number | null;
  productCode: string | null;
  detectedPackSize: number | null;
  casePricingStatus: "auto" | "needs_review" | null;
};

export function useRealInvoiceLines(invoiceId: string | undefined) {
  return useQuery({
    queryKey: ["real-invoice-lines", invoiceId],
    enabled: !!invoiceId,
    queryFn: async (): Promise<RealInvoiceLine[]> => {
      const { data, error } = await supabase
        .from("invoice_lines")
        .select("*")
        .eq("invoice_id", invoiceId!)
        .order("raw_description");
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        ingredientId: row.ingredient_id,
        rawDescription: row.raw_description,
        quantity: row.quantity,
        unit: row.unit,
        unitCostCents: row.unit_cost_cents,
        lineTotalCents: row.line_total_cents,
        productCode: row.product_code,
        detectedPackSize: row.detected_pack_size,
        casePricingStatus: row.case_pricing_status,
      }));
    },
  });
}

// Resolves a "was this line ordered by the case or the bottle?"
// ambiguity once for a given vendor + product_code, remembers the
// answer in vendor_product_pack_info, and recomputes this specific
// line's quantity/unit_cost_cents from it — every future invoice line
// for the same vendor + product_code then auto-resolves via that
// memory instead of asking again. See db/phase2/48_case_bottle_resolution.sql
// and ocr/src/server.ts for why OCR alone can't make this call.
export function useResolveCasePricing() {
  const queryClient = useQueryClient();
  const restaurantId = useCurrentRestaurantId();

  return useMutation({
    mutationFn: async (input: {
      lineId: string;
      vendorId: string;
      productCode: string;
      quantity: number;
      lineTotalCents: number | null;
      detectedPackSize: number | null;
      orderUnit: "case" | "bottle";
    }) => {
      const totalUnits =
        input.orderUnit === "case" && input.detectedPackSize != null
          ? input.quantity * input.detectedPackSize
          : input.quantity;
      const unitCostCents =
        input.lineTotalCents != null ? Math.round(input.lineTotalCents / totalUnits) : null;

      // Seeds last_unit_cost_cents immediately — ocr/'s plausibility
      // check (server.ts) needs a real baseline to compare future
      // invoices against, not just whichever price happened to be on
      // the invoice that triggered the very first resolution.
      const { error: upsertError } = await supabase.from("vendor_product_pack_info").upsert(
        {
          restaurant_id: restaurantId,
          vendor_id: input.vendorId,
          product_code: input.productCode,
          order_unit: input.orderUnit,
          pack_size: input.orderUnit === "case" ? input.detectedPackSize : null,
          last_unit_cost_cents: unitCostCents,
        },
        { onConflict: "restaurant_id,vendor_id,product_code" },
      );
      if (upsertError) throw upsertError;

      const { error: updateError } = await supabase
        .from("invoice_lines")
        .update({
          quantity: totalUnits,
          unit_cost_cents: unitCostCents,
          case_pricing_status: "auto",
        })
        .eq("id", input.lineId);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["real-invoice-lines"] });
      queryClient.invalidateQueries({ queryKey: ["real-invoices"] });
    },
  });
}

export function useUploadInvoice() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      vendorId,
      file,
    }: {
      vendorId: string | null;
      file: File;
    }): Promise<string> => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const path = `${restaurantId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("invoice-uploads")
        .upload(path, file, { contentType: file.type || "application/pdf" });
      if (uploadErr) throw uploadErr;

      const { data, error: insertErr } = await supabase
        .from("invoices")
        .insert({
          restaurant_id: restaurantId,
          location_id: locationId,
          vendor_id: vendorId,
          status: "pending_review",
          source_file_url: path,
        })
        .select("id")
        .single();
      if (insertErr) throw insertErr;
      return data.id as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["real-invoices"] }),
  });
}

// The `invoice-uploads` bucket is private, so viewing the original file
// a customer/vendor sent means minting a short-lived signed URL on
// demand rather than storing a public one — generated fresh per click
// so it isn't sitting around in cache after the link expires.
export function useOriginalInvoiceUrl() {
  return useMutation({
    mutationFn: async (sourceFileUrl: string): Promise<string> => {
      const { data, error } = await supabase.storage
        .from("invoice-uploads")
        .createSignedUrl(sourceFileUrl, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

// For expenses with no document to OCR — cash paid to a landlord or
// repair person, for example. Skips the upload/extraction pipeline
// entirely and inserts an already-approved invoice with no line items;
// vendor-spend and category-spend rollups read totals straight off
// `invoices` (no invoice_lines join), so a lineless row still counts
// correctly everywhere except the ingredient-based charts, where it
// rightly doesn't appear since it isn't food/ingredient spend.
export function useCreateManualExpense() {
  const restaurantId = useCurrentRestaurantId();
  const locationId = useCurrentLocationId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      vendorId: string;
      totalCents: number;
      invoiceDate: string;
      note: string | null;
    }): Promise<string> => {
      if (!restaurantId || !locationId) throw new Error("no current restaurant/location");
      const { data, error } = await supabase
        .from("invoices")
        .insert({
          restaurant_id: restaurantId,
          location_id: locationId,
          vendor_id: input.vendorId,
          invoice_date: input.invoiceDate,
          invoice_number: input.note,
          total_cents: input.totalCents,
          status: "approved",
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["real-invoices"] }),
  });
}

export type OcrCheckResult = {
  status: "processing" | "ready" | "failed";
  // Set when Mindee found nothing invoice-like at all (no number,
  // date, total, or line items) — the ocr/ service deletes the row
  // and its uploaded file outright rather than leaving a permanent
  // empty invoice around, so there's nothing left to fetch afterward.
  deleted?: boolean;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  date?: string | null;
  totalAmount?: number | null;
  lineItemsExtracted?: number;
  lineItemsAutoMatched?: number;
  error?: unknown;
};

export type OcrEnqueueResult = {
  // Set when the document is classified as payroll (a paycheck,
  // payroll register, employee earnings report, etc.) BEFORE Mindee is
  // ever called — the ocr/ service deletes the row and its uploaded
  // file outright rather than paying for an extraction (and, for a
  // multi-page PDF, a whole batch of them) on something that was never
  // going to be a real vendor invoice.
  deleted?: boolean;
};

export function useEnqueueOcr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string): Promise<OcrEnqueueResult> => {
      const { data, error } = await supabase.functions.invoke("invoice-ocr", {
        body: { invoice_id: invoiceId, action: "enqueue" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "enqueue failed");
      return data as OcrEnqueueResult;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["real-invoices"] }),
  });
}

export function useCheckOcr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string): Promise<OcrCheckResult> => {
      const { data, error } = await supabase.functions.invoke("invoice-ocr", {
        body: { invoice_id: invoiceId, action: "check" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "check failed");
      return data as OcrCheckResult;
    },
    onSuccess: (_result, invoiceId) => {
      queryClient.invalidateQueries({ queryKey: ["real-invoice-lines", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["real-invoices"] });
    },
  });
}

// Approving an invoice is the moment OCR-drafted costs become real:
// each matched line's unit_cost_cents becomes the ingredient's current
// cost (feeding recipe-based food cost calculations), and a
// ingredient_cost_history row records it for trend/variance tracking.
// Unmatched lines (ingredient_id null) don't affect any ingredient.
export function useApproveInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data: invoice, error: invoiceErr } = await supabase
        .from("invoices")
        .select("restaurant_id, invoice_date, flags")
        .eq("id", invoiceId)
        .single();
      if (invoiceErr) throw invoiceErr;

      const { data: lines, error: linesErr } = await supabase
        .from("invoice_lines")
        .select("id, ingredient_id, unit_cost_cents")
        .eq("invoice_id", invoiceId)
        .not("ingredient_id", "is", null)
        .not("unit_cost_cents", "is", null);
      if (linesErr) throw linesErr;

      const effectiveDate = invoice.invoice_date ?? new Date().toISOString().slice(0, 10);
      const matchedLines = lines ?? [];

      await Promise.all(
        matchedLines.map(async (line) => {
          const { error } = await supabase
            .from("ingredients")
            .update({ unit_cost_cents: line.unit_cost_cents })
            .eq("id", line.ingredient_id);
          if (error) throw error;
        }),
      );

      if (matchedLines.length > 0) {
        const { error: historyErr } = await supabase.from("ingredient_cost_history").insert(
          matchedLines.map((line) => ({
            restaurant_id: invoice.restaurant_id,
            ingredient_id: line.ingredient_id,
            invoice_line_id: line.id,
            unit_cost_cents: line.unit_cost_cents,
            effective_date: effectiveDate,
          })),
        );
        if (historyErr) throw historyErr;
      }

      // unknown_sender/totals_mismatch exist to prompt a human to check
      // the vendor and the numbers before approving — clicking Approve
      // (which already requires a vendor to be assigned, per the UI's
      // disabled state) is that check happening, so carrying them
      // forward past this point is just stale noise. Other flags
      // (duplicate, not_an_invoice, low_confidence, case_pricing_*)
      // aren't cleared here — those aren't resolved by the act of
      // approving itself.
      const clearedOnApprove = new Set(["unknown_sender", "totals_mismatch"]);
      const remainingFlags = (invoice.flags ?? []).filter((f: string) => !clearedOnApprove.has(f));

      const { error: approveErr } = await supabase
        .from("invoices")
        .update({ status: "approved", flags: remainingFlags })
        .eq("id", invoiceId);
      if (approveErr) throw approveErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["real-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      queryClient.invalidateQueries({ queryKey: ["food-cost-summary"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-spend-summary"] });
      queryClient.invalidateQueries({ queryKey: ["savings-summary"] });
      queryClient.invalidateQueries({ queryKey: ["top-line-items"] });
      queryClient.invalidateQueries({ queryKey: ["category-spend"] });
    },
  });
}

export function useUpdateInvoiceLineIngredient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      lineId,
      ingredientId,
    }: {
      lineId: string;
      ingredientId: string | null;
    }) => {
      const { error } = await supabase
        .from("invoice_lines")
        .update({ ingredient_id: ingredientId })
        .eq("id", lineId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["real-invoice-lines"] });
      queryClient.invalidateQueries({ queryKey: ["top-line-items"] });
      queryClient.invalidateQueries({ queryKey: ["category-spend"] });
    },
  });
}
