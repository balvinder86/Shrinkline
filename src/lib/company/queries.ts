import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth-context";

export type Tenant = {
  id: string;
  name: string;
  createdAt: string;
  locationCount: number;
  planTier: "boh" | "full" | null;
  status: string | null;
  ownerEmails: string[];
};

// platform_admins is an axis independent of memberships (which is
// entirely restaurant-scoped) — see db/phase3/40_platform_admins.sql.
// Its RLS only allows reading your own row, so this is safe to run
// for any logged-in user; it just resolves to false for everyone
// except the platform operator.
export function usePlatformAdmin(): boolean {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["platform-admin", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });
  return data ?? false;
}

export function useTenants() {
  const isPlatformAdmin = usePlatformAdmin();
  return useQuery({
    queryKey: ["tenants"],
    enabled: isPlatformAdmin,
    queryFn: async (): Promise<Tenant[]> => {
      const { data, error } = await supabase.functions.invoke("company-portal", {
        body: { action: "list_tenants" },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "request failed",
        );
      }
      return (data as { tenants: Tenant[] }).tenants;
    },
  });
}

export type CreateTenantResult = {
  restaurantId: string;
  ownerUserId: string;
  inviteLink: string | null;
  alreadyRegistered: boolean;
};

export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      locationName?: string;
      locationTimezone?: string;
      ownerEmail: string;
    }): Promise<CreateTenantResult> => {
      const { data, error } = await supabase.functions.invoke("company-portal", {
        body: {
          action: "create_tenant",
          name: input.name,
          location_name: input.locationName,
          location_timezone: input.locationTimezone,
          owner_email: input.ownerEmail,
        },
      });
      if (error || !(data as { ok?: boolean } | null)?.ok) {
        throw new Error(
          (data as { error?: string } | null)?.error ?? error?.message ?? "request failed",
        );
      }
      return data as CreateTenantResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
    },
  });
}
