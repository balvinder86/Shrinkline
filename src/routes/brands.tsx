import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MapPin, Plus } from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddBrandDialog } from "@/components/BrandLocationSwitcher";
import { useBrandsOverview } from "@/lib/restaurants/queries";
import { useCurrentRestaurant } from "@/lib/restaurant-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/brands")({
  head: () => ({ meta: [{ title: "Brands · Thrasher's Pub" }] }),
  component: BrandsPage,
});

function BrandsPage() {
  const { data: brands = [], isLoading } = useBrandsOverview();
  const { currentRestaurantId, setCurrentRestaurantId } = useCurrentRestaurant();
  const [addBrandOpen, setAddBrandOpen] = useState(false);

  return (
    <>
      <Topbar eyebrow="Workspace" title="Brands" />
      <main className="px-6 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every restaurant you belong to, and its locations. Switch to one from the sidebar
            switcher, or add a new brand here.
          </p>
          <Button size="sm" className="gap-2 rounded-full" onClick={() => setAddBrandOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add brand
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">No brands found.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {brands.map((b) => {
              const isCurrent = b.id === currentRestaurantId;
              return (
                <Card key={b.id} className={cn("p-5", isCurrent && "border-primary/50")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-display text-lg">{b.name}</div>
                      <Badge variant="outline" className="mt-1.5 capitalize">
                        {b.role}
                      </Badge>
                    </div>
                    {isCurrent ? (
                      <Badge className="shrink-0">Current</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => setCurrentRestaurantId(b.id)}
                      >
                        Switch
                      </Button>
                    )}
                  </div>
                  <div className="mt-4 space-y-1.5">
                    {b.locations.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No locations yet.</p>
                    ) : (
                      b.locations.map((l) => (
                        <div key={l.id} className="flex items-center gap-2 text-sm">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{l.name}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {l.timezone}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>
      <AddBrandDialog open={addBrandOpen} onOpenChange={setAddBrandOpen} />
    </>
  );
}
