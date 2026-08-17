import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Building2,
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
  AlertTriangle,
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
import { useAuth } from "@/lib/supabase/auth-context";
import { useCurrentRestaurant } from "@/lib/restaurant-context";
import { supabase } from "@/lib/supabase/client";
import {
  useUpdateRestaurantName,
  useLocationsForSettings,
  useUpdateLocation,
} from "@/lib/settings/queries";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings · Thrasher's Pub" }] }),
  component: SettingsPage,
});

type SectionId =
  | "profile"
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
        {description && <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// Every section below that has no real backend gets one of these —
// loud enough that it can't be mistaken for a real save, honest about
// exactly what's fake so a later pass knows precisely what to build
// rather than re-auditing the whole page again.
function PlaceholderBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <span className="font-medium">Not built yet.</span> {children}
      </div>
    </div>
  );
}

/* ---------- Profile ---------- */

function ProfileSection() {
  const { currentRestaurant } = useCurrentRestaurant();
  const updateName = useUpdateRestaurantName();
  const [name, setName] = useState(currentRestaurant?.name ?? "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(currentRestaurant?.name ?? "");
  }, [currentRestaurant?.name]);

  const dirty =
    currentRestaurant != null && name.trim() !== currentRestaurant.name && name.trim() !== "";

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Business"
        title="Restaurant profile"
        description="Only the restaurant name is real right now — everything else on this page is a placeholder for what a full profile would eventually cover."
      />

      <Card className="p-6">
        <div className="max-w-md">
          <Field
            label="Restaurant name"
            hint="Shown across the dashboard, including the restaurant switcher."
          >
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                disabled={!currentRestaurant}
              />
              <Button
                size="sm"
                disabled={!dirty || updateName.isPending}
                onClick={() => {
                  if (!currentRestaurant) return;
                  updateName.mutate(
                    { id: currentRestaurant.id, name: name.trim() },
                    { onSuccess: () => setSaved(true) },
                  );
                }}
              >
                {updateName.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </Field>
          {updateName.isError && (
            <p className="mt-2 text-xs text-destructive">{(updateName.error as Error).message}</p>
          )}
          {saved && !updateName.isError && <p className="mt-2 text-xs text-emerald-700">Saved.</p>}
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <PlaceholderBanner>
          Logo, legal business name, cuisine/category, price tier, public contact info, and
          description have no database columns yet — nothing below is saved.
        </PlaceholderBanner>
        <div className="flex items-start gap-5 opacity-60">
          <div className="grid h-20 w-20 place-items-center rounded-2xl bg-primary/10 font-display text-2xl text-primary">
            {(currentRestaurant?.name ?? "?").slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 space-y-1">
            <div className="text-sm font-medium">Logo & brand mark</div>
            <p className="text-xs text-muted-foreground">
              Square PNG or SVG, transparent background. Used on receipts, email, and social.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" className="gap-2" disabled>
                <Upload className="h-3.5 w-3.5" /> Upload
              </Button>
              <Button size="sm" variant="ghost" disabled>
                Remove
              </Button>
            </div>
          </div>
        </div>
        <div className="grid gap-5 opacity-60 md:grid-cols-2">
          <Field label="Legal business name">
            <Input defaultValue="Thrasher's Pub LLC" disabled />
          </Field>
          <Field label="Cuisine / category">
            <Select defaultValue="pub" disabled>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pub">Gastropub</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Price tier">
            <Select defaultValue="$$" disabled>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="$$">$$ – Casual</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Public email">
            <Input defaultValue="hello@thrasherspub.com" disabled />
          </Field>
          <Field label="Reservations phone">
            <Input defaultValue="(202) 555-0144" disabled />
          </Field>
          <Field label="Website">
            <Input defaultValue="https://thrasherspub.com" disabled />
          </Field>
          <div className="md:col-span-2">
            <Field label="Short description">
              <Textarea
                rows={3}
                defaultValue="Neighborhood gastropub with seasonal small plates, wood-fired classics, and a 40+ craft beer lineup."
                disabled
              />
            </Field>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ---------- Locations ---------- */

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

function LocationEditor({
  location,
}: {
  location: { id: string; name: string; timezone: string };
}) {
  const updateLocation = useUpdateLocation();
  const [name, setName] = useState(location.name);
  const [timezone, setTimezone] = useState(location.timezone);
  const [saved, setSaved] = useState(false);
  const dirty = name.trim() !== location.name || timezone !== location.timezone;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <MapPin className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <Field label="Timezone">
          <Select
            value={timezone}
            onValueChange={(v) => {
              setTimezone(v);
              setSaved(false);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Address and seating capacity aren't tracked yet.
      </p>
      <Separator className="my-4" />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || !name.trim() || updateLocation.isPending}
          onClick={() =>
            updateLocation.mutate(
              { id: location.id, name: name.trim(), timezone },
              { onSuccess: () => setSaved(true) },
            )
          }
        >
          {updateLocation.isPending ? "Saving…" : "Save"}
        </Button>
        {saved && !updateLocation.isPending && (
          <span className="text-xs text-emerald-700">Saved.</span>
        )}
        {updateLocation.isError && (
          <span className="text-xs text-destructive">
            {(updateLocation.error as Error).message}
          </span>
        )}
      </div>
    </Card>
  );
}

function LocationsSection() {
  const { data: locations = [], isLoading } = useLocationsForSettings();
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Business"
        title="Locations"
        description="Real locations, editable name and timezone. Adding a new location isn't built here — locations are provisioned during Toast setup."
        action={
          <Button
            size="sm"
            className="gap-2 rounded-full"
            disabled
            title="Not built yet — add locations via Toast setup"
          >
            <Plus className="h-3.5 w-3.5" /> Add location
          </Button>
        }
      />
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : locations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No locations found for this restaurant.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {locations.map((l) => (
            <LocationEditor key={l.id} location={l} />
          ))}
        </div>
      )}
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
      <PlaceholderBanner>
        No branding table exists — nothing on this page persists. This is a mockup of what a real
        branding editor could look like.
      </PlaceholderBanner>
      <Card className="p-6 opacity-60">
        <div className="text-sm font-medium">Brand palette</div>
        <div className="mt-3 flex flex-wrap gap-3">
          {palette.map((c) => (
            <div
              key={c}
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 p-2 pr-3"
            >
              <div className="h-9 w-9 rounded-md border border-border" style={{ background: c }} />
              <div className="text-xs">
                <div className="font-medium">{c}</div>
                <span className="text-muted-foreground">Replace</span>
              </div>
            </div>
          ))}
          <div className="flex h-[52px] items-center gap-2 rounded-lg border border-dashed border-border/80 px-3 text-xs text-muted-foreground">
            <Plus className="h-3.5 w-3.5" /> Add color
          </div>
        </div>
      </Card>

      <Card className="p-6 opacity-60">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Display typeface">
            <Select defaultValue="fraunces" disabled>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fraunces">Fraunces</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Body typeface">
            <Select defaultValue="inter" disabled>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inter">Inter</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Voice & tone">
            <Select defaultValue="warm" disabled>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warm">Warm & welcoming</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Tagline">
            <Input defaultValue="Neighborhood food. Honest drinks." disabled />
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
      <PlaceholderBanner>
        No notification-preferences table exists — every toggle below is illustrative only, nothing
        is sent or saved based on these.
      </PlaceholderBanner>
      <Card className="p-6 opacity-60">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 pb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          <div>Event</div>
          <div className="flex items-center gap-1">
            <Mail className="h-3 w-3" /> Email
          </div>
          <div className="flex items-center gap-1">
            <Smartphone className="h-3 w-3" /> Push
          </div>
          <div className="flex items-center gap-1">
            <Phone className="h-3 w-3" /> SMS
          </div>
        </div>
        {groups.map((g) => (
          <div key={g.title} className="mt-4 first:mt-0">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground/80">
              {g.title}
            </div>
            <div className="divide-y divide-border/60 rounded-lg border border-border/60">
              {g.items.map((it) => (
                <div
                  key={it.t}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-medium">{it.t}</div>
                    <div className="text-xs text-muted-foreground">{it.d}</div>
                  </div>
                  <Switch defaultChecked disabled />
                  <Switch defaultChecked disabled />
                  <Switch disabled />
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>

      <Card className="p-6 opacity-60">
        <SectionHeader
          title="Quiet hours"
          description="No push or SMS notifications during this window unless marked urgent."
        />
        <div className="mt-4 flex items-center gap-3">
          <Input type="time" defaultValue="23:00" className="h-9 w-32" disabled />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="time" defaultValue="07:00" className="h-9 w-32" disabled />
        </div>
      </Card>
    </div>
  );
}

/* ---------- Integrations ---------- */

type AppRow = {
  name: string;
  cat: string;
  status: "Connected" | "Available" | "Action needed" | "Not built";
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

  // Everything past Toast/Gmail below is "Not built" — no real
  // credential, no real sync — kept in the list only as a roadmap of
  // what could eventually be connected, not as a claim it already is.
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
    {
      name: "Square",
      cat: "Payments",
      status: "Not built",
      desc: "Card processing & online ordering.",
    },
    {
      name: "QuickBooks Online",
      cat: "Accounting",
      status: "Not built",
      desc: "Pushes invoices, sales, payroll exports.",
    },
    {
      name: "Mailchimp",
      cat: "Email",
      status: "Not built",
      desc: "Sync segments and send campaigns.",
    },
    { name: "Twilio", cat: "SMS", status: "Not built", desc: "Outbound SMS campaigns & alerts." },
    {
      name: "7shifts",
      cat: "Scheduling",
      status: "Not built",
      desc: "Import shifts and labor data.",
    },
    { name: "Resy", cat: "Reservations", status: "Not built", desc: "Sync reservation activity." },
    {
      name: "Google Business",
      cat: "Listings",
      status: "Not built",
      desc: "Hours, menu, reviews.",
    },
    { name: "Yelp", cat: "Reviews", status: "Not built", desc: "Pull reviews into the inbox." },
    { name: "Slack", cat: "Notifications", status: "Not built", desc: "Route alerts to channels." },
    { name: "Stripe", cat: "Payments", status: "Not built", desc: "Gift cards & online sales." },
  ];

  const vendors: AppRow[] = [
    {
      name: "Sysco",
      cat: "Broadline foodservice",
      status: "Not built",
      desc: "Live catalog, pricing, EDI 850/810.",
      channel: "EDI",
    },
    {
      name: "US Foods",
      cat: "Broadline foodservice",
      status: "Not built",
      desc: "MOXē API for catalog, orders, invoices.",
      channel: "API",
    },
    {
      name: "Southern Glazer's",
      cat: "Wine & spirits",
      status: "Not built",
      desc: "eXchange portal sync + invoice PDFs.",
      channel: "Portal",
    },
    {
      name: "Columbia Distributing",
      cat: "Beer & beverage",
      status: "Not built",
      desc: "Auto-send POs by email with PDF attachment.",
      channel: "Email PO",
    },
    {
      name: "Restaurant Depot",
      cat: "Cash & carry",
      status: "Not built",
      desc: "Cart export via Instacart Business.",
      channel: "Portal",
    },
    {
      name: "Performance Food Group",
      cat: "Broadline foodservice",
      status: "Not built",
      desc: "PFG Customer API for catalog & invoices.",
      channel: "API",
    },
    {
      name: "Reinhart (RDC)",
      cat: "Broadline foodservice",
      status: "Not built",
      desc: "EDI 850/855/810 over SFTP.",
      channel: "EDI",
    },
    {
      name: "Breakthru Beverage",
      cat: "Wine & spirits",
      status: "Not built",
      desc: "Portal scrape + email confirmations.",
      channel: "Portal",
    },
    {
      name: "RNDC",
      cat: "Wine & spirits",
      status: "Not built",
      desc: "eRNDC catalog + email PO fallback.",
      channel: "Email PO",
    },
    {
      name: "Local Produce Co-op",
      cat: "Produce",
      status: "Not built",
      desc: "CSV order sheet emailed nightly.",
      channel: "CSV",
    },
    {
      name: "Bimbo Bakeries",
      cat: "Bakery",
      status: "Not built",
      desc: "Standing order via email.",
      channel: "Email PO",
    },
    {
      name: "Edward Don & Co.",
      cat: "Smallwares",
      status: "Not built",
      desc: "B2B portal for non-food supplies.",
      channel: "Portal",
    },
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

      <PlaceholderBanner>
        Toast POS and Gmail are the only real, live integrations. Everything else below is shown as
        a roadmap of what could be connected later — none of it is wired up.
      </PlaceholderBanner>

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
          <Button
            size="sm"
            variant="outline"
            className="gap-2 rounded-full"
            disabled
            title="Not built yet"
          >
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
            Generate a Client ID and Client Secret in Toast's admin portal (Toast Web → Integrations
            → API Access — no partner approval needed for your own restaurant), then paste them
            here.
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
          <Card key={a.name} className={cn("p-4", a.status === "Not built" && "opacity-70")}>
            <div className="flex items-start justify-between gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-foreground/70">
                <Globe className="h-4 w-4" />
              </div>
              <Badge
                variant={a.status === "Connected" ? "secondary" : "outline"}
                className={cn(
                  a.status === "Connected" && "bg-primary/10 text-primary hover:bg-primary/10",
                  a.status === "Action needed" && "border-destructive/40 text-destructive",
                  a.status === "Not built" && "border-muted-foreground/30 text-muted-foreground",
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
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {a.cat}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{a.desc}</p>
            {a.meta && <p className="mt-1 text-[11px] text-muted-foreground/80">{a.meta}</p>}
            <Separator className="my-3" />
            <Button
              size="sm"
              variant={a.status === "Action needed" ? "default" : "outline"}
              className="w-full"
              onClick={a.onClick}
              disabled={!a.onClick}
              title={!a.onClick ? "Not built yet" : undefined}
            >
              {a.status === "Connected"
                ? "Manage"
                : a.status === "Action needed"
                  ? "Reconnect"
                  : a.status === "Not built"
                    ? "Not built yet"
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
    {
      name: "Production",
      key: "tp_live_••••••••••••rA9k",
      created: "Mar 14, 2026",
      lastUsed: "2 min ago",
    },
  ];
  const hooks = [
    {
      url: "https://hooks.thrasherspub.com/orders",
      events: "order.created, order.refunded",
      status: "Active",
    },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Workspace"
        title="API & webhooks"
        description="Programmatic access for developers and partners."
      />
      <PlaceholderBanner>
        This app has no public API today — there's nowhere for a real key to authenticate against.
        The table below is illustrative only.
      </PlaceholderBanner>
      <Card className="p-6 opacity-60">
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
                    <Button size="icon" variant="ghost" className="h-8 w-8" disabled>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      disabled
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

      <Card className="p-6 opacity-60">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Webhooks</div>
          <Button size="sm" variant="outline" className="gap-2" disabled>
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
                <Badge
                  variant="secondary"
                  className="bg-primary/10 text-primary hover:bg-primary/10"
                >
                  {h.status}
                </Badge>
                <Button size="icon" variant="ghost" className="h-8 w-8" disabled>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" disabled>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
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
  const invoices = [{ id: "INV-2026-0006", date: "Jun 01, 2026", amt: "$249.00", status: "Paid" }];
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Account"
        title="Billing & plan"
        description="Manage subscription, payment method, and invoices."
      />
      <PlaceholderBanner>
        No Stripe subscription is wired up — the restaurants table has a stripe_customer_id column
        but nothing populates or reads it yet. Everything below is a mockup.
      </PlaceholderBanner>
      <Card className="overflow-hidden opacity-60">
        <div className="bg-gradient-to-br from-primary/15 via-card to-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Current plan
              </div>
              <div className="mt-1 flex items-center gap-2">
                <h3 className="font-display text-2xl">Hospitality Pro</h3>
                <Badge variant="secondary" className="bg-primary/15 text-primary">
                  Example
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                $249/month · billed monthly · renews Jul 01, 2026
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled>
                Change plan
              </Button>
              <Button size="sm" variant="ghost" disabled>
                Cancel
              </Button>
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

      <Card className="p-6 opacity-60">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Payment method</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Visa ending in 4242 · expires 09/27
            </div>
          </div>
          <Button size="sm" variant="outline" disabled>
            Update
          </Button>
        </div>
      </Card>

      <Card className="p-6 opacity-60">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Invoices</div>
          <Button size="sm" variant="ghost" className="gap-2" disabled>
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
                  <Badge
                    variant="secondary"
                    className="bg-primary/10 text-primary hover:bg-primary/10"
                  >
                    {iv.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" className="gap-1" disabled>
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
      <PlaceholderBanner>
        No tax-settings table or document storage exists yet — nothing below is saved.
      </PlaceholderBanner>
      <Card className="p-6 opacity-60">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Federal EIN">
            <Input defaultValue="83-1248901" disabled />
          </Field>
          <Field label="State sales tax ID">
            <Input defaultValue="DC-2018-4421" disabled />
          </Field>
          <Field label="Default sales tax rate">
            <Input defaultValue="10.00%" disabled />
          </Field>
          <Field label="Liquor tax rate">
            <Input defaultValue="10.25%" disabled />
          </Field>
          <Field label="Tax inclusive pricing">
            <Select defaultValue="exclusive" disabled>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exclusive">Tax added at checkout</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Fiscal year start">
            <Select defaultValue="jan" disabled>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jan">January</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="p-6 opacity-60">
        <SectionHeader
          title="Documents"
          description="Stored W-9s, resale certificates, and health permits."
          action={
            <Button size="sm" variant="outline" className="gap-2" disabled>
              <Upload className="h-3.5 w-3.5" /> Upload
            </Button>
          }
        />
        <div className="mt-4 space-y-2">
          {[{ name: "W-9 — example.pdf", date: "Jan 12, 2026" }].map((d) => (
            <div
              key={d.name}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium">{d.name}</div>
                <div className="text-xs text-muted-foreground">Uploaded {d.date}</div>
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" disabled>
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" disabled>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Security ---------- */

function ChangePasswordCard() {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mismatch = confirm.length > 0 && newPassword !== confirm;
  const tooShort = newPassword.length > 0 && newPassword.length < 6;
  const canSubmit = newPassword.length >= 6 && newPassword === confirm && !pending;

  async function handleSubmit() {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    setSuccess(false);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setPending(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSuccess(true);
    setNewPassword("");
    setConfirm("");
  }

  return (
    <Row title="Password" description="Set a new password for this account.">
      <div className="w-64 space-y-2">
        <Input
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            setSuccess(false);
          }}
          autoComplete="new-password"
        />
        <Input
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setSuccess(false);
          }}
          autoComplete="new-password"
        />
        {tooShort && <p className="text-xs text-destructive">At least 6 characters.</p>}
        {mismatch && <p className="text-xs text-destructive">Passwords don't match.</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {success && <p className="text-xs text-emerald-700">Password updated.</p>}
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          {pending ? "Saving…" : "Change password"}
        </Button>
      </div>
    </Row>
  );
}

function SecuritySection() {
  const { user } = useAuth();
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOutAll() {
    setSignOutPending(true);
    setSignOutError(null);
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
      setSignOutError(error.message);
      setSignOutPending(false);
    }
    // On success the app's own onAuthStateChange listener (auth-context.tsx)
    // picks up the cleared session and the root route guard redirects
    // to /login — no manual navigation needed here.
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Account"
        title="Security"
        description={user?.email ? `Signed in as ${user.email}.` : undefined}
      />
      <Card className="divide-y divide-border/60 p-6 py-0">
        <Row
          title="Two-factor authentication"
          description="Not built yet — requires a real TOTP enrollment flow."
        >
          <Switch disabled />
        </Row>
        <Row
          title="Single sign-on (SSO)"
          description="Not built yet — SAML / OIDC needs real IdP configuration."
        >
          <Button size="sm" variant="outline" disabled>
            Configure
          </Button>
        </Row>
        <ChangePasswordCard />
        <Row title="Session timeout" description="Not built yet — nothing currently enforces this.">
          <Select defaultValue="60" disabled>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="60">1 hour</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Sign out everywhere</div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ends this account's session on every device, including this one.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={signOutPending}
            onClick={handleSignOutAll}
          >
            {signOutPending ? "Signing out…" : "Sign out all"}
          </Button>
        </div>
        {signOutError && <p className="mt-2 text-xs text-destructive">{signOutError}</p>}
        <p className="mt-3 text-xs text-muted-foreground">
          A real per-device session list isn't built — Supabase doesn't expose that to the client
          SDK without an admin API.
        </p>
      </Card>

      <Card className="border-destructive/30 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-destructive">Danger zone</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Not built yet. Deleting a workspace means cascading through every table in a
              multi-tenant schema — real, deliberate design work before this should ever be enabled,
              not a quick add.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-2" disabled>
              <ExternalLink className="h-3.5 w-3.5" /> Export data
            </Button>
            <Button size="sm" variant="destructive" disabled>
              Delete workspace
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
