import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Building2,
  Clock,
  MapPin,
  Bell,
  CreditCard,
  Receipt,
  Plug,
  KeyRound,
  Globe,
  Palette,
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  Check,
  Copy,
  Download,
  Mail,
  Phone,
  Smartphone,
  Upload,
  ExternalLink,
} from "lucide-react";
import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  useToastConnection,
  useConnectToast,
  useGmailConnection,
  useConnectGmail,
} from "@/lib/integrations/queries";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings · Thrasher's Pub" }] }),
  component: SettingsPage,
});

type SectionId =
  | "profile"
  | "hours"
  | "locations"
  | "notifications"
  | "integrations"
  | "billing"
  | "tax"
  | "branding"
  | "security"
  | "api";

const SECTIONS: { id: SectionId; label: string; icon: typeof Building2; group: string }[] = [
  { id: "profile", label: "Restaurant profile", icon: Building2, group: "Business" },
  { id: "hours", label: "Hours of operation", icon: Clock, group: "Business" },
  { id: "locations", label: "Locations", icon: MapPin, group: "Business" },
  { id: "branding", label: "Branding", icon: Palette, group: "Business" },
  { id: "notifications", label: "Notifications", icon: Bell, group: "Workspace" },
  { id: "integrations", label: "Integrations", icon: Plug, group: "Workspace" },
  { id: "api", label: "API & webhooks", icon: KeyRound, group: "Workspace" },
  { id: "billing", label: "Billing & plan", icon: CreditCard, group: "Account" },
  { id: "tax", label: "Tax & compliance", icon: Receipt, group: "Account" },
  { id: "security", label: "Security", icon: ShieldCheck, group: "Account" },
];

function SettingsPage() {
  // The Gmail OAuth callback (connect-gmail-callback) redirects back
  // here with ?gmail=connected|error after a full page navigation —
  // land on Integrations instead of the default Profile tab so the
  // result is immediately visible.
  const [active, setActive] = useState<SectionId>(() =>
    new URLSearchParams(window.location.search).has("gmail") ? "integrations" : "profile",
  );
  const grouped = SECTIONS.reduce<Record<string, typeof SECTIONS>>((acc, s) => {
    (acc[s.group] ||= []).push(s);
    return acc;
  }, {});

  return (
    <>
      <Topbar eyebrow="Workspace" title="Settings" />
      <main className="px-6 py-6">
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* Sidebar nav */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <Card className="p-3">
              {Object.entries(grouped).map(([group, items]) => (
                <div key={group} className="mb-2 last:mb-0">
                  <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
                    {group}
                  </div>
                  <nav className="flex flex-col">
                    {items.map((s) => {
                      const Icon = s.icon;
                      const isActive = active === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setActive(s.id)}
                          className={cn(
                            "flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
                            isActive
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-foreground/80 hover:bg-accent",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          {s.label}
                        </button>
                      );
                    })}
                  </nav>
                </div>
              ))}
            </Card>
          </aside>

          {/* Content */}
          <div className="min-w-0 space-y-6">
            {active === "profile" && <ProfileSection />}
            {active === "hours" && <HoursSection />}
            {active === "locations" && <LocationsSection />}
            {active === "branding" && <BrandingSection />}
            {active === "notifications" && <NotificationsSection />}
            {active === "integrations" && <IntegrationsSection />}
            {active === "api" && <ApiSection />}
            {active === "billing" && <BillingSection />}
            {active === "tax" && <TaxSection />}
            {active === "security" && <SecuritySection />}
          </div>
        </div>
      </main>
    </>
  );
}

/* ---------- Shared bits ---------- */

function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && (
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h2 className="font-display text-2xl">{title}</h2>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {description && (
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* ---------- Profile ---------- */

function ProfileSection() {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Business"
        title="Restaurant profile"
        description="Public-facing details used across your website, receipts, marketing, and listings."
        action={
          <Button size="sm" className="rounded-full">
            Save changes
          </Button>
        }
      />

      <Card className="p-6">
        <div className="flex items-start gap-5">
          <div className="grid h-20 w-20 place-items-center rounded-2xl bg-primary/10 font-display text-2xl text-primary">
            TP
          </div>
          <div className="flex-1 space-y-1">
            <div className="text-sm font-medium">Logo & brand mark</div>
            <p className="text-xs text-muted-foreground">
              Square PNG or SVG, transparent background. Used on receipts, email, and social.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" className="gap-2">
                <Upload className="h-3.5 w-3.5" /> Upload
              </Button>
              <Button size="sm" variant="ghost">Remove</Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Legal business name">
            <Input defaultValue="Thrasher's Pub LLC" />
          </Field>
          <Field label="Display name" hint="Shown to guests on receipts, email, and listings.">
            <Input defaultValue="Thrasher's Pub" />
          </Field>
          <Field label="Cuisine / category">
            <Select defaultValue="pub">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pub">Gastropub</SelectItem>
                <SelectItem value="american">American</SelectItem>
                <SelectItem value="italian">Italian</SelectItem>
                <SelectItem value="bar">Bar & lounge</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Price tier">
            <Select defaultValue="$$">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="$">$ – Budget</SelectItem>
                <SelectItem value="$$">$$ – Casual</SelectItem>
                <SelectItem value="$$$">$$$ – Upscale</SelectItem>
                <SelectItem value="$$$$">$$$$ – Fine dining</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Public email">
            <Input defaultValue="hello@thrasherspub.com" />
          </Field>
          <Field label="Reservations phone">
            <Input defaultValue="(202) 555-0144" />
          </Field>
          <Field label="Website">
            <Input defaultValue="https://thrasherspub.com" />
          </Field>
          <Field label="Founded">
            <Input defaultValue="2018" />
          </Field>
          <div className="md:col-span-2">
            <Field label="Short description" hint="Up to 280 characters. Used for SEO meta and Google Business.">
              <Textarea
                rows={3}
                defaultValue="Neighborhood gastropub with seasonal small plates, wood-fired classics, and a 40+ craft beer lineup. Open late, all welcome."
              />
            </Field>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ---------- Hours ---------- */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_HOURS = [
  { open: "11:30", close: "22:00", closed: false },
  { open: "11:30", close: "22:00", closed: false },
  { open: "11:30", close: "22:00", closed: false },
  { open: "11:30", close: "23:00", closed: false },
  { open: "11:30", close: "00:00", closed: false },
  { open: "10:00", close: "00:00", closed: false },
  { open: "10:00", close: "21:00", closed: false },
];

function HoursSection() {
  const [hours, setHours] = useState(DEFAULT_HOURS);
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Business"
        title="Hours of operation"
        description="Syncs to Google Business, your website, and reservation widgets."
        action={<Button size="sm" className="rounded-full">Publish hours</Button>}
      />

      <Card className="p-6">
        <div className="space-y-1">
          {DAYS.map((day, i) => (
            <div
              key={day}
              className="grid grid-cols-[120px_1fr_auto] items-center gap-4 border-b border-border/60 py-3 last:border-0"
            >
              <div className="text-sm font-medium">{day}</div>
              {hours[i].closed ? (
                <div className="text-sm text-muted-foreground">Closed</div>
              ) : (
                <div className="flex items-center gap-2 text-sm">
                  <Input
                    type="time"
                    value={hours[i].open}
                    onChange={(e) =>
                      setHours((h) =>
                        h.map((d, idx) => (idx === i ? { ...d, open: e.target.value } : d)),
                      )
                    }
                    className="h-9 w-32"
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="time"
                    value={hours[i].close}
                    onChange={(e) =>
                      setHours((h) =>
                        h.map((d, idx) => (idx === i ? { ...d, close: e.target.value } : d)),
                      )
                    }
                    className="h-9 w-32"
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Closed</span>
                <Switch
                  checked={hours[i].closed}
                  onCheckedChange={(v) =>
                    setHours((h) => h.map((d, idx) => (idx === i ? { ...d, closed: v } : d)))
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title="Special hours & holidays"
          description="Override regular hours for holidays, private events, or unexpected closures."
          action={
            <Button size="sm" variant="outline" className="gap-2">
              <Plus className="h-3.5 w-3.5" /> Add date
            </Button>
          }
        />
        <div className="mt-4 space-y-2">
          {[
            { date: "Jul 4, 2026", label: "Independence Day", note: "Closing at 6:00 PM" },
            { date: "Nov 26, 2026", label: "Thanksgiving", note: "Closed all day" },
            { date: "Dec 25, 2026", label: "Christmas Day", note: "Closed all day" },
          ].map((h) => (
            <div
              key={h.date}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium">{h.label}</div>
                <div className="text-xs text-muted-foreground">
                  {h.date} · {h.note}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Locations ---------- */

function LocationsSection() {
  const locations = [
    { name: "Thrasher's Pub – H Street", addr: "1218 H St NE, Washington, DC 20002", primary: true, seats: 96 },
    { name: "Thrasher's Pub – Navy Yard", addr: "300 Tingey St SE, Washington, DC 20003", primary: false, seats: 124 },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Business"
        title="Locations"
        description="Manage multiple venues. Each location has its own hours, menu, and tax settings."
        action={
          <Button size="sm" className="gap-2 rounded-full">
            <Plus className="h-3.5 w-3.5" /> Add location
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {locations.map((l) => (
          <Card key={l.name} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <MapPin className="h-4 w-4" />
              </div>
              {l.primary && <Badge variant="secondary">Primary</Badge>}
            </div>
            <div className="mt-4 font-medium">{l.name}</div>
            <p className="mt-1 text-xs text-muted-foreground">{l.addr}</p>
            <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
              <span>{l.seats} seats</span>
              <span>·</span>
              <span>Open today</span>
            </div>
            <Separator className="my-4" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1">Edit</Button>
              <Button size="sm" variant="ghost">View</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------- Branding ---------- */

function BrandingSection() {
  const palette = ["#F7F1E6", "#C8553D", "#2C2A29", "#7A8C5C", "#E5A06E"];
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Business"
        title="Branding"
        description="Colors and typography applied to receipts, email, marketing campaigns, and your storefront."
      />
      <Card className="p-6">
        <div className="text-sm font-medium">Brand palette</div>
        <div className="mt-3 flex flex-wrap gap-3">
          {palette.map((c) => (
            <div key={c} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 p-2 pr-3">
              <div className="h-9 w-9 rounded-md border border-border" style={{ background: c }} />
              <div className="text-xs">
                <div className="font-medium">{c}</div>
                <button className="text-muted-foreground hover:text-foreground">Replace</button>
              </div>
            </div>
          ))}
          <button className="flex h-[52px] items-center gap-2 rounded-lg border border-dashed border-border/80 px-3 text-xs text-muted-foreground hover:bg-accent">
            <Plus className="h-3.5 w-3.5" /> Add color
          </button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Display typeface">
            <Select defaultValue="fraunces">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fraunces">Fraunces</SelectItem>
                <SelectItem value="playfair">Playfair Display</SelectItem>
                <SelectItem value="dm-serif">DM Serif Display</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Body typeface">
            <Select defaultValue="inter">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inter">Inter</SelectItem>
                <SelectItem value="manrope">Manrope</SelectItem>
                <SelectItem value="dm-sans">DM Sans</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Voice & tone">
            <Select defaultValue="warm">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="warm">Warm & welcoming</SelectItem>
                <SelectItem value="playful">Playful</SelectItem>
                <SelectItem value="refined">Refined</SelectItem>
                <SelectItem value="bold">Bold</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tagline">
            <Input defaultValue="Neighborhood food. Honest drinks." />
          </Field>
        </div>
      </Card>
    </div>
  );
}

/* ---------- Notifications ---------- */

function NotificationsSection() {
  const groups = [
    {
      title: "Operations",
      items: [
        { t: "Low inventory alerts", d: "Notify when an item drops below par." },
        { t: "Invoice processed", d: "When the AP agent imports a new vendor invoice." },
        { t: "Schedule conflicts", d: "Overtime risk, no-shows, or unfilled shifts." },
      ],
    },
    {
      title: "Guest activity",
      items: [
        { t: "New reviews", d: "Google, Yelp, TripAdvisor, OpenTable." },
        { t: "Negative review (≤3★)", d: "Immediate escalation to managers." },
        { t: "Reservation activity", d: "Large parties, cancellations, no-shows." },
      ],
    },
    {
      title: "Marketing",
      items: [
        { t: "Campaign performance", d: "Daily digest of opens, clicks, attributed revenue." },
        { t: "Segment milestones", d: "When a segment hits revenue or growth thresholds." },
      ],
    },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Workspace"
        title="Notifications"
        description="Choose how and when each event reaches your team."
      />
      <Card className="p-6">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 pb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          <div>Event</div>
          <div className="flex items-center gap-1"><Mail className="h-3 w-3" /> Email</div>
          <div className="flex items-center gap-1"><Smartphone className="h-3 w-3" /> Push</div>
          <div className="flex items-center gap-1"><Phone className="h-3 w-3" /> SMS</div>
        </div>
        {groups.map((g) => (
          <div key={g.title} className="mt-4 first:mt-0">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
              {g.title}
            </div>
            <div className="divide-y divide-border/60 rounded-lg border border-border/60">
              {g.items.map((it) => (
                <div key={it.t} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">{it.t}</div>
                    <div className="text-xs text-muted-foreground">{it.d}</div>
                  </div>
                  <Switch defaultChecked />
                  <Switch defaultChecked />
                  <Switch />
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>

      <Card className="p-6">
        <SectionHeader
          title="Quiet hours"
          description="No push or SMS notifications during this window unless marked urgent."
        />
        <div className="mt-4 flex items-center gap-3">
          <Input type="time" defaultValue="23:00" className="h-9 w-32" />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="time" defaultValue="07:00" className="h-9 w-32" />
        </div>
      </Card>
    </div>
  );
}

/* ---------- Integrations ---------- */

type AppRow = {
  name: string;
  cat: string;
  status: "Connected" | "Available" | "Action needed";
  desc: string;
  meta?: string;
  channel?: "EDI" | "API" | "Email PO" | "Portal" | "CSV";
  onClick?: () => void;
};

function IntegrationsSection() {
  const [toastSheetOpen, setToastSheetOpen] = useState(false);
  const { data: toastConnection } = useToastConnection();
  const { data: gmailConnection, refetch: refetchGmail } = useGmailConnection();
  const connectGmail = useConnectGmail();

  const [callbackBanner, setCallbackBanner] = useState<{
    status: "connected" | "error";
    message?: string;
  } | null>(null);

  // The Gmail OAuth callback (connect-gmail-callback) redirects back
  // here with ?gmail=connected|error — a full page load, not a
  // client-side navigation, so this only needs to run once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("gmail");
    if (status === "connected" || status === "error") {
      setCallbackBanner({ status, message: params.get("message") ?? undefined });
      refetchGmail();
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastSyncedAt = toastConnection?.credential?.last_synced_at;
  const lastSyncedLabel = lastSyncedAt
    ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}.`
    : "Not synced yet.";
  const toastDesc = toastConnection?.connected
    ? `Syncs orders, menu, payments. ${lastSyncedLabel}`
    : "Syncs orders, menu, payments.";

  const gmailDesc = gmailConnection
    ? `Reads vendor invoice emails, sends purchase orders. Connected as ${gmailConnection.connectedEmail}.`
    : "Reads vendor invoice emails, sends purchase orders.";

  const platform: AppRow[] = [
    {
      name: "Toast POS",
      cat: "Point of sale",
      status: toastConnection?.connected ? "Connected" : "Available",
      desc: toastDesc,
      onClick: () => setToastSheetOpen(true),
    },
    {
      name: "Gmail",
      cat: "Invoice inbox",
      status: gmailConnection ? "Connected" : "Available",
      desc: gmailDesc,
      onClick: () => connectGmail.mutate(),
    },
    { name: "Square", cat: "Payments", status: "Connected", desc: "Card processing & online ordering." },
    { name: "QuickBooks Online", cat: "Accounting", status: "Connected", desc: "Pushes invoices, sales, payroll exports." },
    { name: "Mailchimp", cat: "Email", status: "Connected", desc: "Sync segments and send campaigns." },
    { name: "Twilio", cat: "SMS", status: "Connected", desc: "Outbound SMS campaigns & alerts." },
    { name: "7shifts", cat: "Scheduling", status: "Available", desc: "Import shifts and labor data." },
    { name: "Resy", cat: "Reservations", status: "Available", desc: "Sync reservation activity." },
    { name: "Google Business", cat: "Listings", status: "Connected", desc: "Hours, menu, reviews." },
    { name: "Yelp", cat: "Reviews", status: "Connected", desc: "Pull reviews into the inbox." },
    { name: "Slack", cat: "Notifications", status: "Available", desc: "Route alerts to channels." },
    { name: "Stripe", cat: "Payments", status: "Available", desc: "Gift cards & online sales." },
  ];

  const vendors: AppRow[] = [
    { name: "Sysco", cat: "Broadline foodservice", status: "Connected", desc: "Live catalog, pricing, EDI 850/810.", channel: "EDI", meta: "Acct #44-218 · orders by 4pm" },
    { name: "US Foods", cat: "Broadline foodservice", status: "Connected", desc: "MOXē API for catalog, orders, invoices.", channel: "API", meta: "Acct #US-90412 · 24h lead" },
    { name: "Southern Glazer's", cat: "Wine & spirits", status: "Connected", desc: "eXchange portal sync + invoice PDFs.", channel: "Portal", meta: "Lic. #LBD-7781 · Mon/Thu delivery" },
    { name: "Columbia Distributing", cat: "Beer & beverage", status: "Connected", desc: "Auto-send POs by email with PDF attachment.", channel: "Email PO", meta: "rep.bali@columbiadist.com" },
    { name: "Restaurant Depot", cat: "Cash & carry", status: "Action needed", desc: "Cart export via Instacart Business — reconnect.", channel: "Portal", meta: "Token expired 2 days ago" },
    { name: "Performance Food Group", cat: "Broadline foodservice", status: "Available", desc: "PFG Customer API for catalog & invoices.", channel: "API" },
    { name: "Reinhart (RDC)", cat: "Broadline foodservice", status: "Available", desc: "EDI 850/855/810 over SFTP.", channel: "EDI" },
    { name: "Breakthru Beverage", cat: "Wine & spirits", status: "Available", desc: "Portal scrape + email confirmations.", channel: "Portal" },
    { name: "RNDC", cat: "Wine & spirits", status: "Available", desc: "eRNDC catalog + email PO fallback.", channel: "Email PO" },
    { name: "Local Produce Co-op", cat: "Produce", status: "Connected", desc: "CSV order sheet emailed nightly.", channel: "CSV", meta: "orders@localcoop.com" },
    { name: "Bimbo Bakeries", cat: "Bakery", status: "Available", desc: "Standing order via email.", channel: "Email PO" },
    { name: "Edward Don & Co.", cat: "Smallwares", status: "Available", desc: "B2B portal for non-food supplies.", channel: "Portal" },
  ];

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Workspace"
        title="Integrations"
        description="Connect Thrasher's Pub to the systems you already run."
      />

      {callbackBanner && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-sm ${
            callbackBanner.status === "connected"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
        >
          <span>
            {callbackBanner.status === "connected"
              ? "Gmail connected."
              : `Couldn't connect Gmail${callbackBanner.message ? `: ${callbackBanner.message}` : "."}`}
          </span>
          <button className="text-xs underline" onClick={() => setCallbackBanner(null)}>
            Dismiss
          </button>
        </div>
      )}

      <IntegrationGroup
        title="Platform & operations"
        subtitle="POS, payments, accounting, marketing, and listings."
        apps={platform}
      />

      <IntegrationGroup
        title="Vendor integrations"
        subtitle="How the Ordering agent reaches each supplier — EDI, API, portal, or email PO. Powers auto-send from the Inventory cart and invoice ingestion."
        apps={vendors}
        action={
          <Button size="sm" variant="outline" className="gap-2 rounded-full">
            <Plus className="h-3.5 w-3.5" /> Add vendor integration
          </Button>
        }
      />

      <ToastConnectSheet open={toastSheetOpen} onOpenChange={setToastSheetOpen} />
    </div>
  );
}

function ToastConnectSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const connectToast = useConnectToast();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [posLocationRef, setPosLocationRef] = useState("");

  const isValid = clientId.trim() && clientSecret.trim() && posLocationRef.trim();

  const handleConnect = () => {
    if (!isValid) return;
    connectToast.mutate(
      {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        posLocationRef: posLocationRef.trim(),
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setClientId("");
          setClientSecret("");
          setPosLocationRef("");
          connectToast.reset();
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-serif text-2xl flex items-center gap-2">
            <Plug className="h-5 w-5" /> Connect Toast POS
          </SheetTitle>
          <SheetDescription>
            Generate a Client ID and Client Secret in Toast's admin portal (Toast Web →
            Integrations → API Access — no partner approval needed for your own restaurant),
            then paste them here.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="toast-client-id">Client ID</Label>
            <Input
              id="toast-client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="toast-client-secret">Client Secret</Label>
            <Input
              id="toast-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="toast-location-ref">Restaurant GUID</Label>
            <Input
              id="toast-location-ref"
              value={posLocationRef}
              onChange={(e) => setPosLocationRef(e.target.value)}
              autoComplete="off"
              placeholder="e.g. 8f2c1a3e-..."
            />
            <p className="text-xs text-muted-foreground">
              Toast Web → Restaurant Info — labeled "Restaurant GUID" or "External ID."
            </p>
          </div>

          {connectToast.isError && (
            <p className="text-sm text-destructive">{(connectToast.error as Error).message}</p>
          )}

          <Button
            onClick={handleConnect}
            disabled={!isValid || connectToast.isPending}
            className="w-full"
          >
            {connectToast.isPending ? "Verifying with Toast..." : "Connect"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function IntegrationGroup({
  title,
  subtitle,
  apps,
  action,
}: {
  title: string;
  subtitle: string;
  apps: AppRow[];
  action?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <p className="text-xs text-muted-foreground max-w-xl">{subtitle}</p>
        </div>
        {action}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {apps.map((a) => (
          <Card key={a.name} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-foreground/70">
                <Globe className="h-4 w-4" />
              </div>
              <Badge
                variant={a.status === "Connected" ? "secondary" : "outline"}
                className={cn(
                  a.status === "Connected" && "bg-primary/10 text-primary hover:bg-primary/10",
                  a.status === "Action needed" && "border-destructive/40 text-destructive",
                )}
              >
                {a.status === "Connected" && <Check className="mr-1 h-3 w-3" />}
                {a.status}
              </Badge>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="text-sm font-medium">{a.name}</div>
              {a.channel && (
                <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {a.channel}
                </span>
              )}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{a.cat}</div>
            <p className="mt-2 text-xs text-muted-foreground">{a.desc}</p>
            {a.meta && <p className="mt-1 text-[11px] text-muted-foreground/80">{a.meta}</p>}
            <Separator className="my-3" />
            <Button
              size="sm"
              variant={a.status === "Action needed" ? "default" : "outline"}
              className="w-full"
              onClick={a.onClick}
              disabled={!a.onClick}
            >
              {a.status === "Connected"
                ? "Manage"
                : a.status === "Action needed"
                  ? "Reconnect"
                  : "Connect"}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------- API ---------- */

function ApiSection() {
  const keys = [
    { name: "Production", key: "tp_live_••••••••••••rA9k", created: "Mar 14, 2026", lastUsed: "2 min ago" },
    { name: "Staging", key: "tp_test_••••••••••••8xQp", created: "Feb 02, 2026", lastUsed: "1 day ago" },
  ];
  const hooks = [
    { url: "https://hooks.thrasherspub.com/orders", events: "order.created, order.refunded", status: "Active" },
    { url: "https://ops.zapier.com/hooks/abc123", events: "review.new", status: "Active" },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Workspace"
        title="API & webhooks"
        description="Programmatic access for developers and partners."
        action={
          <Button size="sm" className="gap-2 rounded-full">
            <Plus className="h-3.5 w-3.5" /> New API key
          </Button>
        }
      />
      <Card className="p-6">
        <div className="text-sm font-medium">API keys</div>
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.name}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell className="font-mono text-xs">{k.key}</TableCell>
                <TableCell className="text-muted-foreground">{k.created}</TableCell>
                <TableCell className="text-muted-foreground">{k.lastUsed}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" className="h-8 w-8"><Copy className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Webhooks</div>
          <Button size="sm" variant="outline" className="gap-2">
            <Plus className="h-3.5 w-3.5" /> Add endpoint
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {hooks.map((h) => (
            <div
              key={h.url}
              className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/50 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate font-mono text-xs">{h.url}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{h.events}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/10">
                  {h.status}
                </Badge>
                <Button size="icon" variant="ghost" className="h-8 w-8"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Billing ---------- */

function BillingSection() {
  const invoices = [
    { id: "INV-2026-0006", date: "Jun 01, 2026", amt: "$249.00", status: "Paid" },
    { id: "INV-2026-0005", date: "May 01, 2026", amt: "$249.00", status: "Paid" },
    { id: "INV-2026-0004", date: "Apr 01, 2026", amt: "$249.00", status: "Paid" },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Account"
        title="Billing & plan"
        description="Manage subscription, payment method, and invoices."
      />
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/15 via-card to-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Current plan</div>
              <div className="mt-1 flex items-center gap-2">
                <h3 className="font-display text-2xl">Hospitality Pro</h3>
                <Badge variant="secondary" className="bg-primary/15 text-primary">Active</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                $249/month · billed monthly · renews Jul 01, 2026
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline">Change plan</Button>
              <Button size="sm" variant="ghost">Cancel</Button>
            </div>
          </div>
          <Separator className="my-5" />
          <div className="grid gap-6 sm:grid-cols-3">
            <UsageMeter label="AI replies" used={3210} total={5000} />
            <UsageMeter label="SMS sends" used={812} total={2000} />
            <UsageMeter label="Locations" used={2} total={5} />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Payment method</div>
            <div className="mt-1 text-xs text-muted-foreground">Visa ending in 4242 · expires 09/27</div>
          </div>
          <Button size="sm" variant="outline">Update</Button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Invoices</div>
          <Button size="sm" variant="ghost" className="gap-2">
            <Download className="h-3.5 w-3.5" /> Export all
          </Button>
        </div>
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((iv) => (
              <TableRow key={iv.id}>
                <TableCell className="font-medium">{iv.id}</TableCell>
                <TableCell className="text-muted-foreground">{iv.date}</TableCell>
                <TableCell>{iv.amt}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/10">
                    {iv.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" className="gap-1">
                    <Download className="h-3.5 w-3.5" /> PDF
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function UsageMeter({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = Math.min(100, Math.round((used / total) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">
          {used.toLocaleString()} / {total.toLocaleString()}
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ---------- Tax ---------- */

function TaxSection() {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Account"
        title="Tax & compliance"
        description="Sales tax rates, registration IDs, and 1099/W-9 records used across invoicing."
      />
      <Card className="p-6">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Federal EIN">
            <Input defaultValue="83-1248901" />
          </Field>
          <Field label="State sales tax ID">
            <Input defaultValue="DC-2018-4421" />
          </Field>
          <Field label="Default sales tax rate">
            <Input defaultValue="10.00%" />
          </Field>
          <Field label="Liquor tax rate">
            <Input defaultValue="10.25%" />
          </Field>
          <Field label="Tax inclusive pricing">
            <Select defaultValue="exclusive">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exclusive">Tax added at checkout</SelectItem>
                <SelectItem value="inclusive">Tax included in menu price</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Fiscal year start">
            <Select defaultValue="jan">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="jan">January</SelectItem>
                <SelectItem value="jul">July</SelectItem>
                <SelectItem value="oct">October</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title="Documents"
          description="Stored W-9s, resale certificates, and health permits."
          action={
            <Button size="sm" variant="outline" className="gap-2">
              <Upload className="h-3.5 w-3.5" /> Upload
            </Button>
          }
        />
        <div className="mt-4 space-y-2">
          {[
            { name: "W-9 — Thrasher's Pub LLC.pdf", date: "Jan 12, 2026" },
            { name: "DC Resale Certificate 2026.pdf", date: "Jan 15, 2026" },
            { name: "Health Permit — H Street.pdf", date: "Mar 02, 2026" },
          ].map((d) => (
            <div key={d.name} className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-4 py-3">
              <div>
                <div className="text-sm font-medium">{d.name}</div>
                <div className="text-xs text-muted-foreground">Uploaded {d.date}</div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8"><Download className="h-3.5 w-3.5" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Security ---------- */

function SecuritySection() {
  const sessions = [
    { device: "MacBook Pro · Safari", loc: "Washington, DC", last: "Active now", current: true },
    { device: "iPhone 15 · Lovable app", loc: "Washington, DC", last: "1 hour ago", current: false },
    { device: "Windows · Chrome", loc: "Arlington, VA", last: "Yesterday", current: false },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Account"
        title="Security"
        description="Protect your account and review who has access."
      />
      <Card className="divide-y divide-border/60 p-6 py-0">
        <Row title="Two-factor authentication" description="Require a 6-digit code from an authenticator app at sign-in.">
          <Switch defaultChecked />
        </Row>
        <Row title="Single sign-on (SSO)" description="SAML / OIDC for your organization. Available on Hospitality Pro+.">
          <Button size="sm" variant="outline">Configure</Button>
        </Row>
        <Row title="Password" description="Last changed 42 days ago.">
          <Button size="sm" variant="outline">Change</Button>
        </Row>
        <Row title="Session timeout" description="Automatically sign out after inactivity.">
          <Select defaultValue="60">
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15 minutes</SelectItem>
              <SelectItem value="60">1 hour</SelectItem>
              <SelectItem value="480">8 hours</SelectItem>
              <SelectItem value="0">Never</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Active sessions</div>
          <Button size="sm" variant="ghost" className="text-destructive">Sign out all</Button>
        </div>
        <div className="mt-3 space-y-2">
          {sessions.map((s) => (
            <div key={s.device} className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-4 py-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {s.device}
                  {s.current && (
                    <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/10">This device</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{s.loc} · {s.last}</div>
              </div>
              {!s.current && <Button size="sm" variant="ghost">Revoke</Button>}
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-destructive/30 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-destructive">Danger zone</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Export all data or permanently delete this workspace. This cannot be undone.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-2">
              <ExternalLink className="h-3.5 w-3.5" /> Export data
            </Button>
            <Button size="sm" variant="destructive">Delete workspace</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
