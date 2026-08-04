import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Copy,
  Send,
  Plus,
  Filter,
  Users,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Clock,
  Sparkles,
  Check,
  X,
  Repeat,
  MessageSquare,
  FileText,
  ClipboardList,
  CalendarDays,
  ChefHat,
  Wine,
  UtensilsCrossed,
  Hammer,
  Coffee,
  MoreHorizontal,
  Sun,
  Moon,
} from "lucide-react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Line, LineChart, Legend,
} from "recharts";

export const Route = createFileRoute("/scheduling")({
  head: () => ({ meta: [{ title: "Scheduling · Thrasher's Pub" }] }),
  component: SchedulingPage,
});

/* ---------------- mock data ---------------- */

const departments = [
  { id: "foh", name: "Front of House", icon: Wine, color: "bg-primary/10 text-primary border-primary/30" },
  { id: "boh", name: "Back of House", icon: ChefHat, color: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  { id: "bar", name: "Bar", icon: Coffee, color: "bg-emerald-600/10 text-emerald-700 border-emerald-600/30" },
  { id: "mgmt", name: "Management", icon: Hammer, color: "bg-violet-500/10 text-violet-700 border-violet-500/30" },
];

const roles: Record<string, string[]> = {
  foh: ["Server", "Host", "Busser", "Runner"],
  boh: ["Line Cook", "Prep", "Dishwasher", "Sous Chef"],
  bar: ["Bartender", "Barback"],
  mgmt: ["Manager", "Shift Lead"],
};

type Shift = {
  id: string;
  day: number;
  start: string;
  end: string;
  role: string;
  dept: string;
  note?: string;
  published?: boolean;
  conflict?: "overtime" | "availability" | "minor";
};

type Employee = {
  id: string;
  name: string;
  initials: string;
  primary: string;
  dept: string;
  wage: number;
  weeklyHours: number;
  status?: "available" | "off" | "limited";
  shifts: Shift[];
};

const days = ["Mon 6/29", "Tue 6/30", "Wed 7/1", "Thu 7/2", "Fri 7/3", "Sat 7/4", "Sun 7/5"];

const mkShift = (day: number, start: string, end: string, role: string, dept: string, extra?: Partial<Shift>): Shift => ({
  id: `s-${day}-${start}-${role}-${Math.random().toString(36).slice(2, 6)}`,
  day, start, end, role, dept, published: true, ...extra,
});

const employees: Employee[] = [
  {
    id: "e1", name: "Lia Karras", initials: "LK", primary: "Server", dept: "foh", wage: 16, weeklyHours: 32,
    shifts: [
      mkShift(0, "16:00", "23:00", "Server", "foh"),
      mkShift(2, "16:00", "23:00", "Server", "foh"),
      mkShift(4, "15:00", "23:30", "Server", "foh"),
      mkShift(5, "15:00", "23:30", "Server", "foh", { conflict: "overtime" }),
    ],
  },
  {
    id: "e2", name: "Marcus Reed", initials: "MR", primary: "Bartender", dept: "bar", wage: 18, weeklyHours: 36,
    shifts: [
      mkShift(1, "17:00", "01:00", "Bartender", "bar"),
      mkShift(3, "17:00", "01:00", "Bartender", "bar"),
      mkShift(4, "16:00", "02:00", "Bartender", "bar"),
      mkShift(5, "16:00", "02:00", "Bartender", "bar"),
    ],
  },
  {
    id: "e3", name: "Priya Shah", initials: "PS", primary: "Server", dept: "foh", wage: 16, weeklyHours: 24,
    shifts: [
      mkShift(0, "11:00", "16:00", "Server", "foh"),
      mkShift(1, "11:00", "16:00", "Server", "foh"),
      mkShift(5, "10:00", "16:00", "Server", "foh"),
    ],
  },
  {
    id: "e4", name: "Diego Alvarez", initials: "DA", primary: "Line Cook", dept: "boh", wage: 22, weeklyHours: 38,
    shifts: [
      mkShift(0, "14:00", "23:00", "Line Cook", "boh"),
      mkShift(1, "14:00", "23:00", "Line Cook", "boh"),
      mkShift(3, "14:00", "23:00", "Line Cook", "boh"),
      mkShift(4, "13:00", "00:00", "Line Cook", "boh"),
      mkShift(5, "13:00", "00:00", "Line Cook", "boh"),
    ],
  },
  {
    id: "e5", name: "Sam O'Neil", initials: "SO", primary: "Sous Chef", dept: "boh", wage: 28, weeklyHours: 40,
    shifts: [
      mkShift(0, "12:00", "22:00", "Sous Chef", "boh"),
      mkShift(2, "12:00", "22:00", "Sous Chef", "boh"),
      mkShift(4, "12:00", "23:00", "Sous Chef", "boh"),
      mkShift(5, "12:00", "23:00", "Sous Chef", "boh"),
      mkShift(6, "11:00", "20:00", "Sous Chef", "boh"),
    ],
  },
  {
    id: "e6", name: "Hana Park", initials: "HP", primary: "Host", dept: "foh", wage: 15, weeklyHours: 20, status: "limited",
    shifts: [
      mkShift(4, "16:00", "22:00", "Host", "foh"),
      mkShift(5, "16:00", "22:00", "Host", "foh"),
      mkShift(6, "10:00", "16:00", "Host", "foh"),
    ],
  },
  {
    id: "e7", name: "Jordan Pike", initials: "JP", primary: "Barback", dept: "bar", wage: 14, weeklyHours: 22,
    shifts: [
      mkShift(3, "18:00", "00:00", "Barback", "bar", { conflict: "availability" }),
      mkShift(4, "17:00", "01:00", "Barback", "bar"),
      mkShift(5, "17:00", "01:00", "Barback", "bar"),
    ],
  },
  {
    id: "e8", name: "Eli Brooks", initials: "EB", primary: "Prep", dept: "boh", wage: 17, weeklyHours: 28,
    shifts: [
      mkShift(0, "08:00", "15:00", "Prep", "boh"),
      mkShift(1, "08:00", "15:00", "Prep", "boh"),
      mkShift(2, "08:00", "15:00", "Prep", "boh"),
      mkShift(4, "08:00", "15:00", "Prep", "boh"),
    ],
  },
  {
    id: "e9", name: "Nora Veil", initials: "NV", primary: "Manager", dept: "mgmt", wage: 32, weeklyHours: 40,
    shifts: [
      mkShift(0, "10:00", "19:00", "Manager", "mgmt"),
      mkShift(1, "10:00", "19:00", "Manager", "mgmt"),
      mkShift(3, "14:00", "23:00", "Manager", "mgmt"),
      mkShift(4, "14:00", "23:00", "Manager", "mgmt"),
      mkShift(5, "14:00", "23:00", "Manager", "mgmt"),
    ],
  },
  {
    id: "e10", name: "Tomás Ríos", initials: "TR", primary: "Dishwasher", dept: "boh", wage: 15, weeklyHours: 30,
    shifts: [
      mkShift(2, "17:00", "00:00", "Dishwasher", "boh"),
      mkShift(3, "17:00", "00:00", "Dishwasher", "boh"),
      mkShift(4, "17:00", "01:00", "Dishwasher", "boh"),
      mkShift(5, "17:00", "01:00", "Dishwasher", "boh"),
    ],
  },
];

const forecastData = days.map((d, i) => {
  const sales = [3200, 2800, 3000, 3400, 6200, 7100, 4200][i];
  const labor = [820, 760, 790, 870, 1340, 1480, 980][i];
  return { day: d.split(" ")[0], sales, labor, target: Math.round(sales * 0.26), pct: Math.round((labor / sales) * 100) };
});

const hourlyForecast = Array.from({ length: 14 }, (_, i) => {
  const hour = 10 + i;
  const covers = [12, 22, 38, 32, 18, 14, 22, 48, 72, 88, 76, 54, 32, 14][i];
  const needed = Math.max(2, Math.round(covers / 9));
  const scheduled = Math.max(2, needed + (i % 3 === 0 ? -1 : i % 4 === 0 ? 1 : 0));
  return { hour: `${hour}:00`, covers, needed, scheduled };
});

const timeOff = [
  { id: 1, name: "Lia Karras", initials: "LK", type: "Vacation", dates: "Jul 14 – Jul 20", submitted: "2d ago", status: "pending" },
  { id: 2, name: "Diego Alvarez", initials: "DA", type: "Sick", dates: "Jul 2", submitted: "today", status: "pending" },
  { id: 3, name: "Hana Park", initials: "HP", type: "Personal", dates: "Jul 5 – Jul 6", submitted: "5d ago", status: "approved" },
];

const trades = [
  { id: 1, from: "Jordan Pike", to: "Marcus Reed", shift: "Thu 7/2 · Barback · 18:00–00:00", reason: "Doctor's appointment", status: "needs approval" },
  { id: 2, from: "Priya Shah", to: "Open", shift: "Sun 7/5 · Server · 10:00–16:00", reason: "Family event", status: "open offer" },
];

const templates = [
  { id: 1, name: "Standard Summer Week", desc: "Weekday lean, Fri/Sat double-staffed bar", shifts: 58, hours: 412 },
  { id: 2, name: "Holiday Weekend", desc: "Patio open, +2 servers + 1 barback", shifts: 64, hours: 472 },
  { id: 3, name: "Slow Winter", desc: "Single dishwasher, no brunch host", shifts: 44, hours: 320 },
];

/* ---------------- helpers ---------------- */

const fmtTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "p" : "a";
  const hh = ((h + 11) % 12) + 1;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ampm}` : `${hh}${ampm}`;
};

const shiftDuration = (s: string, e: string) => {
  const [sh, sm] = s.split(":").map(Number);
  const [eh, em] = e.split(":").map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) mins += 24 * 60;
  return mins / 60;
};

/* ---------------- page ---------------- */

function SchedulingPage() {
  const [activeDepts, setActiveDepts] = useState<string[]>(["foh", "boh", "bar", "mgmt"]);
  const [openShift, setOpenShift] = useState<{ emp: Employee; shift: Shift } | null>(null);
  const [view, setView] = useState<"week" | "day">("week");

  const visibleEmployees = useMemo(
    () => employees.filter((e) => activeDepts.includes(e.dept)),
    [activeDepts]
  );

  const totals = useMemo(() => {
    let hours = 0; let cost = 0; let shifts = 0;
    visibleEmployees.forEach((e) => {
      e.shifts.forEach((s) => {
        const d = shiftDuration(s.start, s.end);
        hours += d;
        cost += d * e.wage;
        shifts += 1;
      });
    });
    const sales = forecastData.reduce((a, b) => a + b.sales, 0);
    return { hours, cost, shifts, sales, pct: (cost / sales) * 100 };
  }, [visibleEmployees]);

  const toggleDept = (id: string) =>
    setActiveDepts((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <>
      <Topbar eyebrow="Operations" title="Scheduling" />
      <div className="space-y-6 px-6 py-6">
        {/* KPI strip */}
        <div className="grid gap-4 md:grid-cols-4">
          <KPI icon={Clock} label="Scheduled hours" value={`${totals.hours.toFixed(0)} h`} hint="vs 432 forecast"
               accent="text-foreground" />
          <KPI icon={DollarSign} label="Projected labor" value={`$${totals.cost.toFixed(0)}`} hint={`${totals.pct.toFixed(1)}% of sales`}
               accent={totals.pct > 28 ? "text-rose-600" : "text-emerald-600"} />
          <KPI icon={Users} label="Open shifts" value="3" hint="Sat 7/4 needs cover" accent="text-amber-600" />
          <KPI icon={AlertTriangle} label="Conflicts" value="2" hint="1 overtime · 1 availability" accent="text-rose-600" />
        </div>

        {/* AI assistant strip */}
        <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-amber-500/5 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="font-display text-lg leading-tight">AI Scheduler suggestions</div>
                <p className="text-sm text-muted-foreground">
                  Friday covers forecast up 18%. Add a second bartender 6–11p and pull Priya from Mon 11–4 to keep labor at 26%.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="rounded-full">Auto-fill open shifts</Button>
              <Button size="sm" variant="outline" className="rounded-full">Optimize for labor target</Button>
              <Button size="sm" className="rounded-full">Apply all (3)</Button>
            </div>
          </div>
        </Card>

        <Tabs defaultValue="schedule" className="space-y-4">
          <TabsList className="h-auto flex-wrap gap-1 bg-muted/60 p-1">
            <TabsTrigger value="schedule" className="gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Schedule</TabsTrigger>
            <TabsTrigger value="forecast" className="gap-1.5"><TrendingUp className="h-3.5 w-3.5" />Forecast & Labor</TabsTrigger>
            <TabsTrigger value="timeoff" className="gap-1.5"><Sun className="h-3.5 w-3.5" />Time off</TabsTrigger>
            <TabsTrigger value="availability" className="gap-1.5"><Clock className="h-3.5 w-3.5" />Availability</TabsTrigger>
            <TabsTrigger value="trades" className="gap-1.5"><Repeat className="h-3.5 w-3.5" />Trades</TabsTrigger>
            <TabsTrigger value="templates" className="gap-1.5"><Copy className="h-3.5 w-3.5" />Templates</TabsTrigger>
            <TabsTrigger value="timesheets" className="gap-1.5"><FileText className="h-3.5 w-3.5" />Timesheets</TabsTrigger>
            <TabsTrigger value="logbook" className="gap-1.5"><ClipboardList className="h-3.5 w-3.5" />Logbook</TabsTrigger>
          </TabsList>

          {/* SCHEDULE */}
          <TabsContent value="schedule" className="space-y-4">
            {/* Toolbar */}
            <Card className="p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronLeft className="h-4 w-4" /></Button>
                  <div className="px-2 font-display text-sm">Jun 29 – Jul 5, 2026</div>
                  <Button variant="ghost" size="icon" className="h-8 w-8"><ChevronRight className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" className="ml-2 rounded-full">Today</Button>
                </div>
                <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
                  {(["week", "day"] as const).map((v) => (
                    <button key={v} onClick={() => setView(v)}
                            className={`rounded-md px-3 py-1 text-xs capitalize ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                      {v}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {departments.map((d) => {
                    const on = activeDepts.includes(d.id);
                    const Icon = d.icon;
                    return (
                      <button key={d.id} onClick={() => toggleDept(d.id)}
                              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${on ? d.color : "border-border bg-card text-muted-foreground opacity-60"}`}>
                        <Icon className="h-3.5 w-3.5" />
                        {d.name}
                      </button>
                    );
                  })}
                  <div className="mx-1 h-6 w-px bg-border" />
                  <Button variant="outline" size="sm" className="gap-1.5"><Filter className="h-3.5 w-3.5" />Filters</Button>
                  <Button variant="outline" size="sm" className="gap-1.5"><Copy className="h-3.5 w-3.5" />Copy week</Button>
                  <Button size="sm" className="gap-1.5"><Send className="h-3.5 w-3.5" />Publish · 3 unpublished</Button>
                </div>
              </div>
            </Card>

            {/* Grid */}
            <Card className="overflow-hidden p-0">
              <div className="grid grid-cols-[220px_repeat(7,minmax(140px,1fr))] border-b border-border bg-muted/40 text-xs">
                <div className="px-3 py-2 font-medium text-muted-foreground">Team · {visibleEmployees.length}</div>
                {days.map((d, i) => {
                  const fc = forecastData[i];
                  return (
                    <div key={d} className="border-l border-border px-3 py-2">
                      <div className="font-medium">{d}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>${(fc.sales / 1000).toFixed(1)}k fcst</span>
                        <span className={fc.pct > 28 ? "text-rose-600" : "text-emerald-600"}>{fc.pct}% labor</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Open shifts row */}
              <div className="grid grid-cols-[220px_repeat(7,minmax(140px,1fr))] border-b border-dashed border-border bg-amber-50/50">
                <div className="flex items-center gap-2 px-3 py-3">
                  <div className="grid h-8 w-8 place-items-center rounded-full border-2 border-dashed border-amber-500/50 text-amber-700">
                    <Plus className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-medium">Open shifts</div>
                    <div className="text-[10px] text-muted-foreground">Claim or assign</div>
                  </div>
                </div>
                {days.map((d, i) => (
                  <div key={d} className="min-h-[56px] border-l border-border p-1.5">
                    {i === 5 && (
                      <ShiftBlock label="Server · 16–23" tone="open" />
                    )}
                    {i === 5 && (
                      <ShiftBlock label="Busser · 17–23" tone="open" />
                    )}
                    {i === 4 && <ShiftBlock label="Runner · 18–00" tone="open" />}
                  </div>
                ))}
              </div>

              {/* Employee rows */}
              {visibleEmployees.map((emp) => {
                const dept = departments.find((d) => d.id === emp.dept)!;
                const totalH = emp.shifts.reduce((a, s) => a + shiftDuration(s.start, s.end), 0);
                const over = totalH > 40;
                return (
                  <div key={emp.id} className="grid grid-cols-[220px_repeat(7,minmax(140px,1fr))] border-b border-border hover:bg-muted/20">
                    <div className="flex items-center gap-2.5 px-3 py-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-accent text-xs">{emp.initials}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{emp.name}</div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className={`rounded px-1 py-0.5 ${dept.color}`}>{emp.primary}</span>
                          <span className={over ? "font-medium text-rose-600" : ""}>{totalH.toFixed(1)}h</span>
                        </div>
                      </div>
                    </div>
                    {days.map((_, i) => {
                      const shifts = emp.shifts.filter((s) => s.day === i);
                      return (
                        <div key={i} className="min-h-[56px] border-l border-border p-1.5">
                          {shifts.map((s) => (
                            <button key={s.id} onClick={() => setOpenShift({ emp, shift: s })} className="block w-full text-left">
                              <ShiftBlock
                                label={`${fmtTime(s.start)}–${fmtTime(s.end)}`}
                                sub={s.role}
                                tone={s.conflict ? "warn" : dept.id as any}
                                conflict={s.conflict}
                              />
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* Footer totals */}
              <div className="grid grid-cols-[220px_repeat(7,minmax(140px,1fr))] bg-muted/40 text-xs">
                <div className="px-3 py-2.5 font-medium">Daily totals</div>
                {days.map((d, i) => {
                  const dayShifts = visibleEmployees.flatMap((e) => e.shifts.filter((s) => s.day === i).map((s) => ({ s, wage: e.wage })));
                  const h = dayShifts.reduce((a, x) => a + shiftDuration(x.s.start, x.s.end), 0);
                  const c = dayShifts.reduce((a, x) => a + shiftDuration(x.s.start, x.s.end) * x.wage, 0);
                  const fc = forecastData[i];
                  const pct = (c / fc.sales) * 100;
                  return (
                    <div key={d} className="border-l border-border px-3 py-2.5">
                      <div className="font-medium">{h.toFixed(1)}h · ${c.toFixed(0)}</div>
                      <div className={`text-[10px] ${pct > 28 ? "text-rose-600" : "text-emerald-600"}`}>
                        {pct.toFixed(1)}% labor
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </TabsContent>

          {/* FORECAST */}
          <TabsContent value="forecast" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-5 lg:col-span-2">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <div className="font-display text-base">Sales vs labor</div>
                    <div className="text-xs text-muted-foreground">Forecast (sales) plotted against projected labor cost</div>
                  </div>
                  <Badge variant="outline">Target 26%</Badge>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={forecastData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="sales" name="Forecast sales" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="labor" name="Projected labor" fill="var(--accent-foreground)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card className="p-5">
                <div className="font-display text-base">Labor budget</div>
                <div className="mt-1 text-xs text-muted-foreground">Week of Jun 29</div>
                <div className="mt-4 space-y-4">
                  <BudgetRow label="Front of House" used={3120} budget={3800} />
                  <BudgetRow label="Back of House" used={4980} budget={5200} />
                  <BudgetRow label="Bar" used={2240} budget={2400} />
                  <BudgetRow label="Management" used={1280} budget={1400} />
                </div>
                <div className="mt-5 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total projected</span>
                    <span className="font-medium">$11,620</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Budget</span>
                    <span className="font-medium">$12,800</span>
                  </div>
                </div>
              </Card>
            </div>

            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-display text-base">Hourly demand vs coverage · Friday 7/3</div>
                  <div className="text-xs text-muted-foreground">Covers forecast and scheduled headcount per hour</div>
                </div>
                <div className="flex gap-2 text-xs">
                  <Badge className="bg-primary/10 text-primary">Forecast covers</Badge>
                  <Badge variant="outline">Needed</Badge>
                  <Badge variant="outline">Scheduled</Badge>
                </div>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourlyForecast}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="covers" stroke="var(--primary)" strokeWidth={2} />
                    <Line type="monotone" dataKey="needed" stroke="#d97706" strokeWidth={2} />
                    <Line type="monotone" dataKey="scheduled" stroke="var(--muted-foreground)" strokeWidth={2} strokeDasharray="4 4" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </TabsContent>

          {/* TIME OFF */}
          <TabsContent value="timeoff" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <KPI icon={Sun} label="Pending requests" value="2" hint="Avg 6h to respond" accent="text-amber-600" />
              <KPI icon={Check} label="Approved this month" value="9" hint="14 days off total" accent="text-emerald-600" />
              <KPI icon={Moon} label="Blackout dates" value="3" hint="Jul 4 · Aug 30 · Dec 31" />
            </div>
            <Card className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timeOff.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{r.initials}</AvatarFallback></Avatar>
                          <span className="font-medium">{r.name}</span>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                      <TableCell className="text-sm">{r.dates}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.submitted}</TableCell>
                      <TableCell>
                        <Badge className={r.status === "approved" ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {r.status === "pending" ? (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-7 gap-1"><X className="h-3 w-3" />Deny</Button>
                            <Button size="sm" className="h-7 gap-1"><Check className="h-3 w-3" />Approve</Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-7"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* AVAILABILITY */}
          <TabsContent value="availability" className="space-y-4">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="font-display text-base">Team availability</div>
                  <div className="text-xs text-muted-foreground">Recurring weekly availability submitted by staff</div>
                </div>
                <Button size="sm" variant="outline">Request updates</Button>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[200px_repeat(7,1fr)] border-b border-border bg-muted/40 text-xs">
                  <div className="px-3 py-2 font-medium">Employee</div>
                  {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
                    <div key={d} className="border-l border-border px-3 py-2 text-center font-medium">{d}</div>
                  ))}
                </div>
                {employees.slice(0,6).map((e) => (
                  <div key={e.id} className="grid grid-cols-[200px_repeat(7,1fr)] border-b border-border text-xs">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <Avatar className="h-6 w-6"><AvatarFallback className="text-[10px]">{e.initials}</AvatarFallback></Avatar>
                      <span className="font-medium">{e.name}</span>
                    </div>
                    {[0,1,2,3,4,5,6].map((d) => {
                      const states = ["Any","Eves","Any","Off","Any","Any","AM only"];
                      const s = states[(d + e.id.charCodeAt(1)) % states.length];
                      const off = s === "Off";
                      return (
                        <div key={d} className={`border-l border-border px-3 py-2 text-center ${off ? "bg-rose-50 text-rose-700" : s === "Any" ? "text-emerald-700" : "text-foreground"}`}>
                          {s}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* TRADES */}
          <TabsContent value="trades" className="space-y-4">
            <Card className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trades.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.from}</TableCell>
                      <TableCell>{t.to}</TableCell>
                      <TableCell className="text-sm">{t.shift}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.reason}</TableCell>
                      <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="h-7 mr-1">Decline</Button>
                        <Button size="sm" className="h-7">Approve</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* TEMPLATES */}
          <TabsContent value="templates" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              {templates.map((t) => (
                <Card key={t.id} className="p-5">
                  <div className="font-display text-base">{t.name}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{t.desc}</p>
                  <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{t.shifts} shifts</span>
                    <span>·</span>
                    <span>{t.hours} hrs</span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1">Preview</Button>
                    <Button size="sm" className="flex-1">Apply to week</Button>
                  </div>
                </Card>
              ))}
              <Card className="grid place-items-center border-dashed p-5 text-center">
                <div>
                  <div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-dashed border-border text-muted-foreground">
                    <Plus className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-sm font-medium">Save current week as template</div>
                  <p className="mt-1 text-xs text-muted-foreground">Reuse this layout for future weeks</p>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* TIMESHEETS */}
          <TabsContent value="timesheets" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <KPI icon={Clock} label="Hours worked" value="412" hint="Week to date" />
              <KPI icon={DollarSign} label="Pay period total" value="$10,840" hint="Including OT" />
              <KPI icon={AlertTriangle} label="Unapproved punches" value="6" hint="Missing breaks · 2" accent="text-amber-600" />
              <KPI icon={TrendingUp} label="Tip pool" value="$2,180" hint="Distributed automatically" accent="text-emerald-600" />
            </div>
            <Card className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Clock in</TableHead>
                    <TableHead>Clock out</TableHead>
                    <TableHead>Break</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Flag</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { e: "Lia Karras", i: "LK", d: "Mon 6/29", ci: "3:58p", co: "11:14p", br: "30m", h: 6.75, f: "OK" },
                    { e: "Marcus Reed", i: "MR", d: "Mon 6/29", ci: "5:02p", co: "1:18a", br: "0m", h: 8.27, f: "Missing break" },
                    { e: "Diego Alvarez", i: "DA", d: "Mon 6/29", ci: "1:55p", co: "11:42p", br: "45m", h: 9.03, f: "OK" },
                    { e: "Sam O'Neil", i: "SO", d: "Tue 6/30", ci: "11:48a", co: "10:30p", br: "30m", h: 10.2, f: "Overtime" },
                  ].map((r, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{r.i}</AvatarFallback></Avatar>
                          <span className="font-medium">{r.e}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{r.d}</TableCell>
                      <TableCell className="text-sm">{r.ci}</TableCell>
                      <TableCell className="text-sm">{r.co}</TableCell>
                      <TableCell className="text-sm">{r.br}</TableCell>
                      <TableCell className="text-sm font-medium">{r.h}</TableCell>
                      <TableCell>
                        <Badge className={r.f === "OK" ? "bg-emerald-500/10 text-emerald-700" : r.f === "Overtime" ? "bg-rose-500/10 text-rose-700" : "bg-amber-500/10 text-amber-700"}>
                          {r.f}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" className="h-7">Approve</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* LOGBOOK */}
          <TabsContent value="logbook" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <div className="font-display text-base">Shift handover · Last night</div>
                <div className="mt-1 text-xs text-muted-foreground">Manager: Nora Veil · Closed 12:48a</div>
                <div className="mt-4 space-y-3 text-sm">
                  <LogEntry author="Nora" tag="Notes" text="Patio packed all night, walk-in compressor making clicking noise — Hammer service tomorrow 10a." />
                  <LogEntry author="Diego" tag="86" text="86 burrata, 86 short rib by 9:30p. Reordered burrata for AM delivery." />
                  <LogEntry author="Marcus" tag="Bar" text="Bourbon shelf down 6 bottles, par level reached. Counted tips: $612 pooled." />
                </div>
                <div className="mt-4 flex gap-2">
                  <Input placeholder="Add a note for the team…" />
                  <Button size="sm">Post</Button>
                </div>
              </Card>
              <Card className="p-5">
                <div className="font-display text-base">Announcements & broadcasts</div>
                <div className="mt-1 text-xs text-muted-foreground">Pushed to staff app + SMS</div>
                <div className="mt-4 space-y-3">
                  {[
                    { title: "Independence Day prep", body: "All hands 2p Friday for menu walkthrough + patio setup.", when: "2d ago" },
                    { title: "New POS pour tracking", body: "Bartenders please review the 2-min training in your inbox.", when: "5d ago" },
                  ].map((a) => (
                    <div key={a.title} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">{a.title}</div>
                        <div className="text-[11px] text-muted-foreground">{a.when}</div>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{a.body}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 gap-1.5"><MessageSquare className="h-3.5 w-3.5" />Message a group</Button>
                  <Button size="sm" className="flex-1 gap-1.5"><Send className="h-3.5 w-3.5" />New announcement</Button>
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Shift edit drawer */}
      <Sheet open={!!openShift} onOpenChange={(o) => !o && setOpenShift(null)}>
        <SheetContent className="w-full sm:max-w-lg">
          {openShift && (
            <>
              <SheetHeader>
                <SheetTitle className="font-display text-xl">Edit shift</SheetTitle>
                <SheetDescription>
                  {openShift.emp.name} · {days[openShift.shift.day]}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Start</Label>
                    <Input defaultValue={openShift.shift.start} />
                  </div>
                  <div>
                    <Label className="text-xs">End</Label>
                    <Input defaultValue={openShift.shift.end} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Role</Label>
                  <Select defaultValue={openShift.shift.role}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roles[openShift.emp.dept].map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Section / station</Label>
                  <Input placeholder="e.g. Patio 1–4, Grill" />
                </div>
                <div>
                  <Label className="text-xs">Shift note</Label>
                  <Textarea placeholder="Pre-shift reminders, section notes…" rows={3} />
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Duration</span>
                    <span className="font-medium">
                      {shiftDuration(openShift.shift.start, openShift.shift.end).toFixed(1)}h
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Projected cost</span>
                    <span className="font-medium">
                      ${(shiftDuration(openShift.shift.start, openShift.shift.end) * openShift.emp.wage).toFixed(0)}
                    </span>
                  </div>
                </div>
                {openShift.shift.conflict && (
                  <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <div className="font-medium capitalize">{openShift.shift.conflict} conflict</div>
                      <div className="opacity-80">
                        {openShift.shift.conflict === "overtime"
                          ? "This shift puts the employee over 40 weekly hours."
                          : openShift.shift.conflict === "availability"
                          ? "Employee marked this time as unavailable."
                          : "Minor labor law restriction — verify times."}
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <div className="text-sm font-medium">Repeat weekly</div>
                    <div className="text-xs text-muted-foreground">Add to future schedules automatically</div>
                  </div>
                  <Switch />
                </div>
                <div className="flex items-center justify-between gap-2 pt-2">
                  <Button variant="outline" className="gap-1.5"><X className="h-3.5 w-3.5" />Delete shift</Button>
                  <div className="flex gap-2">
                    <Button variant="outline">Save draft</Button>
                    <Button>Save & publish</Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ---------------- small components ---------------- */

function KPI({ icon: Icon, label, value, hint, accent = "text-foreground" }: any) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className={`mt-2 font-display text-2xl ${accent}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </Card>
  );
}

function ShiftBlock({
  label, sub, tone = "foh", conflict,
}: { label: string; sub?: string; tone?: "foh" | "boh" | "bar" | "mgmt" | "open" | "warn"; conflict?: string }) {
  const tones: Record<string, string> = {
    foh: "bg-primary/10 text-primary border-l-primary",
    boh: "bg-amber-500/10 text-amber-800 border-l-amber-500",
    bar: "bg-emerald-600/10 text-emerald-800 border-l-emerald-600",
    mgmt: "bg-violet-500/10 text-violet-800 border-l-violet-500",
    open: "bg-amber-100 text-amber-900 border-l-amber-500 border-dashed",
    warn: "bg-rose-500/10 text-rose-800 border-l-rose-500",
  };
  return (
    <div className={`mb-1 rounded-md border-l-4 px-2 py-1.5 text-[11px] leading-tight ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="font-medium">{label}</span>
        {conflict && <AlertTriangle className="h-3 w-3" />}
      </div>
      {sub && <div className="opacity-75">{sub}</div>}
    </div>
  );
}

function BudgetRow({ label, used, budget }: { label: string; used: number; budget: number }) {
  const pct = (used / budget) * 100;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className={pct > 95 ? "text-rose-600" : "text-muted-foreground"}>
          ${used} / ${budget}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

function LogEntry({ author, tag, text }: { author: string; tag: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-border p-3">
      <Avatar className="h-8 w-8"><AvatarFallback className="text-xs">{author[0]}</AvatarFallback></Avatar>
      <div className="flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">{author}</span>
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{tag}</Badge>
        </div>
        <div className="mt-1 text-sm text-muted-foreground">{text}</div>
      </div>
    </div>
  );
}
