import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useRestaurantIds } from "@/lib/supabase/scope";

// A user can belong to more than one restaurant, but the dashboard
// today only ever shows one at a time — same simplification used
// throughout this app's other query hooks.
function useCurrentRestaurantId(): string | undefined {
  return useRestaurantIds()[0];
}

export type CustomerSource = "manual" | "bulk_import" | "sample";

export type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  totalSpendCents: number | null;
  visitCount: number | null;
  lastVisitDate: string | null;
  emailOptIn: boolean;
  smsOptIn: boolean;
  source: CustomerSource;
  notes: string | null;
  createdAt: string;
};

function fromRow(row: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[] | null;
  total_spend_cents: number | null;
  visit_count: number | null;
  last_visit_date: string | null;
  email_opt_in: boolean;
  sms_opt_in: boolean;
  source: string;
  notes: string | null;
  created_at: string;
}): Customer {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    tags: row.tags ?? [],
    totalSpendCents: row.total_spend_cents,
    visitCount: row.visit_count,
    lastVisitDate: row.last_visit_date,
    emailOptIn: row.email_opt_in,
    smsOptIn: row.sms_opt_in,
    source: row.source as CustomerSource,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function useCustomers() {
  const restaurantId = useCurrentRestaurantId();
  return useQuery({
    queryKey: ["customers", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<Customer[]> => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("restaurant_id", restaurantId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(fromRow);
    },
  });
}

export type CustomerInput = {
  name: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  emailOptIn: boolean;
  smsOptIn: boolean;
  notes: string | null;
};

export function useCreateCustomer() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CustomerInput) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { error } = await supabase.from("customers").insert({
        restaurant_id: restaurantId,
        name: input.name,
        email: input.email,
        phone: input.phone,
        tags: input.tags,
        email_opt_in: input.emailOptIn,
        sms_opt_in: input.smsOptIn,
        notes: input.notes,
        source: "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: CustomerInput }) => {
      const { error } = await supabase
        .from("customers")
        .update({
          name: input.name,
          email: input.email,
          phone: input.phone,
          tags: input.tags,
          email_opt_in: input.emailOptIn,
          sms_opt_in: input.smsOptIn,
          notes: input.notes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

// Deletes every row seeded as sample/placeholder data — offered once
// a real bulk import has landed, so the fake rows don't linger
// alongside the real list.
export function useDeleteSampleCustomers() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { error } = await supabase
        .from("customers")
        .delete()
        .eq("restaurant_id", restaurantId)
        .eq("source", "sample");
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export type BulkImportCustomerRow = {
  name: string;
  email: string | null;
  phone: string | null;
};

export type BulkCreateCustomersResult = {
  created: number;
  failed: { name: string; error: string }[];
};

// Each row gets independent error handling — a duplicate email (the
// real unique(restaurant_id, email) constraint) or a bad row shouldn't
// fail the whole import, since re-uploading the same list twice or a
// list with a few messy rows is the expected common case.
export function useBulkImportCustomers() {
  const restaurantId = useCurrentRestaurantId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: BulkImportCustomerRow[]): Promise<BulkCreateCustomersResult> => {
      if (!restaurantId) throw new Error("no current restaurant");

      const results = await Promise.allSettled(
        rows.map(async (row) => {
          const { error } = await supabase.from("customers").insert({
            restaurant_id: restaurantId,
            name: row.name,
            email: row.email,
            phone: row.phone,
            source: "bulk_import",
          });
          if (error) throw new Error(error.message);
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

// Minimal RFC-4180-ish CSV parser (quoted fields, "" escaped quotes,
// commas/newlines inside quotes) — no external dependency, since the
// bulk-import review step already lets the owner catch/fix anything
// a real-world CSV export trips this up on.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}
