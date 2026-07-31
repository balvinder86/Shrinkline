import { SidebarTrigger } from "@/components/ui/sidebar";
import { GlobalSearch } from "@/components/dashboard/GlobalSearch";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { useDateRange } from "@/lib/date-range-context";

export function Topbar({ title, eyebrow }: { title: string; eyebrow?: string }) {
  const { dateRange, setDateRange } = useDateRange();

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-3">
          <SidebarTrigger className="h-9 w-9 rounded-lg hover:bg-accent" />
          <div className="hidden h-6 w-px bg-border sm:block" />
          <div className="min-w-0">
            {eyebrow && (
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                {eyebrow}
              </div>
            )}
            <h1 className="truncate font-display text-xl sm:text-[22px]">{title}</h1>
          </div>
        </div>
        <div className="hidden md:block">
          <GlobalSearch />
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker range={dateRange} onRangeChange={setDateRange} />
        </div>
      </div>
      {/* Global search needs full width to be usable — doesn't fit
          inline with the title/date-picker row on a phone, so it gets
          its own row below instead of just disappearing under md. */}
      <div className="border-t border-border/70 px-4 py-2 md:hidden">
        <GlobalSearch />
      </div>
    </header>
  );
}
