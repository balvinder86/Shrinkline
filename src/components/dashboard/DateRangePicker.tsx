import { useState } from "react";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { Calendar as CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type DateRange, addDays, formatDateRange, startOfDay } from "@/lib/date-range";
import { useLanguage } from "@/lib/i18n/language-context";
import type { TranslationDict } from "@/lib/i18n/translations";

function presetsFor(
  today: Date,
  t: TranslationDict,
): { id: string; label: string; range: DateRange }[] {
  const end = startOfDay(today);
  const startOfMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  const startOfLastMonth = new Date(end.getFullYear(), end.getMonth() - 1, 1);
  const endOfLastMonth = addDays(startOfMonth, -1);
  return [
    { id: "today", label: t.dateRange.today, range: { from: end, to: end } },
    { id: "last7", label: t.dateRange.last7Days, range: { from: addDays(end, -6), to: end } },
    { id: "last30", label: t.dateRange.last30Days, range: { from: addDays(end, -29), to: end } },
    { id: "thisMonth", label: t.dateRange.thisMonth, range: { from: startOfMonth, to: end } },
    {
      id: "lastMonth",
      label: t.dateRange.lastMonth,
      range: { from: startOfLastMonth, to: endOfLastMonth },
    },
  ];
}

export function DateRangePicker({
  range,
  onRangeChange,
}: {
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DayPickerRange | undefined>(range);

  const apply = (next: DateRange) => {
    onRangeChange(next);
    setDraft(next);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(range);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2 rounded-full">
          <CalendarIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{formatDateRange(range)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)] p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex gap-1 overflow-x-auto border-b border-border p-3 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
            {presetsFor(new Date(), t).map((p) => (
              <Button
                key={p.id}
                variant="ghost"
                size="sm"
                className="shrink-0 justify-start rounded-md"
                onClick={() => apply(p.range)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div>
            <Calendar
              mode="range"
              numberOfMonths={1}
              defaultMonth={range.to}
              selected={draft}
              onSelect={setDraft}
              // Without this, clicking a day while a complete range is
              // already selected just nudges the nearest existing
              // boundary (usually "to") instead of starting fresh —
              // so a new custom-range pick can silently keep the old
              // "from" date. See feedback_thrasherspub_ui_preferences
              // / project_thrasherspub_saas memory, 2026-07-25.
              resetOnSelect
              disabled={{ after: startOfDay(new Date()) }}
            />
            <div className="flex items-center justify-end gap-2 border-t border-border p-3">
              <Button
                size="sm"
                disabled={!draft?.from || !draft?.to}
                onClick={() =>
                  draft?.from && draft?.to && apply({ from: draft.from, to: draft.to })
                }
              >
                {t.dateRange.apply}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
