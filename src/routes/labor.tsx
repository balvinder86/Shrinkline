import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock3, DollarSign, TimerReset, Wallet } from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { useDateRange } from "@/lib/date-range-context";
import { formatDateRange } from "@/lib/date-range";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useLaborCostSummary,
  useLaborCostByRole,
  useLaborCostTrend,
  useLaborShiftsByEmployee,
} from "@/lib/labor/queries";

export const Route = createFileRoute("/labor")({
  head: () => ({
    meta: [
      { title: "Labor Cost · Thrasher's Pub" },
      {
        name: "description",
        content: "Real labor cost, hours, and overtime pulled from Toast time entries and wages.",
      },
    ],
  }),
  component: LaborPage,
});

function formatMoney(n: number, opts: { compact?: boolean } = {}) {
  if (opts.compact && n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatHours(h: number) {
  return `${h.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`;
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
      {hint && <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function LaborPage() {
  const { dateRange: globalDateRange } = useDateRange();
  const rangeLabel = useMemo(() => formatDateRange(globalDateRange), [globalDateRange]);

  const { data: summary, isLoading: isSummaryLoading } = useLaborCostSummary(globalDateRange);
  const { data: byRole = [], isLoading: isRoleLoading } = useLaborCostByRole(globalDateRange);
  const { data: trend = [], isLoading: isTrendLoading } = useLaborCostTrend(globalDateRange);
  const { data: byEmployee = [], isLoading: isEmployeeLoading } = useLaborShiftsByEmployee(globalDateRange);

  const totalHours = (summary?.regularHours ?? 0) + (summary?.overtimeHours ?? 0);

  return (
    <>
      <Topbar eyebrow="Financials" title="Labor Cost" />
      <main className="space-y-6 px-6 py-6">
        {/* KPI row */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPI
            label="Total labor cost"
            value={isSummaryLoading ? "—" : formatMoney((summary?.laborCostCents ?? 0) / 100, { compact: true })}
            hint={
              summary && summary.liveShiftCount > 0
                ? `${rangeLabel} · includes ${summary.liveShiftCount} live shift${summary.liveShiftCount === 1 ? "" : "s"} still clocked in`
                : rangeLabel
            }
            icon={Wallet}
          />
          <KPI
            label="Labor cost · % of revenue"
            value={
              isSummaryLoading
                ? "—"
                : summary?.laborCostPct == null
                  ? "N/A"
                  : `${summary.laborCostPct.toFixed(1)}%`
            }
            hint={summary?.laborCostPct == null ? "no sales recorded in this period" : "of net sales"}
            icon={DollarSign}
            tone={
              summary?.laborCostPct != null && summary.laborCostPct > 35
                ? "warning"
                : summary?.laborCostPct != null
                  ? "success"
                  : "default"
            }
          />
          <KPI
            label="Total hours"
            value={isSummaryLoading ? "—" : formatHours(totalHours)}
            hint={
              summary && summary.liveShiftCount > 0
                ? "regular + overtime, live shifts estimated to now"
                : "regular + overtime"
            }
            icon={Clock3}
          />
          <KPI
            label="Overtime hours"
            value={isSummaryLoading ? "—" : formatHours(summary?.overtimeHours ?? 0)}
            hint={
              totalHours > 0
                ? `${(((summary?.overtimeHours ?? 0) / totalHours) * 100).toFixed(1)}% of hours worked`
                : "no shifts in this period"
            }
            icon={TimerReset}
            tone={(summary?.overtimeHours ?? 0) > 0 ? "warning" : "default"}
          />
        </div>

        {/* Trend + by-role row */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Trend</div>
            <h3 className="mt-1 font-display text-xl">Labor cost over time</h3>
            {isTrendLoading ? (
              <div className="mt-4 flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                Loading real shift history…
              </div>
            ) : trend.length === 0 ? (
              <div className="mt-4 flex h-[280px] items-center justify-center rounded-xl border border-dashed text-center text-sm text-muted-foreground">
                No labor shifts synced from Toast in {rangeLabel} yet.
              </div>
            ) : (
              <div className="mt-4 h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--background)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value: number, name: string, item) => {
                        if (name === "laborCostPct") {
                          const point = item?.payload as (typeof trend)[number] | undefined;
                          return [
                            `${value.toFixed(1)}% · ${formatMoney((point?.laborCostCents ?? 0) / 100, { compact: true })}`,
                            "Labor cost",
                          ];
                        }
                        return [value, name];
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="laborCostPct"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">By role</div>
            <h3 className="mt-1 font-display text-xl">Where labor $ goes</h3>
            {isRoleLoading ? (
              <div className="mt-4 flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : byRole.length === 0 ? (
              <div className="mt-4 flex h-[220px] items-center justify-center rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                No shifts synced yet.
              </div>
            ) : (
              <div className="mt-4 h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byRole} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatMoney(v / 100, { compact: true })} />
                    <YAxis type="category" dataKey="role" tick={{ fontSize: 11 }} width={90} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--background)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(v: number) => formatMoney(v / 100)}
                    />
                    <Bar dataKey="costCents" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </div>

        {/* Per-employee table */}
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">By employee</div>
          <h3 className="mt-1 font-display text-xl">Real hours &amp; cost, {rangeLabel}</h3>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Employee</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Regular hours</TableHead>
                  <TableHead className="text-right">Overtime hours</TableHead>
                  <TableHead className="text-right">Labor cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isEmployeeLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      Loading real shift history…
                    </TableCell>
                  </TableRow>
                ) : byEmployee.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      No labor shifts synced from Toast in {rangeLabel} yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  byEmployee.map((e) => (
                    <TableRow key={e.employeeName}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-2">
                          {e.employeeName}
                          {e.onShift && (
                            <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                              On shift
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{e.roles}</TableCell>
                      <TableCell className="text-right">
                        {formatHours(e.regularHours)}
                        {e.onShift && <span className="ml-1 text-xs text-muted-foreground">(so far)</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.overtimeHours > 0 ? (
                          <span className="text-amber-700">{formatHours(e.overtimeHours)}</span>
                        ) : (
                          formatHours(e.overtimeHours)
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(e.costCents / 100)}
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
