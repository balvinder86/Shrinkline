import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useLocationIds } from "@/lib/supabase/scope";
import { type DateRange, isoDate } from "@/lib/date-range";
import { fetchAllRows } from "@/lib/pos/queries";

// Real labor cost, pulled from Toast's Labor API (labor_shifts, one
// row per real clocked time entry, wage resolved at sync time — see
// sync/src/index.ts). Revenue for the labor-cost-% denominator reuses
// pmix_sales.net_sales_cents, the same real-revenue source every
// other cost metric on this dashboard (Food cost %) already uses —
// never recomputed independently.

export type LaborCostSummary = {
  laborCostCents: number;
  regularHours: number;
  overtimeHours: number;
  revenueCents: number;
  // null (not 0) when there's no real revenue in range yet — a
  // fabricated 0% would read as "labor is free," not "no data."
  laborCostPct: number | null;
};

export function useLaborCostSummary(range: DateRange) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["labor-cost-summary", locationIds, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<LaborCostSummary> => {
      const [laborRows, salesRows] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase
            .from("labor_shifts")
            .select("regular_hours, overtime_hours, labor_cost_cents")
            .in("location_id", locationIds!)
            .gte("business_date", fromIso)
            .lte("business_date", toIso)
            .order("business_date", { ascending: true })
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabase
            .from("pmix_sales")
            .select("net_sales_cents")
            .in("location_id", locationIds!)
            .gte("business_date", fromIso)
            .lte("business_date", toIso)
            .order("business_date", { ascending: true })
            .range(from, to),
        ),
      ]);

      let laborCostCents = 0;
      let regularHours = 0;
      let overtimeHours = 0;
      for (const r of laborRows) {
        laborCostCents += Number(r.labor_cost_cents);
        regularHours += Number(r.regular_hours);
        overtimeHours += Number(r.overtime_hours);
      }
      let revenueCents = 0;
      for (const r of salesRows) revenueCents += Number(r.net_sales_cents);

      return {
        laborCostCents,
        regularHours,
        overtimeHours,
        revenueCents,
        laborCostPct: revenueCents > 0 ? (laborCostCents / revenueCents) * 100 : null,
      };
    },
  });
}

export type LaborCostByRole = { role: string; costCents: number; hours: number };

export function useLaborCostByRole(range: DateRange) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["labor-cost-by-role", locationIds, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<LaborCostByRole[]> => {
      const rows = await fetchAllRows((from, to) =>
        supabase
          .from("labor_shifts")
          .select("job_title, regular_hours, overtime_hours, labor_cost_cents")
          .in("location_id", locationIds!)
          .gte("business_date", fromIso)
          .lte("business_date", toIso)
          .range(from, to),
      );

      const byRole = new Map<string, { costCents: number; hours: number }>();
      for (const r of rows) {
        const role = r.job_title ?? "Unassigned role";
        const cur = byRole.get(role) ?? { costCents: 0, hours: 0 };
        cur.costCents += Number(r.labor_cost_cents);
        cur.hours += Number(r.regular_hours) + Number(r.overtime_hours);
        byRole.set(role, cur);
      }
      return Array.from(byRole.entries())
        .map(([role, v]) => ({ role, ...v }))
        .sort((a, b) => b.costCents - a.costCents);
    },
  });
}

export type LaborCostTrendPoint = {
  bucket: string;
  laborCostCents: number;
  revenueCents: number;
  laborCostPct: number | null;
};

export function useLaborCostTrend(range: DateRange) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["labor-cost-trend", locationIds, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<LaborCostTrendPoint[]> => {
      const [laborRows, salesRows] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase
            .from("labor_shifts")
            .select("business_date, labor_cost_cents")
            .in("location_id", locationIds!)
            .gte("business_date", fromIso)
            .lte("business_date", toIso)
            .range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabase
            .from("pmix_sales")
            .select("business_date, net_sales_cents")
            .in("location_id", locationIds!)
            .gte("business_date", fromIso)
            .lte("business_date", toIso)
            .range(from, to),
        ),
      ]);

      const days = Math.round((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1;
      const useWeekly = days > 21;

      // Same Monday-start week-bucket logic as useItemTrend
      // (src/lib/pos/queries.ts) — business_date is a plain date, so
      // this stays in UTC/local terms, not timezone-sensitive like
      // Dayparts' hour-of-day bucketing is.
      const weekStart = (d: Date): string => {
        const day = d.getUTCDay();
        const diff = (day + 6) % 7;
        const monday = new Date(d);
        monday.setUTCDate(d.getUTCDate() - diff);
        return isoDate(monday);
      };
      const bucketKeyFor = (businessDate: string): string => {
        if (!useWeekly) return businessDate;
        const d = new Date(`${businessDate}T00:00:00Z`);
        return weekStart(d);
      };

      const laborByBucket = new Map<string, number>();
      for (const r of laborRows) {
        const key = bucketKeyFor(r.business_date);
        laborByBucket.set(key, (laborByBucket.get(key) ?? 0) + Number(r.labor_cost_cents));
      }
      const revenueByBucket = new Map<string, number>();
      for (const r of salesRows) {
        const key = bucketKeyFor(r.business_date);
        revenueByBucket.set(key, (revenueByBucket.get(key) ?? 0) + Number(r.net_sales_cents));
      }

      const keys = new Set([...laborByBucket.keys(), ...revenueByBucket.keys()]);
      return Array.from(keys)
        .sort()
        .map((key) => {
          const laborCostCents = laborByBucket.get(key) ?? 0;
          const revenueCents = revenueByBucket.get(key) ?? 0;
          const label = new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });
          return {
            bucket: label,
            laborCostCents,
            revenueCents,
            laborCostPct: revenueCents > 0 ? (laborCostCents / revenueCents) * 100 : null,
          };
        });
    },
  });
}

export type EmployeeLaborSummary = {
  employeeName: string;
  roles: string;
  regularHours: number;
  overtimeHours: number;
  costCents: number;
};

export function useLaborShiftsByEmployee(range: DateRange) {
  const { data: locationIds } = useLocationIds();
  const fromIso = isoDate(range.from);
  const toIso = isoDate(range.to);

  return useQuery({
    queryKey: ["labor-by-employee", locationIds, fromIso, toIso],
    enabled: !!locationIds && locationIds.length > 0,
    queryFn: async (): Promise<EmployeeLaborSummary[]> => {
      const rows = await fetchAllRows((from, to) =>
        supabase
          .from("labor_shifts")
          .select("employee_name, job_title, regular_hours, overtime_hours, labor_cost_cents")
          .in("location_id", locationIds!)
          .gte("business_date", fromIso)
          .lte("business_date", toIso)
          .range(from, to),
      );

      const byEmployee = new Map<
        string,
        { roles: Set<string>; regularHours: number; overtimeHours: number; costCents: number }
      >();
      for (const r of rows) {
        const cur = byEmployee.get(r.employee_name) ?? {
          roles: new Set<string>(),
          regularHours: 0,
          overtimeHours: 0,
          costCents: 0,
        };
        if (r.job_title) cur.roles.add(r.job_title);
        cur.regularHours += Number(r.regular_hours);
        cur.overtimeHours += Number(r.overtime_hours);
        cur.costCents += Number(r.labor_cost_cents);
        byEmployee.set(r.employee_name, cur);
      }

      return Array.from(byEmployee.entries())
        .map(([employeeName, v]) => ({
          employeeName,
          roles: v.roles.size > 0 ? Array.from(v.roles).join(", ") : "—",
          regularHours: v.regularHours,
          overtimeHours: v.overtimeHours,
          costCents: v.costCents,
        }))
        .sort((a, b) => b.costCents - a.costCents);
    },
  });
}
