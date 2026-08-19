import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Building2, Check, Copy, Plus, ShieldOff } from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIMEZONES } from "@/lib/timezones";
import { usePlatformAdmin, useTenants, useCreateTenant } from "@/lib/company/queries";

export const Route = createFileRoute("/company")({
  head: () => ({ meta: [{ title: "Company · Thrasher's Pub" }] }),
  component: CompanyPage,
});

function CompanyPage() {
  const isPlatformAdmin = usePlatformAdmin();

  // Hiding the nav link isn't real access control (see __root.tsx's
  // RouteGuard comment on the same point) — the edge function is the
  // actual enforcement; this is just so a direct visit doesn't render
  // a confusing empty table for a non-admin instead of an explanation.
  if (!isPlatformAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <ShieldOff className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold text-foreground">You don't have access</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This page is for platform operators only.
          </p>
        </div>
      </div>
    );
  }

  return <TenantList />;
}

function TenantList() {
  const { data: tenants = [], isLoading } = useTenants();
  const [newTenantOpen, setNewTenantOpen] = useState(false);

  return (
    <>
      <Topbar eyebrow="Company" title="Tenants" />
      <main className="px-6 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every restaurant onboarded onto the platform, and its subscription status.
          </p>
          <Button size="sm" className="gap-2 rounded-full" onClick={() => setNewTenantOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New tenant
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tenants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tenants yet.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tenants.map((t) => (
              <Card key={t.id} className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-display text-lg">{t.name}</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.locationCount} location{t.locationCount === 1 ? "" : "s"} · created{" "}
                      {new Date(t.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.planTier ? (
                    <Badge variant="outline" className="capitalize">
                      {t.planTier === "boh" ? "Back of House" : "Full Suite"}
                    </Badge>
                  ) : (
                    <Badge variant="outline">No subscription</Badge>
                  )}
                  {t.status && (
                    <Badge
                      variant={
                        t.status === "active" || t.status === "trialing" ? "default" : "outline"
                      }
                    >
                      {t.status}
                    </Badge>
                  )}
                </div>
                <p className="mt-3 truncate text-xs text-muted-foreground">
                  {t.ownerEmails.length > 0 ? t.ownerEmails.join(", ") : "No owner yet"}
                </p>
              </Card>
            ))}
          </div>
        )}
      </main>
      <NewTenantDialog open={newTenantOpen} onOpenChange={setNewTenantOpen} />
    </>
  );
}

function NewTenantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const createTenant = useCreateTenant();
  const [name, setName] = useState("");
  const [locationName, setLocationName] = useState("Main");
  const [timezone, setTimezone] = useState(TIMEZONES[1]);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [copied, setCopied] = useState(false);

  function reset() {
    setName("");
    setLocationName("Main");
    setTimezone(TIMEZONES[1]);
    setOwnerEmail("");
    setCopied(false);
    createTenant.reset();
  }

  const result = createTenant.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New tenant</DialogTitle>
          <DialogDescription>
            Creates the restaurant and invites its owner. They'll finish their own setup — POS,
            recipes, billing — once they log in.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              {name.trim() || "The restaurant"} was created.{" "}
              {result.alreadyRegistered
                ? "That email already has an account — they were added as owner directly, no invite needed."
                : "Copy this invite link and send it to the new owner."}
            </p>
            {result.inviteLink && (
              <div className="flex items-center gap-2">
                <Input readOnly value={result.inviteLink} className="text-xs" />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(result.inviteLink!);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Restaurant name
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Blue Bird Cafe"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                First location name
              </Label>
              <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Timezone
              </Label>
              <Select value={timezone} onValueChange={setTimezone}>
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
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Owner email
              </Label>
              <Input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="owner@restaurant.com"
              />
            </div>
          </div>
        )}

        {createTenant.isError && (
          <p className="text-xs text-destructive">{(createTenant.error as Error).message}</p>
        )}

        <DialogFooter>
          {result ? (
            <Button
              onClick={() => {
                onOpenChange(false);
                reset();
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={!name.trim() || !ownerEmail.includes("@") || createTenant.isPending}
                onClick={() => {
                  createTenant.mutate({
                    name: name.trim(),
                    locationName: locationName.trim() || "Main",
                    locationTimezone: timezone,
                    ownerEmail: ownerEmail.trim(),
                  });
                }}
              >
                {createTenant.isPending ? "Creating…" : "Create tenant"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
