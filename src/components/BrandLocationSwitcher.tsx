import { useState } from "react";
import { ChevronsUpDown, Plus, UtensilsCrossed } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentRestaurant } from "@/lib/restaurant-context";
import { useCurrentLocation } from "@/lib/location-context";
import { useCreateRestaurant } from "@/lib/restaurants/queries";
import { useCreateLocation } from "@/lib/settings/queries";
import { useLanguage } from "@/lib/i18n/language-context";
import { TIMEZONES } from "@/lib/timezones";

// Exported so the Brands overview page (src/routes/brands.tsx) can
// reuse the exact same creation flow instead of a second copy.
export function AddBrandDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { setCurrentRestaurantId } = useCurrentRestaurant();
  const createRestaurant = useCreateRestaurant();
  const [name, setName] = useState("");
  const [locationName, setLocationName] = useState("Main");
  const [timezone, setTimezone] = useState(TIMEZONES[1]);

  function reset() {
    setName("");
    setLocationName("Main");
    setTimezone(TIMEZONES[1]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add a brand</DialogTitle>
          <DialogDescription>
            Creates a new restaurant with its own name, menu, and vendors — you'll be its owner.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Brand name
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
        </div>
        {createRestaurant.isError && (
          <p className="text-xs text-destructive">{(createRestaurant.error as Error).message}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || createRestaurant.isPending}
            onClick={() => {
              createRestaurant.mutate(
                {
                  name: name.trim(),
                  locationName: locationName.trim() || "Main",
                  locationTimezone: timezone,
                },
                {
                  onSuccess: (newRestaurantId) => {
                    setCurrentRestaurantId(newRestaurantId);
                    onOpenChange(false);
                    reset();
                  },
                },
              );
            }}
          >
            {createRestaurant.isPending ? "Creating…" : "Create brand"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddLocationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { currentRestaurant } = useCurrentRestaurant();
  const { setCurrentLocationId } = useCurrentLocation();
  const createLocation = useCreateLocation();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(TIMEZONES[0]);

  function reset() {
    setName("");
    setTimezone(TIMEZONES[0]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Add a location</DialogTitle>
          <DialogDescription>
            Adds another location to {currentRestaurant?.name ?? "this brand"}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Name
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Blue Bird Cafe — Downtown"
              autoFocus
            />
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
        </div>
        {createLocation.isError && (
          <p className="text-xs text-destructive">{(createLocation.error as Error).message}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || createLocation.isPending}
            onClick={() => {
              createLocation.mutate(
                { name: name.trim(), timezone },
                {
                  onSuccess: (newLocationId) => {
                    setCurrentLocationId(newLocationId);
                    onOpenChange(false);
                    reset();
                  },
                },
              );
            }}
          >
            {createLocation.isPending ? "Creating…" : "Create location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Replaces the old buried footer-dropdown switcher (restaurant +
// location radio groups mixed in with Language/Logout) — this is now
// the single, prominent place brand/location switching and creation
// happen, in the sidebar header where it's the first thing visible.
export function BrandLocationSwitcher() {
  const { t } = useLanguage();
  const { restaurants, currentRestaurantId, currentRestaurant, setCurrentRestaurantId } =
    useCurrentRestaurant();
  const { locations, currentLocationId, currentLocation, setCurrentLocationId } =
    useCurrentLocation();
  const [addBrandOpen, setAddBrandOpen] = useState(false);
  const [addLocationOpen, setAddLocationOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg py-1 text-left transition-colors hover:bg-sidebar-accent"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft">
              <UtensilsCrossed className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-base leading-tight">
                {currentRestaurant?.name ?? "…"}
              </div>
              <div className="truncate text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {currentLocation?.name ?? t.sidebar.tagline}
              </div>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-64">
          <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {t.profile.restaurant}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={currentRestaurantId ?? ""}
            onValueChange={(v) => setCurrentRestaurantId(v)}
          >
            {restaurants.map((r) => (
              <DropdownMenuRadioItem key={r.id} value={r.id}>
                {r.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuItem className="gap-2" onSelect={() => setAddBrandOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add brand
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {t.profile.location}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={currentLocationId ?? ""}
            onValueChange={(v) => setCurrentLocationId(v)}
          >
            {locations.map((l) => (
              <DropdownMenuRadioItem key={l.id} value={l.id}>
                {l.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuItem className="gap-2" onSelect={() => setAddLocationOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add location
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddBrandDialog open={addBrandOpen} onOpenChange={setAddBrandOpen} />
      <AddLocationDialog open={addLocationOpen} onOpenChange={setAddLocationOpen} />
    </>
  );
}
