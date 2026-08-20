import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Award,
  Bot,
  Coins,
  Crown,
  Gift,
  Heart,
  Mail,
  MessageCircle,
  Pencil,
  Plus,
  QrCode,
  Repeat,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  Wand2,
  Zap,
} from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/loyalty")({
  head: () => ({
    meta: [
      { title: "Loyalty · Shrinkline" },
      {
        name: "description",
        content:
          "Run Shrinkline loyalty program — tiers, rewards, point rules, referrals, and member analytics.",
      },
    ],
  }),
  component: LoyaltyPage,
});

// ---------- Mock data ----------

const KPIS = [
  { label: "Loyalty members", value: "8,412", delta: "+612", hint: "Last 30 days" },
  { label: "Repeat visit rate", value: "47%", delta: "+6.2pt", hint: "Members vs. guests" },
  { label: "Avg. check (member)", value: "$38.40", delta: "+$5.10", hint: "Guest avg $28.90" },
  { label: "Reward redemption", value: "62%", delta: "+8%", hint: "Of issued rewards" },
];

const ENROLL_SERIES = [
  { d: "Wk 1", new: 142, active: 5800, revenue: 18400 },
  { d: "Wk 2", new: 168, active: 6020, revenue: 21100 },
  { d: "Wk 3", new: 156, active: 6280, revenue: 22900 },
  { d: "Wk 4", new: 201, active: 6710, revenue: 24800 },
  { d: "Wk 5", new: 224, active: 7180, revenue: 27300 },
  { d: "Wk 6", new: 248, active: 7640, revenue: 29800 },
  { d: "Wk 7", new: 286, active: 8412, revenue: 32600 },
];

const TIER_DIST = [
  { tier: "Mug", count: 4820, color: "var(--color-muted-foreground)" },
  { tier: "Pint", count: 2380, color: "var(--color-ochre)" },
  { tier: "Stein", count: 920, color: "var(--color-terracotta)" },
  { tier: "Cask", count: 292, color: "var(--color-ink)" },
];

type Tier = {
  id: string;
  name: string;
  threshold: number;
  multiplier: number;
  perks: string[];
  color: string;
  icon: typeof Award;
};

const INITIAL_TIERS: Tier[] = [
  {
    id: "mug",
    name: "Mug",
    threshold: 0,
    multiplier: 1,
    perks: ["1 pt per $1", "Birthday pint", "Members-only menu"],
    color: "bg-muted text-foreground",
    icon: Award,
  },
  {
    id: "pint",
    name: "Pint",
    threshold: 500,
    multiplier: 1.25,
    perks: ["1.25 pts per $1", "Free app on 3rd visit", "Early access to events"],
    color: "bg-ochre/15 text-ochre",
    icon: Star,
  },
  {
    id: "stein",
    name: "Stein",
    threshold: 1500,
    multiplier: 1.5,
    perks: ["1.5 pts per $1", "Reserved bar seating", "Quarterly tasting invite"],
    color: "bg-primary/15 text-primary",
    icon: Trophy,
  },
  {
    id: "cask",
    name: "Cask",
    threshold: 4000,
    multiplier: 2,
    perks: ["2 pts per $1", "Owner's table access", "Custom barrel pour", "Concierge SMS line"],
    color: "bg-foreground text-background",
    icon: Crown,
  },
];

type Reward = {
  id: string;
  name: string;
  cost: number;
  category: "Food" | "Drink" | "Experience" | "Merch";
  tier: "All" | "Pint+" | "Stein+" | "Cask";
  redeemed: number;
  cogs: number;
  active: boolean;
};

const INITIAL_REWARDS: Reward[] = [
  { id: "r1", name: "Free pint of house lager", cost: 150, category: "Drink", tier: "All", redeemed: 412, cogs: 1.8, active: true },
  { id: "r2", name: "Wings (6pc) on the house", cost: 250, category: "Food", tier: "All", redeemed: 318, cogs: 3.4, active: true },
  { id: "r3", name: "$10 off your bill", cost: 350, category: "Food", tier: "Pint+", redeemed: 244, cogs: 10, active: true },
  { id: "r4", name: "Bottle of house wine", cost: 800, category: "Drink", tier: "Stein+", redeemed: 64, cogs: 12, active: true },
  { id: "r5", name: "Tasting flight for 2", cost: 600, category: "Experience", tier: "Pint+", redeemed: 96, cogs: 8, active: true },
  { id: "r6", name: "Thrasher's pint glass", cost: 400, category: "Merch", tier: "All", redeemed: 188, cogs: 4.5, active: true },
  { id: "r7", name: "Chef's tasting (4 courses)", cost: 2200, category: "Experience", tier: "Cask", redeemed: 12, cogs: 38, active: true },
  { id: "r8", name: "Reserved booth, Fri/Sat", cost: 900, category: "Experience", tier: "Stein+", redeemed: 41, cogs: 0, active: false },
];

type Member = {
  id: string;
  name: string;
  email: string;
  tier: "Mug" | "Pint" | "Stein" | "Cask";
  points: number;
  ytdSpend: number;
  lastVisit: string;
  visits: number;
};

const MEMBERS: Member[] = [
  { id: "m1", name: "Jordan Reyes", email: "jordan.r@gmail.com", tier: "Cask", points: 3420, ytdSpend: 4820, lastVisit: "2d ago", visits: 38 },
  { id: "m2", name: "Priya Anand", email: "priya@hey.com", tier: "Stein", points: 1840, ytdSpend: 2210, lastVisit: "4d ago", visits: 22 },
  { id: "m3", name: "Marco Bianchi", email: "marco.b@outlook.com", tier: "Stein", points: 1620, ytdSpend: 1980, lastVisit: "1w ago", visits: 19 },
  { id: "m4", name: "Sasha Klein", email: "sasha.k@gmail.com", tier: "Pint", points: 780, ytdSpend: 920, lastVisit: "3d ago", visits: 11 },
  { id: "m5", name: "Theo Nguyen", email: "theo.n@gmail.com", tier: "Pint", points: 620, ytdSpend: 740, lastVisit: "Today", visits: 9 },
  { id: "m6", name: "Amelia Park", email: "amelia.p@yahoo.com", tier: "Mug", points: 280, ytdSpend: 310, lastVisit: "2w ago", visits: 4 },
  { id: "m7", name: "Devon Ellis", email: "devon.e@gmail.com", tier: "Mug", points: 120, ytdSpend: 140, lastVisit: "1mo ago", visits: 2 },
  { id: "m8", name: "Sienna Cohen", email: "sienna.c@hey.com", tier: "Cask", points: 4280, ytdSpend: 5640, lastVisit: "Yesterday", visits: 44 },
];

type EarnRule = {
  id: string;
  name: string;
  trigger: string;
  points: number;
  active: boolean;
  hint: string;
};

const INITIAL_RULES: EarnRule[] = [
  { id: "e1", name: "Base earn", trigger: "Per $1 spent", points: 1, active: true, hint: "Applied to every order. Tier multipliers stack." },
  { id: "e2", name: "Sign-up bonus", trigger: "On enrollment", points: 100, active: true, hint: "Drives first repeat visit within 14 days." },
  { id: "e3", name: "Birthday month", trigger: "Once per year", points: 250, active: true, hint: "Auto-issued on the 1st of birth month." },
  { id: "e4", name: "Slow night boost", trigger: "Mon–Wed visit", points: 50, active: true, hint: "Encourages off-peak traffic." },
  { id: "e5", name: "Game day check-in", trigger: "Match days, in-venue", points: 75, active: true, hint: "Geo-fenced via Wi-Fi captive portal." },
  { id: "e6", name: "Leave a review", trigger: "Verified Google/Yelp review", points: 150, active: true, hint: "AI Reviews agent confirms posting." },
  { id: "e7", name: "Referral", trigger: "Friend's first visit", points: 300, active: true, hint: "Both members get points." },
];

type Campaign = {
  id: string;
  name: string;
  audience: string;
  channel: "Email" | "SMS" | "Push";
  status: "Live" | "Scheduled" | "Draft";
  reach: number;
  redeemed: number;
  revenue: number;
};

const CAMPAIGNS: Campaign[] = [
  { id: "c1", name: "Win-back: lapsed Steins", audience: "Stein · no visit 45d", channel: "Email", status: "Live", reach: 184, redeemed: 41, revenue: 3820 },
  { id: "c2", name: "Double points Tuesdays", audience: "All members", channel: "Push", status: "Live", reach: 8412, redeemed: 612, revenue: 18400 },
  { id: "c3", name: "Cask anniversary tasting", audience: "Cask tier", channel: "Email", status: "Scheduled", reach: 292, redeemed: 0, revenue: 0 },
  { id: "c4", name: "Refer-a-friend boost", audience: "Pint + Stein", channel: "SMS", status: "Draft", reach: 3300, redeemed: 0, revenue: 0 },
];

const AI_SUGGESTIONS = [
  {
    title: "Lapsed Stein members (62 people)",
    detail:
      "Avg. ticket $48, last visit 38 days ago. Send a 500-pt bonus reward valid 10 days — projected $4.8k revenue at 32% redemption.",
    icon: Repeat,
  },
  {
    title: "Almost-Stein nudge (118 Pints)",
    detail: "Within 200 pts of Stein. One trigger email when they're 1 visit away typically converts 38%.",
    icon: TrendingUp,
  },
  {
    title: "Birthday club misses",
    detail: "47 members had birthdays last week with no redemption. Auto-resend birthday pint with a 'this weekend only' CTA.",
    icon: Gift,
  },
];

// ---------- Page ----------

function LoyaltyPage() {
  const [tiers, setTiers] = useState<Tier[]>(INITIAL_TIERS);
  const [rewards, setRewards] = useState<Reward[]>(INITIAL_REWARDS);
  const [rules, setRules] = useState<EarnRule[]>(INITIAL_RULES);
  const [programName, setProgramName] = useState("Thrasher's Tap Club");
  const [programLive, setProgramLive] = useState(true);
  const [pointValue, setPointValue] = useState("0.05"); // $ per point
  const [expiry, setExpiry] = useState("12");
  const [enrollMethod, setEnrollMethod] = useState("phone");

  const totalActiveRewards = rewards.filter((r) => r.active).length;
  const liability = useMemo(() => {
    const totalPts = MEMBERS.reduce((s, m) => s + m.points, 0) * 1.4; // scale to "full base"
    return Math.round(totalPts * Number(pointValue));
  }, [pointValue]);

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar title="Loyalty" eyebrow="Growth" />

      <main className="space-y-6 px-6 py-6">
        {/* Program header card */}
        <Card className="overflow-hidden border-border/70">
          <div className="grid gap-0 md:grid-cols-[1.4fr_1fr]">
            <div className="space-y-4 p-6">
              <div className="flex items-center gap-2">
                <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                  <Heart className="mr-1 h-3 w-3" /> {programLive ? "Live" : "Paused"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Launched Jan 2024 · 14 month run-rate
                </span>
              </div>
              <div>
                <h2 className="font-display text-3xl leading-tight">{programName}</h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Points-based loyalty with four tiers, automated rewards, and AI-targeted
                  win-back. Members visit 1.8× more often and spend 33% more per check.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" className="rounded-full gap-2">
                  <Wand2 className="h-4 w-4" /> Launch AI campaign
                </Button>
                <Button size="sm" variant="outline" className="rounded-full gap-2">
                  <QrCode className="h-4 w-4" /> In-venue sign-up QR
                </Button>
                <Button size="sm" variant="outline" className="rounded-full gap-2">
                  <Pencil className="h-4 w-4" /> Edit program
                </Button>
                <div className="ml-auto flex items-center gap-2 text-sm">
                  <Label htmlFor="live" className="text-muted-foreground">
                    Program live
                  </Label>
                  <Switch id="live" checked={programLive} onCheckedChange={setProgramLive} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-border/60 md:border-l">
              {[
                { label: "Active rewards", value: totalActiveRewards, icon: Gift },
                { label: "Outstanding liability", value: `$${liability.toLocaleString()}`, icon: Wallet },
                { label: "Points / $1", value: "1.0×", icon: Coins },
                { label: "Avg. redemption", value: "11 days", icon: Repeat },
              ].map((s) => (
                <div key={s.label} className="bg-card p-4">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <s.icon className="h-3.5 w-3.5" /> {s.label}
                  </div>
                  <div className="mt-1 font-display text-xl">{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {KPIS.map((k) => (
            <Card key={k.label} className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {k.label}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <div className="font-display text-2xl">{k.value}</div>
                <span className="inline-flex items-center text-xs text-primary">
                  <ArrowUpRight className="h-3 w-3" /> {k.delta}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">{k.hint}</div>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card className="p-5">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-sm font-medium">Active members & loyalty revenue</div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Last 7 weeks
                </div>
              </div>
              <Badge variant="outline" className="rounded-full">
                <TrendingUp className="mr-1 h-3 w-3" /> +44% vs prior period
              </Badge>
            </div>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ENROLL_SERIES}>
                  <defs>
                    <linearGradient id="lActive" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="lRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-ochre)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--color-ochre)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="d" stroke="var(--color-muted-foreground)" fontSize={11} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="active"
                    stroke="var(--color-primary)"
                    fill="url(#lActive)"
                    strokeWidth={2}
                    name="Active members"
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="var(--color-ochre)"
                    fill="url(#lRev)"
                    strokeWidth={2}
                    name="Loyalty revenue ($)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-5">
            <div className="text-sm font-medium">Member tier distribution</div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              8,412 members
            </div>
            <div className="mt-4 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={TIER_DIST} layout="vertical" margin={{ left: 12 }}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" stroke="var(--color-muted-foreground)" fontSize={11} />
                  <YAxis dataKey="tier" type="category" stroke="var(--color-muted-foreground)" fontSize={11} width={48} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="var(--color-primary)" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Separator className="my-3" />
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between"><span>Avg. visits / member / mo</span><span className="text-foreground">3.4</span></div>
              <div className="flex justify-between"><span>Tier upgrade rate</span><span className="text-foreground">18% / quarter</span></div>
              <div className="flex justify-between"><span>Churn (90d inactive)</span><span className="text-foreground">9.2%</span></div>
            </div>
          </Card>
        </div>

        {/* AI strip */}
        <Card className="border-primary/30 bg-primary/5 p-5">
          <div className="flex items-start gap-4">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Bot className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Loyalty AI co-pilot</div>
                <Badge variant="outline" className="rounded-full text-[10px]">
                  <Sparkles className="mr-1 h-3 w-3" /> 3 opportunities
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Scans visit patterns, tier velocity, and reward redemption to find revenue you're leaving on the table.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {AI_SUGGESTIONS.map((s) => (
                  <div key={s.title} className="rounded-xl border border-border/60 bg-card p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <s.icon className="h-4 w-4 text-primary" /> {s.title}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{s.detail}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Button size="sm" className="h-7 rounded-full text-xs">Launch</Button>
                      <Button size="sm" variant="ghost" className="h-7 rounded-full text-xs">Tweak</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="tiers" className="space-y-4">
          <TabsList className="bg-muted/60">
            <TabsTrigger value="tiers">Tiers</TabsTrigger>
            <TabsTrigger value="rewards">Rewards catalog</TabsTrigger>
            <TabsTrigger value="rules">Earn rules</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="referrals">Referrals</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          {/* Tiers */}
          <TabsContent value="tiers" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Tier ladder</div>
                <p className="text-xs text-muted-foreground">
                  Members move up automatically based on rolling 12-month spend.
                </p>
              </div>
              <Button size="sm" variant="outline" className="rounded-full gap-2">
                <Plus className="h-4 w-4" /> Add tier
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {tiers.map((t) => (
                <Card key={t.id} className="overflow-hidden p-0">
                  <div className={cn("flex items-center gap-3 px-4 py-3", t.color)}>
                    <t.icon className="h-5 w-5" />
                    <div className="font-display text-lg">{t.name}</div>
                    <Badge variant="outline" className="ml-auto rounded-full border-current/30 bg-background/30 text-current">
                      {t.multiplier}× pts
                    </Badge>
                  </div>
                  <div className="space-y-3 p-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Spend threshold
                      </div>
                      <div className="font-display text-xl">
                        ${t.threshold.toLocaleString()}<span className="text-xs text-muted-foreground">/yr</span>
                      </div>
                    </div>
                    <Separator />
                    <ul className="space-y-1.5 text-xs">
                      {t.perks.map((p) => (
                        <li key={p} className="flex items-start gap-2">
                          <Sparkles className="mt-0.5 h-3 w-3 text-primary" />
                          {p}
                        </li>
                      ))}
                    </ul>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 rounded-full">
                        <Pencil className="mr-1 h-3 w-3" /> Edit
                      </Button>
                      {t.id !== "mug" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-full text-destructive hover:text-destructive"
                          onClick={() => setTiers(tiers.filter((x) => x.id !== t.id))}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Rewards */}
          <TabsContent value="rewards" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Rewards catalog</div>
                <p className="text-xs text-muted-foreground">
                  What members can redeem points for. Toggle off seasonally; AI co-pilot suggests pricing tweaks based on COGS.
                </p>
              </div>
              <AddRewardDialog onAdd={(r) => setRewards([r, ...rewards])} />
            </div>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reward</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Tier access</TableHead>
                    <TableHead className="text-right">Point cost</TableHead>
                    <TableHead className="text-right">COGS</TableHead>
                    <TableHead className="text-right">Redeemed (90d)</TableHead>
                    <TableHead className="text-center">Active</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rewards.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          {r.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.tier}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.cost} pts</TableCell>
                      <TableCell className="text-right text-muted-foreground">${r.cogs.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{r.redeemed}</TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={r.active}
                          onCheckedChange={(v) =>
                            setRewards(rewards.map((x) => (x.id === r.id ? { ...x, active: v } : x)))
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setRewards(rewards.filter((x) => x.id !== r.id))}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Earn rules */}
          <TabsContent value="rules" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">How members earn points</div>
                <p className="text-xs text-muted-foreground">
                  Stackable rules. Base earn applies to every order; bonuses fire on triggers.
                </p>
              </div>
              <Button size="sm" variant="outline" className="rounded-full gap-2">
                <Plus className="h-4 w-4" /> Add rule
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {rules.map((r) => (
                <Card key={r.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Zap className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">{r.name}</div>
                        <Switch
                          checked={r.active}
                          onCheckedChange={(v) =>
                            setRules(rules.map((x) => (x.id === r.id ? { ...x, active: v } : x)))
                          }
                        />
                      </div>
                      <div className="text-xs text-muted-foreground">{r.trigger}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                          +{r.points} pts
                        </Badge>
                        <span className="text-xs text-muted-foreground">{r.hint}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Members */}
          <TabsContent value="members" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[240px]">
                <Input placeholder="Search by name, email, or phone…" className="rounded-full pl-3" />
              </div>
              <Select defaultValue="all">
                <SelectTrigger className="w-40 rounded-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tiers</SelectItem>
                  <SelectItem value="mug">Mug</SelectItem>
                  <SelectItem value="pint">Pint</SelectItem>
                  <SelectItem value="stein">Stein</SelectItem>
                  <SelectItem value="cask">Cask</SelectItem>
                </SelectContent>
              </Select>
              <Select defaultValue="recent">
                <SelectTrigger className="w-44 rounded-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Recently active</SelectItem>
                  <SelectItem value="points">Most points</SelectItem>
                  <SelectItem value="spend">Highest spend</SelectItem>
                  <SelectItem value="lapsed">Lapsed (30d+)</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="rounded-full gap-2">
                <Mail className="h-4 w-4" /> Message selected
              </Button>
              <Button size="sm" className="rounded-full gap-2">
                <Plus className="h-4 w-4" /> Add member
              </Button>
            </div>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Points</TableHead>
                    <TableHead className="text-right">YTD spend</TableHead>
                    <TableHead className="text-right">Visits</TableHead>
                    <TableHead>Last visit</TableHead>
                    <TableHead>To next tier</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MEMBERS.map((m) => {
                    const tierIdx = tiers.findIndex((t) => t.name === m.tier);
                    const next = tiers[tierIdx + 1];
                    const progress = next
                      ? Math.min(100, Math.round((m.ytdSpend / next.threshold) * 100))
                      : 100;
                    return (
                      <TableRow key={m.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="bg-accent text-[11px] text-accent-foreground">
                                {m.name.split(" ").map((p) => p[0]).join("")}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="text-sm font-medium">{m.name}</div>
                              <div className="text-[11px] text-muted-foreground">{m.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-primary/10 text-primary hover:bg-primary/10">{m.tier}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{m.points.toLocaleString()}</TableCell>
                        <TableCell className="text-right">${m.ytdSpend.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{m.visits}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{m.lastVisit}</TableCell>
                        <TableCell className="w-44">
                          {next ? (
                            <div className="space-y-1">
                              <Progress value={progress} className="h-1.5" />
                              <div className="text-[10px] text-muted-foreground">
                                ${next.threshold - m.ytdSpend > 0 ? (next.threshold - m.ytdSpend).toLocaleString() : 0} to {next.name}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">Top tier</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8">
                              <Coins className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8">
                              <MessageCircle className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Campaigns */}
          <TabsContent value="campaigns" className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Loyalty campaigns</div>
                <p className="text-xs text-muted-foreground">
                  Targeted sends to loyalty segments. Pulls live audience from tiers + visit recency.
                </p>
              </div>
              <Button size="sm" className="rounded-full gap-2">
                <Plus className="h-4 w-4" /> New campaign
              </Button>
            </div>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Audience</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Reach</TableHead>
                    <TableHead className="text-right">Redeemed</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {CAMPAIGNS.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.audience}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="rounded-full text-[10px]">{c.channel}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={cn(
                            "rounded-full text-[10px]",
                            c.status === "Live" && "bg-primary/10 text-primary hover:bg-primary/10",
                            c.status === "Scheduled" && "bg-ochre/15 text-ochre hover:bg-ochre/15",
                            c.status === "Draft" && "bg-muted text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {c.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{c.reach.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{c.redeemed.toLocaleString()}</TableCell>
                      <TableCell className="text-right">${c.revenue.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Referrals */}
          <TabsContent value="referrals" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <Card className="p-5">
                <div className="text-sm font-medium">Refer-a-friend program</div>
                <p className="text-xs text-muted-foreground">
                  Members share a unique link. Both sides earn points when the friend completes their first visit.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <Label className="text-xs">Referrer reward</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input defaultValue="300" className="w-24 rounded-full" />
                      <span className="text-sm text-muted-foreground">points</span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Friend welcome reward</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input defaultValue="200" className="w-24 rounded-full" />
                      <span className="text-sm text-muted-foreground">points</span>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Min spend to qualify</Label>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">$</span>
                      <Input defaultValue="25" className="w-24 rounded-full" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Referral cap / member / year</Label>
                    <Input defaultValue="10" className="mt-1 w-24 rounded-full" />
                  </div>
                </div>
                <Separator className="my-4" />
                <Label className="text-xs">Share message template</Label>
                <Textarea
                  className="mt-1"
                  defaultValue="Hey — I've been hitting Thrasher's Pub a lot lately. Use my link, your first round is on me 🍻"
                />
                <div className="mt-3 flex items-center gap-2">
                  <Button size="sm" className="rounded-full">Save</Button>
                  <Button size="sm" variant="outline" className="rounded-full gap-2">
                    <QrCode className="h-4 w-4" /> Print table tents
                  </Button>
                </div>
              </Card>
              <Card className="p-5">
                <div className="text-sm font-medium">Top referrers (90 days)</div>
                <div className="mt-3 space-y-3">
                  {[
                    { name: "Sienna Cohen", invites: 14, joined: 9, revenue: 1180 },
                    { name: "Jordan Reyes", invites: 11, joined: 7, revenue: 940 },
                    { name: "Marco Bianchi", invites: 8, joined: 5, revenue: 620 },
                    { name: "Priya Anand", invites: 6, joined: 4, revenue: 510 },
                  ].map((r) => (
                    <div key={r.name} className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-accent text-[11px] text-accent-foreground">
                          {r.name.split(" ").map((p) => p[0]).join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.invites} invites · {r.joined} joined
                        </div>
                      </div>
                      <div className="text-sm font-medium">${r.revenue}</div>
                    </div>
                  ))}
                </div>
                <Separator className="my-4" />
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="font-display text-lg">184</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Invites sent</div>
                  </div>
                  <div>
                    <div className="font-display text-lg">62</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">New members</div>
                  </div>
                  <div>
                    <div className="font-display text-lg">34%</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Convert rate</div>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Settings */}
          <TabsContent value="settings" className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <div className="text-sm font-medium">Program basics</div>
                <p className="text-xs text-muted-foreground">
                  Names and economics members will see on receipts and in the app.
                </p>
                <div className="mt-4 space-y-3">
                  <div>
                    <Label className="text-xs">Program name</Label>
                    <Input value={programName} onChange={(e) => setProgramName(e.target.value)} className="mt-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">$ value per point</Label>
                      <Input value={pointValue} onChange={(e) => setPointValue(e.target.value)} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">Points expire after (months)</Label>
                      <Input value={expiry} onChange={(e) => setExpiry(e.target.value)} className="mt-1" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Default enrollment method</Label>
                    <Select value={enrollMethod} onValueChange={setEnrollMethod}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="phone">Phone number at checkout</SelectItem>
                        <SelectItem value="email">Email at checkout</SelectItem>
                        <SelectItem value="qr">QR code (table tent / receipt)</SelectItem>
                        <SelectItem value="app">In-app sign-up</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>

              <Card className="p-5">
                <div className="text-sm font-medium">Automation & guardrails</div>
                <p className="text-xs text-muted-foreground">
                  How the AI co-pilot is allowed to act on its own.
                </p>
                <div className="mt-4 space-y-3 text-sm">
                  {[
                    { id: "auto-winback", label: "Auto-send win-back to lapsed members", hint: "After 45 days no visit" },
                    { id: "auto-bday", label: "Auto-issue birthday rewards", hint: "On the 1st of birth month" },
                    { id: "auto-bonus", label: "Auto-launch slow-night bonus points", hint: "Mon–Wed, when forecast < 80% of avg" },
                    { id: "approve-large", label: "Require approval for sends > 2,000 members", hint: "Owner gets push notification" },
                  ].map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
                      <div>
                        <div className="text-sm">{row.label}</div>
                        <div className="text-[11px] text-muted-foreground">{row.hint}</div>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-5 lg:col-span-2">
                <div className="text-sm font-medium">Integrations & data sources</div>
                <p className="text-xs text-muted-foreground">
                  Loyalty pulls from these systems. Manage credentials in Settings → Integrations.
                </p>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  {[
                    { name: "Toast POS", status: "Connected", desc: "Member lookup at checkout, points accrual." },
                    { name: "Square Gift Cards", status: "Connected", desc: "Reward redemption as comp lines." },
                    { name: "Mailchimp", status: "Connected", desc: "Loyalty-tagged email audiences." },
                    { name: "Twilio SMS", status: "Connected", desc: "Reward codes & win-back messages." },
                    { name: "Apple / Google Wallet", status: "Available", desc: "Digital membership card pass." },
                    { name: "OpenTable", status: "Available", desc: "Recognize members at reservation." },
                  ].map((i) => (
                    <div key={i.name} className="rounded-xl border border-border/60 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">{i.name}</div>
                        <Badge
                          variant={i.status === "Connected" ? "secondary" : "outline"}
                          className={cn(
                            "rounded-full text-[10px]",
                            i.status === "Connected" && "bg-primary/10 text-primary hover:bg-primary/10",
                          )}
                        >
                          {i.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{i.desc}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ---------- Add Reward dialog ----------

function AddRewardDialog({ onAdd }: { onAdd: (r: Reward) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [cost, setCost] = useState("200");
  const [category, setCategory] = useState<Reward["category"]>("Drink");
  const [tier, setTier] = useState<Reward["tier"]>("All");
  const [cogs, setCogs] = useState("2.50");

  const submit = () => {
    if (!name) return;
    onAdd({
      id: `r-${Date.now()}`,
      name,
      cost: Number(cost) || 0,
      category,
      tier,
      cogs: Number(cogs) || 0,
      redeemed: 0,
      active: true,
    });
    setOpen(false);
    setName("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="rounded-full gap-2">
          <Plus className="h-4 w-4" /> Add reward
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New reward</DialogTitle>
          <DialogDescription>
            Members will see this in the rewards catalog and at checkout.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Reward name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Free dessert" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Point cost</Label>
              <Input value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">COGS ($)</Label>
              <Input value={cogs} onChange={(e) => setCogs(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as Reward["category"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Food">Food</SelectItem>
                  <SelectItem value="Drink">Drink</SelectItem>
                  <SelectItem value="Experience">Experience</SelectItem>
                  <SelectItem value="Merch">Merch</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tier access</Label>
              <Select value={tier} onValueChange={(v) => setTier(v as Reward["tier"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  <SelectItem value="Pint+">Pint+</SelectItem>
                  <SelectItem value="Stein+">Stein+</SelectItem>
                  <SelectItem value="Cask">Cask only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit}>Add reward</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
