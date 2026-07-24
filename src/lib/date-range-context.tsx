import { createContext, useContext, useState, type ReactNode } from "react";

import { type DateRange, addDays, startOfDay } from "@/lib/date-range";

// 30 days, not 7 — real invoice volume is low enough (a handful
// spread across months) that a 7-day default made the Invoices page
// look empty on every fresh visit even though nothing was missing.
// 30 days is still a meaningful "recent activity" window for the
// daily-cadence pages (Home, Product Mix) without hiding sparser data.
function defaultRange(): DateRange {
  const today = startOfDay(new Date());
  return { from: addDays(today, -29), to: today };
}

const DateRangeContext = createContext<{
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
} | null>(null);

// One shared date range for the whole app, not per-page state — lives
// above the router's Outlet so it survives navigation (picking a
// range on Home and clicking to another page and back keeps it).
export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [dateRange, setDateRange] = useState<DateRange>(defaultRange);
  return (
    <DateRangeContext.Provider value={{ dateRange, setDateRange }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error("useDateRange must be used within a DateRangeProvider");
  return ctx;
}
