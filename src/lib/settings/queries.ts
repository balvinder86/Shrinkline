import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useRestaurantIds } from "@/lib/supabase/scope";

// Renames the current restaurant. Requires db/phase2/68_restaurant_owner_update.sql
// (restaurants had a read-only RLS policy before that — no insert/
// update/delete for normal users at all, see db/phase0/01_schema.sql).
//
// An RLS USING clause that blocks an UPDATE doesn't error — Postgres
// just matches zero rows, and PostgREST returns 200 with an empty
// result, not a failure. Without .select() + a length check here,
// this would report "Saved" while silently changing nothing whenever
// the policy is missing or the caller isn't an owner — confirmed live
// against production before this check was added: the UI showed
// "Saved," but a fresh reload showed the old name untouched.
export function useUpdateRestaurantName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await supabase
        .from("restaurants")
        .update({ name })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(
          "Nothing was updated — you may not have owner access, or db/phase2/68_restaurant_owner_update.sql hasn't been applied yet.",
        );
      }
    },
    onSuccess: () => {
      // RestaurantProvider's own query key (src/lib/restaurant-context.tsx)
      // — invalidating it is what makes the new name show up in the
      // sidebar's restaurant switcher too, not just this page.
      queryClient.invalidateQueries({ queryKey: ["restaurant-names"] });
    },
  });
}

export type RestaurantProfile = {
  id: string;
  name: string;
  logoUrl: string | null;
  legalName: string | null;
  cuisine: string | null;
  priceTier: string | null;
  publicEmail: string | null;
  phone: string | null;
  website: string | null;
  description: string | null;
};

// Separate from RestaurantProvider's own restaurant-names query
// (src/lib/restaurant-context.tsx) — that one is fetched globally for
// every restaurant the user belongs to (sidebar switcher etc.) and
// deliberately stays lean (id, name only). These extra profile fields
// are only ever needed on the Settings page, so they get their own
// scoped query rather than bloating the global one.
export function useRestaurantProfile() {
  const restaurantId = useRestaurantIds()[0];
  return useQuery({
    queryKey: ["restaurant-profile", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<RestaurantProfile | null> => {
      const { data, error } = await supabase
        .from("restaurants")
        .select(
          "id, name, logo_url, legal_name, cuisine, price_tier, public_email, phone, website, description",
        )
        .eq("id", restaurantId!)
        .single();
      if (error) throw error;
      return {
        id: data.id,
        name: data.name,
        logoUrl: data.logo_url,
        legalName: data.legal_name,
        cuisine: data.cuisine,
        priceTier: data.price_tier,
        publicEmail: data.public_email,
        phone: data.phone,
        website: data.website,
        description: data.description,
      };
    },
  });
}

export type RestaurantProfileDetails = {
  legalName: string;
  cuisine: string;
  priceTier: string;
  publicEmail: string;
  phone: string;
  website: string;
  description: string;
};

// Empty strings are stored as null rather than "" so an unfilled field
// reads as "never set" (and can show a placeholder) instead of a saved
// blank value.
export function useUpdateRestaurantProfileDetails() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, details }: { id: string; details: RestaurantProfileDetails }) => {
      const { data, error } = await supabase
        .from("restaurants")
        .update({
          legal_name: details.legalName.trim() || null,
          cuisine: details.cuisine.trim() || null,
          price_tier: details.priceTier.trim() || null,
          public_email: details.publicEmail.trim() || null,
          phone: details.phone.trim() || null,
          website: details.website.trim() || null,
          description: details.description.trim() || null,
        })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Nothing was updated — you may not have owner access.");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["restaurant-profile"] }),
  });
}

// Uploads to the restaurant's own folder in the public restaurant-logos
// bucket (db/phase2/69_restaurant_profile_fields.sql), then best-effort
// removes the previous logo file so replacing a logo doesn't leave
// orphaned files behind — failure to clean up the old file isn't worth
// failing the whole upload over, so that removal is fire-and-forget.
export function useUploadRestaurantLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      file,
      previousLogoUrl,
    }: {
      id: string;
      file: File;
      previousLogoUrl: string | null;
    }) => {
      const ext = file.name.split(".").pop() || "png";
      const path = `${id}/logo-${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("restaurant-logos")
        .upload(path, file, { contentType: file.type || "image/png" });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("restaurant-logos").getPublicUrl(path);

      const { data, error } = await supabase
        .from("restaurants")
        .update({ logo_url: urlData.publicUrl })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Nothing was updated — you may not have owner access.");
      }

      if (previousLogoUrl) {
        const previousPath = previousLogoUrl.split("/restaurant-logos/")[1];
        if (previousPath) {
          void supabase.storage.from("restaurant-logos").remove([previousPath]);
        }
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["restaurant-profile"] }),
  });
}

export function useRemoveRestaurantLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, logoUrl }: { id: string; logoUrl: string }) => {
      const { data, error } = await supabase
        .from("restaurants")
        .update({ logo_url: null })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Nothing was updated — you may not have owner access.");
      }

      const path = logoUrl.split("/restaurant-logos/")[1];
      if (path) {
        void supabase.storage.from("restaurant-logos").remove([path]);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["restaurant-profile"] }),
  });
}

export type SettingsLocation = {
  id: string;
  name: string;
  timezone: string;
};

// locations already has a real read+write tenant_isolation RLS policy
// (db/phase0/01_schema.sql) — any member can edit a location's own
// name/timezone, no new migration needed for this one.
export function useLocationsForSettings() {
  const restaurantId = useRestaurantIds()[0];
  return useQuery({
    queryKey: ["settings-locations", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<SettingsLocation[]> => {
      const { data, error } = await supabase
        .from("locations")
        .select("id, name, timezone")
        .eq("restaurant_id", restaurantId!)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateLocation() {
  const restaurantId = useRestaurantIds()[0];
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, timezone }: { name: string; timezone: string }) => {
      if (!restaurantId) throw new Error("No current restaurant.");
      const { data, error } = await supabase
        .from("locations")
        .insert({ restaurant_id: restaurantId, name, timezone })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-locations"] });
      // LocationProvider's own query key (src/lib/location-context.tsx)
      // — invalidating it is what makes the new location show up in the
      // sidebar switcher immediately instead of only after a refresh.
      queryClient.invalidateQueries({ queryKey: ["locations-for-switcher"] });
      // Brands overview page's query (src/lib/restaurants/queries.ts) —
      // same reasoning, otherwise a location added from there (or from
      // the header switcher's Add Location dialog) leaves its card
      // showing a stale location list until a manual reload.
      queryClient.invalidateQueries({ queryKey: ["brands-overview"] });

      // Phase 3 Part D: "when locations are added/removed later,
      // update the Stripe subscription quantity; the webhook mirrors
      // the change." A no-op server-side if this restaurant isn't
      // subscribed yet — fire-and-forget so a Stripe hiccup never
      // blocks or fails the location creation itself, which already
      // succeeded by this point.
      if (restaurantId) {
        supabase.functions
          .invoke("sync-subscription-quantity", { body: { restaurant_id: restaurantId } })
          .catch((e) => console.error("sync-subscription-quantity failed:", e))
          .finally(() => {
            // Best-effort refresh — the real new quantity only lands a
            // few seconds later once Stripe's webhook actually fires,
            // so this may still show the old value until the next
            // natural refetch; not worth polling for here.
            queryClient.invalidateQueries({ queryKey: ["subscription"] });
          });
      }
    },
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, timezone }: { id: string; name: string; timezone: string }) => {
      const { data, error } = await supabase
        .from("locations")
        .update({ name, timezone })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Nothing was updated — this location may not belong to your restaurant.");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings-locations"] }),
  });
}

// Hard delete — locations cascade to every table keyed by location_id
// (sales, invoices, inventory counts, schedules, purchase orders, all
// `on delete cascade`), so this genuinely erases that location's
// history. The UI blocks calling this on a restaurant's last remaining
// location and requires typing the location's name to confirm; this
// hook itself trusts the caller already did that.
export function useDeleteLocation() {
  const restaurantId = useRestaurantIds()[0];
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from("locations").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Nothing was deleted — this location may not belong to your restaurant.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-locations"] });
      // Same three follow-up invalidations as useCreateLocation, in
      // reverse: the sidebar switcher and Brands overview card both
      // read location lists that need to drop the deleted one too.
      queryClient.invalidateQueries({ queryKey: ["locations-for-switcher"] });
      queryClient.invalidateQueries({ queryKey: ["brands-overview"] });
      if (restaurantId) {
        supabase.functions
          .invoke("sync-subscription-quantity", { body: { restaurant_id: restaurantId } })
          .catch((e) => console.error("sync-subscription-quantity failed:", e))
          .finally(() => queryClient.invalidateQueries({ queryKey: ["subscription"] }));
      }
    },
  });
}

export const VOICE_TONE_OPTIONS = [
  { value: "warm", label: "Warm & welcoming" },
  { value: "playful", label: "Playful & bold" },
  { value: "refined", label: "Refined & upscale" },
  { value: "casual", label: "Casual & fun" },
  { value: "straightforward", label: "Straightforward & no-frills" },
] as const;

export type RestaurantBranding = {
  palette: string[];
  tagline: string | null;
  voiceTone: string | null;
};

// Settings > Branding — saved data only (db/phase2/71_restaurant_branding.sql).
// Scope confirmed with the user: this app's own UI does not re-theme
// per tenant from these colors, and there's no downstream consumer of
// voiceTone yet (a future AI-copy pass could read it) — both are
// stored for now, applied nowhere, same "real but not yet wired up
// everywhere" honesty as other Settings sections.
export function useRestaurantBranding() {
  const restaurantId = useRestaurantIds()[0];
  return useQuery({
    queryKey: ["restaurant-branding", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<RestaurantBranding> => {
      const { data, error } = await supabase
        .from("restaurant_branding")
        .select("palette, tagline, voice_tone")
        .eq("restaurant_id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      return {
        palette: data?.palette ?? [],
        tagline: data?.tagline ?? null,
        voiceTone: data?.voice_tone ?? null,
      };
    },
  });
}

export function useUpdateRestaurantBranding() {
  const restaurantId = useRestaurantIds()[0];
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (branding: RestaurantBranding) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { error } = await supabase.from("restaurant_branding").upsert(
        {
          restaurant_id: restaurantId,
          palette: branding.palette,
          tagline: branding.tagline?.trim() || null,
          voice_tone: branding.voiceTone,
        },
        { onConflict: "restaurant_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["restaurant-branding"] }),
  });
}

export type TaxSettings = {
  federalEin: string;
  stateTaxId: string;
  defaultSalesTaxRate: string;
  liquorTaxRate: string;
  taxInclusivePricing: boolean;
  fiscalYearStartMonth: number;
};

// Owner-only, both the settings row and documents below
// (db/phase2/72_tax_compliance.sql) — tax IDs and legal documents are
// more sensitive than review_agent_settings/restaurant_branding, which
// use the more permissive tenant_isolation pattern instead.
export function useTaxSettings() {
  const restaurantId = useRestaurantIds()[0];
  return useQuery({
    queryKey: ["tax-settings", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<TaxSettings> => {
      const { data, error } = await supabase
        .from("restaurant_tax_settings")
        .select(
          "federal_ein, state_tax_id, default_sales_tax_rate, liquor_tax_rate, tax_inclusive_pricing, fiscal_year_start_month",
        )
        .eq("restaurant_id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      return {
        federalEin: data?.federal_ein ?? "",
        stateTaxId: data?.state_tax_id ?? "",
        defaultSalesTaxRate: data?.default_sales_tax_rate?.toString() ?? "",
        liquorTaxRate: data?.liquor_tax_rate?.toString() ?? "",
        taxInclusivePricing: data?.tax_inclusive_pricing ?? false,
        fiscalYearStartMonth: data?.fiscal_year_start_month ?? 1,
      };
    },
  });
}

export function useUpdateTaxSettings() {
  const restaurantId = useRestaurantIds()[0];
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: TaxSettings) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const { data, error } = await supabase
        .from("restaurant_tax_settings")
        .upsert(
          {
            restaurant_id: restaurantId,
            federal_ein: settings.federalEin.trim() || null,
            state_tax_id: settings.stateTaxId.trim() || null,
            default_sales_tax_rate: settings.defaultSalesTaxRate.trim()
              ? Number(settings.defaultSalesTaxRate)
              : null,
            liquor_tax_rate: settings.liquorTaxRate.trim() ? Number(settings.liquorTaxRate) : null,
            tax_inclusive_pricing: settings.taxInclusivePricing,
            fiscal_year_start_month: settings.fiscalYearStartMonth,
          },
          { onConflict: "restaurant_id" },
        )
        .select("restaurant_id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Nothing was updated — you may not have owner access.");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tax-settings"] }),
  });
}

export const TAX_DOC_TYPE_OPTIONS = [
  { value: "w9", label: "W-9" },
  { value: "resale_certificate", label: "Resale certificate" },
  { value: "health_permit", label: "Health permit" },
  { value: "other", label: "Other" },
] as const;

export type TaxDocument = {
  id: string;
  name: string;
  docType: string;
  storagePath: string;
  uploadedAt: string;
};

export function useTaxDocuments() {
  const restaurantId = useRestaurantIds()[0];
  return useQuery({
    queryKey: ["tax-documents", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<TaxDocument[]> => {
      const { data, error } = await supabase
        .from("tax_documents")
        .select("id, name, doc_type, storage_path, uploaded_at")
        .eq("restaurant_id", restaurantId!)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        docType: d.doc_type,
        storagePath: d.storage_path,
        uploadedAt: d.uploaded_at,
      }));
    },
  });
}

export function useUploadTaxDocument() {
  const restaurantId = useRestaurantIds()[0];
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, docType }: { file: File; docType: string }) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const path = `${restaurantId}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("tax-documents")
        .upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (uploadError) throw uploadError;

      const { error } = await supabase.from("tax_documents").insert({
        restaurant_id: restaurantId,
        name: file.name,
        doc_type: docType,
        storage_path: path,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tax-documents"] }),
  });
}

export function useDeleteTaxDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (doc: TaxDocument) => {
      const { error } = await supabase.from("tax_documents").delete().eq("id", doc.id);
      if (error) throw error;
      void supabase.storage.from("tax-documents").remove([doc.storagePath]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tax-documents"] }),
  });
}

// tax-documents is private — mint a fresh short-lived signed URL per
// click rather than a stored one, same as useOriginalInvoiceUrl (this
// file, invoice-uploads' equivalent).
export function useTaxDocumentSignedUrl() {
  return useMutation({
    mutationFn: async (storagePath: string): Promise<string> => {
      const { data, error } = await supabase.storage
        .from("tax-documents")
        .createSignedUrl(storagePath, 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

export type ClosureRequest = {
  id: string;
  note: string | null;
  status: string;
  createdAt: string;
};

// Settings > Restaurant profile > "Close this brand"
// (db/phase2/73_tenant_closure_requests.sql). This never deletes
// anything itself — actually deleting a tenant + cancelling its Stripe
// subscription is a platform-operator action from the company portal,
// same reasoning as tenant creation already being portal-only. This
// just records the owner's request so the portal side can act on it.
export function usePendingClosureRequest() {
  const restaurantId = useRestaurantIds()[0];
  return useQuery({
    queryKey: ["tenant-closure-request", restaurantId],
    enabled: !!restaurantId,
    queryFn: async (): Promise<ClosureRequest | null> => {
      const { data, error } = await supabase
        .from("tenant_closure_requests")
        .select("id, note, status, created_at")
        .eq("restaurant_id", restaurantId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { id: data.id, note: data.note, status: data.status, createdAt: data.created_at };
    },
  });
}

export function useRequestBrandClosure() {
  const restaurantId = useRestaurantIds()[0];
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (note: string) => {
      if (!restaurantId) throw new Error("no current restaurant");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");
      const { error } = await supabase.from("tenant_closure_requests").insert({
        restaurant_id: restaurantId,
        requested_by: user.id,
        note: note.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tenant-closure-request"] }),
  });
}
