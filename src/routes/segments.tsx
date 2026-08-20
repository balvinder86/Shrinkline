import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  Copy,
  Download,
  Filter,
  Heart,
  Mail,
  MessageCircle,
  Plus,
  Save,
  Send,
  Sparkles,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/segments")({
  head: () => ({
    meta: [
      { title: "Audience segments · Shrinkline" },
      {
        name: "description",
        content:
          "Build customer segments by tags, spend, visits and engagement, then preview who will receive each campaign.",
      },
    ],
  }),
  component: SegmentsPage,
});

// ---------- Types ----------

type Op =
  | "is" | "is_not"
  | "gte" | "lte" | "between"
  | "within" | "older_than"
  | "contains" | "not_contains"
  | "any_of" | "all_of" | "none_of";

type FieldKey =
  | "tags"
  | "total_spend"
  | "avg_check"
  | "visits_90d"
  | "last_visit"
  | "email_open_rate"
  | "sms_ctr"
  | "loyalty_tier"
  | "subscribed_channels"
  | "birthday_month"
  | "distance_mi"
  | "first_visit"
  | "party_size";

type FieldDef = {
  key: FieldKey;
  label: string;
  group: "Identity" | "Spend" | "Visits" | "Engagement" | "Location";
  type: "tags" | "number" | "date" | "select" | "multi";
  options?: string[];
  unit?: string;
  ops: Op[];
};

const FIELDS: FieldDef[] = [
  { key: "tags", label: "Tags", group: "Identity", type: "tags", ops: ["any_of", "all_of", "none_of"], options: ["VIP", "Wine club", "Birthday this month", "Brunch lover", "Vegetarian", "Anniversary", "Press", "Influencer"] },
  { key: "loyalty_tier", label: "Loyalty tier", group: "Identity", type: "select", options: ["Friend", "Regular", "Insider"], ops: ["is", "is_not"] },
  { key: "birthday_month", label: "Birthday month", group: "Identity", type: "select", options: ["This month", "Next 30 days", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], ops: ["is"] },
  { key: "total_spend", label: "Lifetime spend", group: "Spend", type: "number", unit: "$", ops: ["gte", "lte", "between"] },
  { key: "avg_check", label: "Avg check", group: "Spend", type: "number", unit: "$", ops: ["gte", "lte", "between"] },
  { key: "visits_90d", label: "Visits (last 90d)", group: "Visits", type: "number", ops: ["gte", "lte", "between"] },
  { key: "last_visit", label: "Last visit", group: "Visits", type: "date", ops: ["within", "older_than"] },
  { key: "first_visit", label: "First visit", group: "Visits", type: "date", ops: ["within", "older_than"] },
  { key: "party_size", label: "Avg party size", group: "Visits", type: "number", ops: ["gte", "lte", "between"] },
  { key: "email_open_rate", label: "Email open rate", group: "Engagement", type: "number", unit: "%", ops: ["gte", "lte"] },
  { key: "sms_ctr", label: "SMS click rate", group: "Engagement", type: "number", unit: "%", ops: ["gte", "lte"] },
  { key: "subscribed_channels", label: "Subscribed to", group: "Engagement", type: "multi", options: ["Email", "SMS", "WhatsApp", "Push"], ops: ["any_of", "all_of", "none_of"] },
  { key: "distance_mi", label: "Distance from venue", group: "Location", type: "number", unit: "mi", ops: ["lte", "gte"] },
];

const OP_LABEL: Record<Op, string> = {
  is: "is",
  is_not: "is not",
  gte: "≥",
  lte: "≤",
  between: "between",
  within: "within last",
  older_than: "older than",
  contains: "contains",
  not_contains: "does not contain",
  any_of: "is any of",
  all_of: "is all of",
  none_of: "is none of",
};

type Rule = {
  id: string;
  field: FieldKey;
  op: Op;
  value: any;
  value2?: any;
};

type Group = {
  id: string;
  match: "all" | "any";
  rules: Rule[];
};

type SegmentDef = {
  match: "all" | "any";
  groups: Group[];
  exclude: Group | null;
};

// ---------- Mock guests ----------

type Guest = {
  id: string;
  name: string;
  email: string;
  phone: string;
  tags: string[];
  loyalty_tier: "Friend" | "Regular" | "Insider";
  total_spend: number;
  avg_check: number;
  visits_90d: number;
  last_visit_days: number;
  first_visit_days: number;
  email_open_rate: number;
  sms_ctr: number;
  subscribed_channels: string[];
  distance_mi: number;
  birthday_month: string;
  party_size: number;
};

const GUESTS: Guest[] = [
  { id: "g1", name: "Amelia Rivera", email: "amelia@gmail.com", phone: "+1 415 555 0102", tags: ["VIP", "Wine club"], loyalty_tier: "Insider", total_spend: 4820, avg_check: 142, visits_90d: 8, last_visit_days: 4, first_visit_days: 612, email_open_rate: 64, sms_ctr: 22, subscribed_channels: ["Email", "SMS"], distance_mi: 1.8, birthday_month: "Oct", party_size: 4 },
  { id: "g2", name: "Daniel Kim", email: "dkim@hey.com", phone: "+1 415 555 0188", tags: ["Brunch lover"], loyalty_tier: "Regular", total_spend: 1240, avg_check: 86, visits_90d: 4, last_visit_days: 12, first_visit_days: 220, email_open_rate: 38, sms_ctr: 9, subscribed_channels: ["Email"], distance_mi: 3.2, birthday_month: "Mar", party_size: 2 },
  { id: "g3", name: "Sophie Marchetti", email: "sophie.m@outlook.com", phone: "+1 415 555 0144", tags: ["Anniversary"], loyalty_tier: "Regular", total_spend: 980, avg_check: 110, visits_90d: 3, last_visit_days: 21, first_visit_days: 340, email_open_rate: 52, sms_ctr: 14, subscribed_channels: ["Email", "WhatsApp"], distance_mi: 2.1, birthday_month: "Sep", party_size: 2 },
  { id: "g4", name: "Marcus Thompson", email: "marcus@thompson.io", phone: "+1 415 555 0117", tags: ["VIP", "Press"], loyalty_tier: "Insider", total_spend: 6210, avg_check: 168, visits_90d: 11, last_visit_days: 2, first_visit_days: 920, email_open_rate: 71, sms_ctr: 28, subscribed_channels: ["Email", "SMS", "WhatsApp"], distance_mi: 0.8, birthday_month: "Dec", party_size: 6 },
  { id: "g5", name: "Priya Nair", email: "priya.n@gmail.com", phone: "+1 415 555 0166", tags: ["Vegetarian", "Brunch lover"], loyalty_tier: "Regular", total_spend: 720, avg_check: 64, visits_90d: 5, last_visit_days: 8, first_visit_days: 180, email_open_rate: 44, sms_ctr: 12, subscribed_channels: ["Email", "SMS"], distance_mi: 4.6, birthday_month: "Jul", party_size: 2 },
  { id: "g6", name: "Jordan Lee", email: "j.lee@proton.me", phone: "+1 415 555 0133", tags: [], loyalty_tier: "Friend", total_spend: 180, avg_check: 90, visits_90d: 0, last_visit_days: 142, first_visit_days: 142, email_open_rate: 12, sms_ctr: 0, subscribed_channels: ["Email"], distance_mi: 7.2, birthday_month: "May", party_size: 2 },
  { id: "g7", name: "Hannah Cho", email: "hannah@studio.co", phone: "+1 415 555 0199", tags: ["Influencer"], loyalty_tier: "Regular", total_spend: 1640, avg_check: 96, visits_90d: 6, last_visit_days: 6, first_visit_days: 410, email_open_rate: 58, sms_ctr: 19, subscribed_channels: ["Email", "SMS"], distance_mi: 2.8, birthday_month: "Oct", party_size: 3 },
  { id: "g8", name: "Wei Zhang", email: "wei.z@gmail.com", phone: "+1 415 555 0121", tags: ["Wine club"], loyalty_tier: "Insider", total_spend: 3120, avg_check: 132, visits_90d: 7, last_visit_days: 10, first_visit_days: 520, email_open_rate: 49, sms_ctr: 16, subscribed_channels: ["Email"], distance_mi: 1.4, birthday_month: "Feb", party_size: 4 },
  { id: "g9", name: "Olivia Brooks", email: "olivia@hey.com", phone: "+1 415 555 0155", tags: ["Birthday this month"], loyalty_tier: "Friend", total_spend: 420, avg_check: 84, visits_90d: 2, last_visit_days: 30, first_visit_days: 95, email_open_rate: 36, sms_ctr: 10, subscribed_channels: ["SMS"], distance_mi: 3.9, birthday_month: "This month", party_size: 2 },
  { id: "g10", name: "Lia Karlsen", email: "lia.k@me.com", phone: "+1 415 555 0177", tags: ["VIP", "Wine club", "Anniversary"], loyalty_tier: "Insider", total_spend: 5240, avg_check: 156, visits_90d: 9, last_visit_days: 3, first_visit_days: 740, email_open_rate: 66, sms_ctr: 24, subscribed_channels: ["Email", "SMS", "WhatsApp"], distance_mi: 1.2, birthday_month: "Nov", party_size: 4 },
  { id: "g11", name: "Tomás Alvarez", email: "tomas@a.com", phone: "+1 415 555 0162", tags: [], loyalty_tier: "Friend", total_spend: 96, avg_check: 48, visits_90d: 0, last_visit_days: 210, first_visit_days: 210, email_open_rate: 8, sms_ctr: 0, subscribed_channels: ["Email"], distance_mi: 9.1, birthday_month: "Jun", party_size: 2 },
  { id: "g12", name: "Naomi Patel", email: "naomi.p@gmail.com", phone: "+1 415 555 0143", tags: ["Brunch lover", "Vegetarian"], loyalty_tier: "Regular", total_spend: 880, avg_check: 72, visits_90d: 4, last_visit_days: 14, first_visit_days: 260, email_open_rate: 42, sms_ctr: 11, subscribed_channels: ["Email", "SMS"], distance_mi: 3.4, birthday_month: "Aug", party_size: 3 },
];

// Add 60 more synthetic guests so the preview feels realistic
function expand(): Guest[] {
  const out = [...GUESTS];
  const tiers: Guest["loyalty_tier"][] = ["Friend", "Regular", "Insider"];
  const allTags = ["VIP", "Wine club", "Brunch lover", "Vegetarian", "Anniversary", "Birthday this month", "Press", "Influencer"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let i = 0; i < 188; i++) {
    const seed = (i * 9301 + 49297) % 233280;
    const r = (n: number) => Math.floor((seed * (n + 7)) % 100);
    const tier = tiers[r(1) % 3];
    out.push({
      id: `gx${i}`,
      name: `Guest ${i + 13}`,
      email: `guest${i + 13}@example.com`,
      phone: `+1 415 555 0${(200 + i).toString().slice(-3)}`,
      tags: r(2) > 60 ? [allTags[r(3) % allTags.length]] : [],
      loyalty_tier: tier,
      total_spend: 80 + r(4) * 60,
      avg_check: 40 + r(5),
      visits_90d: r(6) % 12,
      last_visit_days: r(7) * 3,
      first_visit_days: 60 + r(8) * 10,
      email_open_rate: r(9),
      sms_ctr: r(10) % 35,
      subscribed_channels: r(11) > 50 ? ["Email", "SMS"] : ["Email"],
      distance_mi: r(12) % 12,
      birthday_month: months[r(13) % 12],
      party_size: 2 + (r(14) % 5),
    });
  }
  return out;
}
const ALL_GUESTS = expand();

// ---------- Templates ----------

const TEMPLATES: { name: string; description: string; def: SegmentDef }[] = [
  {
    name: "VIP regulars",
    description: "Tagged VIP, spent $2k+, visited recently.",
    def: {
      match: "all",
      exclude: null,
      groups: [{
        id: "g", match: "all", rules: [
          { id: "1", field: "tags", op: "any_of", value: ["VIP"] },
          { id: "2", field: "total_spend", op: "gte", value: 2000 },
          { id: "3", field: "last_visit", op: "within", value: 30 },
        ],
      }],
    },
  },
  {
    name: "Win-back · 90d dormant",
    description: "Haven't visited in 90+ days but were once active.",
    def: {
      match: "all",
      exclude: null,
      groups: [{
        id: "g", match: "all", rules: [
          { id: "1", field: "last_visit", op: "older_than", value: 90 },
          { id: "2", field: "visits_90d", op: "gte", value: 0 },
          { id: "3", field: "total_spend", op: "gte", value: 200 },
        ],
      }],
    },
  },
  {
    name: "Birthday club",
    description: "Birthday this month, subscribed to SMS.",
    def: {
      match: "all",
      exclude: null,
      groups: [{
        id: "g", match: "all", rules: [
          { id: "1", field: "birthday_month", op: "is", value: "This month" },
          { id: "2", field: "subscribed_channels", op: "any_of", value: ["SMS"] },
        ],
      }],
    },
  },
  {
    name: "Local brunch lovers",
    description: "Tagged brunch, within 5 miles, opens email.",
    def: {
      match: "all",
      exclude: null,
      groups: [{
        id: "g", match: "all", rules: [
          { id: "1", field: "tags", op: "any_of", value: ["Brunch lover"] },
          { id: "2", field: "distance_mi", op: "lte", value: 5 },
          { id: "3", field: "email_open_rate", op: "gte", value: 30 },
        ],
      }],
    },
  },
];

// ---------- Evaluator ----------

function evalRule(g: Guest, r: Rule): boolean {
  const f = FIELDS.find((x) => x.key === r.field)!;
  const val = (g as any)[r.field];
  if (f.key === "last_visit") {
    if (r.op === "within") return g.last_visit_days <= Number(r.value);
    if (r.op === "older_than") return g.last_visit_days > Number(r.value);
  }
  if (f.key === "first_visit") {
    if (r.op === "within") return g.first_visit_days <= Number(r.value);
    if (r.op === "older_than") return g.first_visit_days > Number(r.value);
  }
  switch (r.op) {
    case "is": return val === r.value;
    case "is_not": return val !== r.value;
    case "gte": return Number(val) >= Number(r.value);
    case "lte": return Number(val) <= Number(r.value);
    case "between": return Number(val) >= Number(r.value) && Number(val) <= Number(r.value2);
    case "any_of": return Array.isArray(val) ? (r.value as string[]).some((v) => val.includes(v)) : (r.value as string[]).includes(val);
    case "all_of": return Array.isArray(val) && (r.value as string[]).every((v) => val.includes(v));
    case "none_of": return Array.isArray(val) ? !(r.value as string[]).some((v) => val.includes(v)) : !(r.value as string[]).includes(val);
    default: return true;
  }
}

function evalGroup(g: Guest, group: Group): boolean {
  if (!group.rules.length) return true;
  return group.match === "all" ? group.rules.every((r) => evalRule(g, r)) : group.rules.some((r) => evalRule(g, r));
}

function evalSegment(g: Guest, def: SegmentDef): boolean {
  const passInclude = def.groups.length === 0
    ? true
    : def.match === "all" ? def.groups.every((gr) => evalGroup(g, gr)) : def.groups.some((gr) => evalGroup(g, gr));
  if (!passInclude) return false;
  if (def.exclude && def.exclude.rules.length) {
    if (evalGroup(g, def.exclude)) return false;
  }
  return true;
}

// ---------- Page ----------

const uid = () => Math.random().toString(36).slice(2, 9);

const EMPTY_RULE = (): Rule => ({ id: uid(), field: "total_spend", op: "gte", value: 100 });

function SegmentsPage() {
  const [name, setName] = useState("VIP regulars · autumn truffle launch");
  const [description, setDescription] = useState("Top-spending guests we want first on the truffle reservations.");
  const [def, setDef] = useState<SegmentDef>(TEMPLATES[0].def);
  const [previewChannel, setPreviewChannel] = useState<"Email" | "SMS" | "All">("All");

  const matched = useMemo(() => ALL_GUESTS.filter((g) => evalSegment(g, def)), [def]);
  const channelMatched = useMemo(() => {
    if (previewChannel === "All") return matched;
    return matched.filter((g) => g.subscribed_channels.includes(previewChannel));
  }, [matched, previewChannel]);

  const stats = useMemo(() => {
    const total = matched.length || 1;
    const avgSpend = Math.round(matched.reduce((s, g) => s + g.total_spend, 0) / total);
    const avgVisits = (matched.reduce((s, g) => s + g.visits_90d, 0) / total).toFixed(1);
    const reach = {
      Email: matched.filter((g) => g.subscribed_channels.includes("Email")).length,
      SMS: matched.filter((g) => g.subscribed_channels.includes("SMS")).length,
      WhatsApp: matched.filter((g) => g.subscribed_channels.includes("WhatsApp")).length,
    };
    return { avgSpend, avgVisits, reach };
  }, [matched]);

  function updateGroup(id: string, fn: (g: Group) => Group) {
    setDef((d) => ({ ...d, groups: d.groups.map((g) => (g.id === id ? fn(g) : g)) }));
  }
  function addGroup() {
    setDef((d) => ({ ...d, groups: [...d.groups, { id: uid(), match: "all", rules: [EMPTY_RULE()] }] }));
  }
  function removeGroup(id: string) {
    setDef((d) => ({ ...d, groups: d.groups.filter((g) => g.id !== id) }));
  }
  function setExclude(on: boolean) {
    setDef((d) => ({ ...d, exclude: on ? { id: "excl", match: "any", rules: [EMPTY_RULE()] } : null }));
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar eyebrow="Marketing" title="Audience segments" />
      <main className="flex-1 space-y-6 px-6 py-6 lg:px-10">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <Link to="/marketing" className="inline-flex items-center gap-1 text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Marketing
            </Link>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-auto border-none bg-transparent p-0 font-serif text-3xl text-foreground shadow-none focus-visible:ring-0 lg:text-4xl"
            />
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-auto border-none bg-transparent p-0 text-sm text-muted-foreground shadow-none focus-visible:ring-0"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1"><Copy className="h-3.5 w-3.5" /> Duplicate</Button>
            <Button variant="outline" size="sm" className="gap-1"><Download className="h-3.5 w-3.5" /> Export CSV</Button>
            <Button variant="outline" size="sm" className="gap-1"><Save className="h-3.5 w-3.5" /> Save segment</Button>
            <Button size="sm" className="gap-1"><Send className="h-3.5 w-3.5" /> Use in campaign</Button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-5">
          {/* ===== Editor ===== */}
          <div className="space-y-4 lg:col-span-3">
            {/* Templates */}
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-serif text-base text-foreground">Start from a template</div>
                  <div className="text-xs text-muted-foreground">Or build from scratch below</div>
                </div>
                <Button variant="ghost" size="sm" className="gap-1"><Sparkles className="h-3.5 w-3.5" /> Suggest with AI</Button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => setDef(t.def)}
                    className="rounded-lg border border-border/60 bg-card/60 p-3 text-left transition hover:border-foreground/30 hover:bg-card"
                  >
                    <div className="text-sm font-medium text-foreground">{t.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{t.description}</div>
                  </button>
                ))}
              </div>
            </Card>

            {/* Match mode */}
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-serif text-lg text-foreground">Rules</div>
                  <div className="text-xs text-muted-foreground">Define who belongs to this segment</div>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-0.5 text-xs">
                  <button
                    onClick={() => setDef((d) => ({ ...d, match: "all" }))}
                    className={`rounded px-2.5 py-1 ${def.match === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                  >Match ALL groups</button>
                  <button
                    onClick={() => setDef((d) => ({ ...d, match: "any" }))}
                    className={`rounded px-2.5 py-1 ${def.match === "any" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                  >Match ANY group</button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {def.groups.map((g, idx) => (
                  <GroupEditor
                    key={g.id}
                    group={g}
                    index={idx}
                    parentMatch={def.match}
                    onChange={(fn) => updateGroup(g.id, fn)}
                    onRemove={def.groups.length > 1 ? () => removeGroup(g.id) : undefined}
                  />
                ))}
                <Button variant="outline" size="sm" className="gap-1" onClick={addGroup}>
                  <Plus className="h-3.5 w-3.5" /> Add group
                </Button>
              </div>

              <Separator className="my-5" />

              {/* Exclude */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-foreground">Exclude guests who…</div>
                  <div className="text-xs text-muted-foreground">Removes anyone matching this group from the result</div>
                </div>
                <Switch checked={!!def.exclude} onCheckedChange={setExclude} />
              </div>
              {def.exclude && (
                <div className="mt-3">
                  <GroupEditor
                    group={def.exclude}
                    index={0}
                    parentMatch="all"
                    exclude
                    onChange={(fn) => setDef((d) => (d.exclude ? { ...d, exclude: fn(d.exclude) } : d))}
                  />
                </div>
              )}
            </Card>
          </div>

          {/* ===== Preview ===== */}
          <div className="space-y-4 lg:col-span-2">
            <Card className="overflow-hidden">
              <div className="bg-gradient-to-br from-[var(--color-ochre)]/15 via-transparent to-[var(--color-terracotta)]/10 p-5">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> Live preview
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <div className="font-serif text-5xl text-foreground">{matched.length.toLocaleString()}</div>
                  <div className="text-sm text-muted-foreground">guests match</div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {((matched.length / ALL_GUESTS.length) * 100).toFixed(1)}% of your {ALL_GUESTS.length.toLocaleString()} guest database
                </div>
              </div>

              <div className="grid grid-cols-3 border-t border-border/60 text-center">
                <Mini label="Avg spend" value={`$${stats.avgSpend.toLocaleString()}`} />
                <Mini label="Visits/90d" value={stats.avgVisits} divide />
                <Mini label="Reach (email)" value={`${Math.round((stats.reach.Email / Math.max(matched.length, 1)) * 100)}%`} />
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-serif text-base text-foreground">Who'll get it</div>
                  <div className="text-xs text-muted-foreground">Filter by delivery channel before sending</div>
                </div>
              </div>
              <Tabs value={previewChannel} onValueChange={(v) => setPreviewChannel(v as any)} className="mt-3">
                <TabsList className="grid w-full grid-cols-3 bg-muted/40">
                  <TabsTrigger value="All">All ({matched.length})</TabsTrigger>
                  <TabsTrigger value="Email" className="gap-1"><Mail className="h-3 w-3" /> {stats.reach.Email}</TabsTrigger>
                  <TabsTrigger value="SMS" className="gap-1"><MessageCircle className="h-3 w-3" /> {stats.reach.SMS}</TabsTrigger>
                </TabsList>
                <TabsContent value={previewChannel} className="mt-4">
                  <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                    {channelMatched.slice(0, 25).map((g) => (
                      <div key={g.id} className="flex items-center gap-3 rounded-lg border border-border/60 p-2.5">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="text-xs">
                            {g.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-medium text-foreground">{g.name}</div>
                            {g.tags.slice(0, 1).map((t) => (
                              <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                            ))}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {g.loyalty_tier} · ${g.total_spend.toLocaleString()} · {g.visits_90d} visits / 90d
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          {g.subscribed_channels.includes("Email") && <Mail className="h-3.5 w-3.5" />}
                          {g.subscribed_channels.includes("SMS") && <MessageCircle className="h-3.5 w-3.5" />}
                          {g.subscribed_channels.includes("WhatsApp") && <Heart className="h-3.5 w-3.5" />}
                        </div>
                      </div>
                    ))}
                    {channelMatched.length === 0 && (
                      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        No guests match these rules yet.
                      </div>
                    )}
                    {channelMatched.length > 25 && (
                      <div className="pt-1 text-center text-xs text-muted-foreground">
                        + {channelMatched.length - 25} more
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" /> Estimated impact
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <ImpactRow label="Predicted email opens" value={`${Math.round(stats.reach.Email * 0.46)}`} hint="46% avg open" />
                <ImpactRow label="Predicted clicks" value={`${Math.round(stats.reach.Email * 0.11)}`} hint="11% avg click" />
                <ImpactRow label="Projected revenue" value={`$${(matched.length * 18).toLocaleString()}`} hint="~$18 / matched guest" />
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

// ---------- Group editor ----------

function GroupEditor({
  group, index, parentMatch, exclude, onChange, onRemove,
}: {
  group: Group;
  index: number;
  parentMatch: "all" | "any";
  exclude?: boolean;
  onChange: (fn: (g: Group) => Group) => void;
  onRemove?: () => void;
}) {
  function setRule(id: string, fn: (r: Rule) => Rule) {
    onChange((g) => ({ ...g, rules: g.rules.map((r) => (r.id === id ? fn(r) : r)) }));
  }
  function addRule() {
    onChange((g) => ({ ...g, rules: [...g.rules, EMPTY_RULE()] }));
  }
  function removeRule(id: string) {
    onChange((g) => ({ ...g, rules: g.rules.filter((r) => r.id !== id) }));
  }

  return (
    <div className={`rounded-lg border p-4 ${exclude ? "border-[var(--color-terracotta)]/40 bg-[var(--color-terracotta)]/5" : "border-border/60 bg-muted/20"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          {exclude ? "Exclusion group" : `Group ${index + 1}`}
          {index > 0 && !exclude && (
            <Badge variant="outline" className="text-[10px]">{parentMatch === "all" ? "AND" : "OR"} previous</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5 text-[11px]">
            <button
              onClick={() => onChange((g) => ({ ...g, match: "all" }))}
              className={`rounded px-2 py-0.5 ${group.match === "all" ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >ALL</button>
            <button
              onClick={() => onChange((g) => ({ ...g, match: "any" }))}
              className={`rounded px-2 py-0.5 ${group.match === "any" ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >ANY</button>
          </div>
          {onRemove && (
            <Button variant="ghost" size="sm" onClick={onRemove} className="h-7 w-7 p-0 text-muted-foreground">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {group.rules.map((r, i) => (
          <div key={r.id}>
            {i > 0 && (
              <div className="my-1 ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                {group.match === "all" ? "and" : "or"}
              </div>
            )}
            <RuleEditor rule={r} onChange={(fn) => setRule(r.id, fn)} onRemove={() => removeRule(r.id)} />
          </div>
        ))}
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={addRule}>
          <Plus className="h-3.5 w-3.5" /> Add condition
        </Button>
      </div>
    </div>
  );
}

// ---------- Rule editor ----------

function RuleEditor({ rule, onChange, onRemove }: { rule: Rule; onChange: (fn: (r: Rule) => Rule) => void; onRemove: () => void }) {
  const field = FIELDS.find((f) => f.key === rule.field)!;
  const Icon = iconForGroup(field.group);

  function setField(key: FieldKey) {
    const f = FIELDS.find((x) => x.key === key)!;
    onChange(() => ({
      id: rule.id,
      field: key,
      op: f.ops[0],
      value: defaultValue(f, f.ops[0]),
    }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-background p-2">
      <div className="grid h-7 w-7 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <Select value={rule.field} onChange={(v) => setField(v as FieldKey)} className="min-w-[170px]">
        {(["Identity", "Spend", "Visits", "Engagement", "Location"] as const).map((group) => (
          <optgroup key={group} label={group}>
            {FIELDS.filter((f) => f.group === group).map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </optgroup>
        ))}
      </Select>
      <Select
        value={rule.op}
        onChange={(v) => onChange((r) => ({ ...r, op: v as Op, value: defaultValue(field, v as Op), value2: undefined }))}
        className="min-w-[110px]"
      >
        {field.ops.map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
      </Select>

      <ValueInput field={field} rule={rule} onChange={onChange} />

      <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0 text-muted-foreground" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ValueInput({ field, rule, onChange }: { field: FieldDef; rule: Rule; onChange: (fn: (r: Rule) => Rule) => void }) {
  if (field.type === "tags" || field.type === "multi") {
    const selected: string[] = rule.value || [];
    return (
      <div className="flex flex-wrap items-center gap-1">
        {field.options!.map((opt) => {
          const on = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() =>
                onChange((r) => ({
                  ...r,
                  value: on ? selected.filter((s) => s !== opt) : [...selected, opt],
                }))
              }
              className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:border-foreground/50"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <Select value={rule.value ?? field.options![0]} onChange={(v) => onChange((r) => ({ ...r, value: v }))} className="min-w-[140px]">
        {field.options!.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    );
  }
  if (field.type === "date") {
    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={rule.value ?? 30}
          onChange={(e) => onChange((r) => ({ ...r, value: Number(e.target.value) }))}
          className="h-8 w-20"
        />
        <span className="text-xs text-muted-foreground">days</span>
      </div>
    );
  }
  // number
  if (rule.op === "between") {
    return (
      <div className="flex items-center gap-1">
        {field.unit === "$" && <span className="text-xs text-muted-foreground">$</span>}
        <Input
          type="number"
          value={rule.value ?? 0}
          onChange={(e) => onChange((r) => ({ ...r, value: Number(e.target.value) }))}
          className="h-8 w-20"
        />
        <span className="text-xs text-muted-foreground">to</span>
        {field.unit === "$" && <span className="text-xs text-muted-foreground">$</span>}
        <Input
          type="number"
          value={rule.value2 ?? 0}
          onChange={(e) => onChange((r) => ({ ...r, value2: Number(e.target.value) }))}
          className="h-8 w-20"
        />
        {field.unit && field.unit !== "$" && <span className="text-xs text-muted-foreground">{field.unit}</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      {field.unit === "$" && <span className="text-xs text-muted-foreground">$</span>}
      <Input
        type="number"
        value={rule.value ?? 0}
        onChange={(e) => onChange((r) => ({ ...r, value: Number(e.target.value) }))}
        className="h-8 w-24"
      />
      {field.unit && field.unit !== "$" && <span className="text-xs text-muted-foreground">{field.unit}</span>}
    </div>
  );
}

function defaultValue(f: FieldDef, op: Op) {
  if (f.type === "tags" || f.type === "multi") return [];
  if (f.type === "select") return f.options?.[0];
  if (f.type === "date") return 30;
  if (op === "between") return 100;
  return f.unit === "%" ? 30 : 100;
}

function iconForGroup(group: FieldDef["group"]) {
  if (group === "Identity") return Tag;
  if (group === "Spend") return Sparkles;
  if (group === "Visits") return Calendar;
  if (group === "Engagement") return Heart;
  return Users;
}

// ---------- Tiny primitives ----------

function Select({ value, onChange, children, className }: { value: any; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full appearance-none rounded-md border border-border bg-background pl-2.5 pr-7 text-sm"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function Mini({ label, value, divide }: { label: string; value: string; divide?: boolean }) {
  return (
    <div className={`px-4 py-3 ${divide ? "border-x border-border/60" : ""}`}>
      <div className="font-serif text-lg text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ImpactRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
      <div>
        <div className="text-foreground/80">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <div className="font-serif text-base text-foreground">{value}</div>
    </div>
  );
}
