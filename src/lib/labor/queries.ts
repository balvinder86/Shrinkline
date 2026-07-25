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

type OpenShiftRow = {
  regular_hours: number;
  overtime_hours: number;
  labor_cost_cents: number;
  in_at: string;
  out_at: string | null;
  wage_cents: number;
};

// Toast doesn't compute regular_hours/labor_cost_cents until an
// employee clocks out — a shift still open at sync time is stored as
// literal 0/0/$0, which understates real totals any time someone is
// actively on shift. Rather than show a silently-wrong zero for a
// person who is, right now, really being paid, estimate their
// hours/cost so far from the clock-in time and their real resolved
// wage (the same wage_cents already verified against Toast's own
// per-entry hourlyWage) — no overtime multiplier, since Toast hasn't
// determined OT status for an open shift yet.
function effectiveHoursAndCost(
  row: OpenShiftRow,
  nowMs: number,
): { hours: number; costCents: number; onShift: boolean } {
  if (row.out_at) {
    return {
      hours: Number(row.regular_hours) + Number(row.overtime_hours),
      costCents: Number(row.labor_cost_cents),
      onShift: false,
    };
  }
  const elapsedHours = Math.max(0, (nowMs - new Date(row.in_at).getTime()) / 3_600_000);
  return {
    hours: elapsedHours,
    costCents: Math.round(elapsedHours * Number(row.wage_cents)),
    onShift: true,
  };
}

export type LaborCostSummary = {
  laborCostCents: number;
  regularHours: number;
  overtimeHours: number;
  revenueCents: number;
  // null (not 0) when there's no real revenue in range yet — a
  // fabricated 0% would read as "labor is free," not "no data."
  laborCostPct: number | null;
  // Employees currently clocked in, whose hours/cost above are a live
  // estimate (elapsed time × wage), not Toast's final computed value.
  liveShiftCount: number;
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
            .select("regular_hours, overtime_hours, labor_cost_cents, in_at, out_at, wage_cents")
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

      const nowMs = Date.now();
      let laborCostCents = 0;
      let regularHours = 0;
      let overtimeHours = 0;
      let liveShiftCount = 0;
      for (const r of laborRows) {
        const eff = effectiveHoursAndCost(r, nowMs);
        laborCostCents += eff.costCents;
        if (eff.onShift) {
          regularHours += eff.hours;
          liveShiftCount += 1;
        } else {
          regularHours += Number(r.regular_hours);
          overtimeHours += Number(r.overtime_hours);
        }
      }
      let revenueCents = 0;
      for (const r of salesRows) revenueCents += Number(r.net_sales_cents);

      return {
        laborCostCents,
        regularHours,
        overtimeHours,
        revenueCents,
        laborCostPct: revenueCents > 0 ? (laborCostCents / revenueCents) * 100 : null,
        liveShiftCount,
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
          .select("job_title, regular_hours, overtime_hours, labor_cost_cents, in_at, out_at, wage_cents")
          .in("location_id", locationIds!)
          .gte("business_date", fromIso)
          .lte("business_date", toIso)
          .range(from, to),
      );

      const nowMs = Date.now();
      const byRole = new Map<string, { costCents: number; hours: number }>();
      for (const r of rows) {
        const role = r.job_title ?? "Unassigned role";
        const eff = effectiveHoursAndCost(r, nowMs);
        const cur = byRole.get(role) ?? { costCents: 0, hours: 0 };
        cur.costCents += eff.costCents;
        cur.hours += eff.hours;
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
            .select("business_date, labor_cost_cents, in_at, out_at, wage_cents, regular_hours, overtime_hours")
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

      const nowMs = Date.now();
      const laborByBucket = new Map<string, number>();
      for (const r of laborRows) {
        const key = bucketKeyFor(r.business_date);
        const eff = effectiveHoursAndCost(r, nowMs);
        laborByBucket.set(key, (laborByBucket.get(key) ?? 0) + eff.costCents);
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
  // True if any of this employee's shifts in range is still clocked
  // in — their hours/cost are a live estimate, not Toast's final
  // computed value yet.
  onShift: boolean;
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
          .select(
            "employee_name, job_title, regular_hours, overtime_hours, labor_cost_cents, in_at, out_at, wage_cents",
          )
          .in("location_id", locationIds!)
          .gte("business_date", fromIso)
          .lte("business_date", toIso)
          .range(from, to),
      );

      const nowMs = Date.now();
      const byEmployee = new Map<
        string,
        { roles: Set<string>; regularHours: number; overtimeHours: number; costCents: number; onShift: boolean }
      >();
      for (const r of rows) {
        const cur = byEmployee.get(r.employee_name) ?? {
          roles: new Set<string>(),
          regularHours: 0,
          overtimeHours: 0,
          costCents: 0,
          onShift: false,
        };
        if (r.job_title) cur.roles.add(r.job_title);
        const eff = effectiveHoursAndCost(r, nowMs);
        cur.costCents += eff.costCents;
        if (eff.onShift) {
          cur.regularHours += eff.hours;
          cur.onShift = true;
        } else {
          cur.regularHours += Number(r.regular_hours);
          cur.overtimeHours += Number(r.overtime_hours);
        }
        byEmployee.set(r.employee_name, cur);
      }

      return Array.from(byEmployee.entries())
        .map(([employeeName, v]) => ({
          employeeName,
          roles: v.roles.size > 0 ? Array.from(v.roles).join(", ") : "—",
          regularHours: v.regularHours,
          overtimeHours: v.overtimeHours,
          costCents: v.costCents,
          onShift: v.onShift,
        }))
        .sort((a, b) => b.costCents - a.costCents);
    },
  });
}
