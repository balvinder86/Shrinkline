import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CircleDollarSign } from "lucide-react";

import { Topbar } from "@/components/dashboard/Topbar";
import { isoDate } from "@/lib/date-range";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label as FormLabel } from "@/components/ui/label";
import { useCreateManualExpense, useVendors as useRealVendors } from "@/lib/boh/queries";
import { VENDOR_CATEGORIES } from "@/lib/boh/vendor-categories";

export const Route = createFileRoute("/log-expense")({
  head: () => ({
    meta: [
      { title: "Log expense · Shrinkline" },
      {
        name: "description",
        content: "Log a real expense with no invoice to upload — rent, a repair, or any vendor.",
      },
    ],
  }),
  component: LogExpensePage,
});

// Was a dialog opened from /invoices' toolbar, promoted to its own
// page alongside Line items/Savings/Vendor spend. Stays on the page
// after a successful log (reset + confirmation) rather than
// navigating away, since logging several expenses in a row is a real
// workflow.
function LogExpensePage() {
  const { data: vendors = [] } = useRealVendors();
  const createManualExpense = useCreateManualExpense();

  const [vendorId, setVendorId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [dateInput, setDateInput] = useState(() => isoDate(new Date()));
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  const parsedCents = Math.round(parseFloat(amountInput) * 100);
  const isValid =
    !!vendorId &&
    amountInput.trim() !== "" &&
    Number.isFinite(parsedCents) &&
    parsedCents > 0 &&
    !!dateInput;

  function handleSubmit() {
    if (!isValid) return;
    setSaved(false);
    createManualExpense.mutate(
      {
        vendorId,
        totalCents: parsedCents,
        invoiceDate: dateInput,
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          setVendorId("");
          setAmountInput("");
          setDateInput(isoDate(new Date()));
          setNote("");
          setSaved(true);
        },
      },
    );
  }

  return (
    <>
      <Topbar eyebrow="Accounts payable" title="Log expense" />
      <main className="px-6 py-6">
        <Card className="max-w-md p-6">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <CircleDollarSign className="h-5 w-5" /> Log an expense
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            For anything with no invoice to upload — cash paid for rent, a repair, or any other
            vendor. Recorded as approved right away.
          </p>

          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <FormLabel htmlFor="manual-expense-vendor">Vendor</FormLabel>
              <select
                id="manual-expense-vendor"
                value={vendorId}
                onChange={(e) => {
                  setVendorId(e.target.value);
                  setSaved(false);
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select a vendor…</option>
                {VENDOR_CATEGORIES.map((c) => {
                  const vendorsInCategory = vendors.filter((v) => v.category === c.value);
                  if (vendorsInCategory.length === 0) return null;
                  return (
                    <optgroup key={c.value} label={c.label}>
                      {vendorsInCategory.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              {vendors.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No vendors yet — add one in the Vendors page of Stock &amp; Purchasing first.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <FormLabel htmlFor="manual-expense-amount">Amount</FormLabel>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="manual-expense-amount"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={amountInput}
                    onChange={(e) => {
                      setAmountInput(e.target.value);
                      setSaved(false);
                    }}
                    className="pl-6"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <FormLabel htmlFor="manual-expense-date">Date</FormLabel>
                <Input
                  id="manual-expense-date"
                  type="date"
                  value={dateInput}
                  onChange={(e) => {
                    setDateInput(e.target.value);
                    setSaved(false);
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <FormLabel htmlFor="manual-expense-note">Reference / note (optional)</FormLabel>
              <Input
                id="manual-expense-note"
                placeholder="e.g. paid by check #204"
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setSaved(false);
                }}
              />
            </div>

            {createManualExpense.isError && (
              <p className="text-xs text-destructive">Couldn't save that expense — try again.</p>
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <Button onClick={handleSubmit} disabled={!isValid || createManualExpense.isPending}>
              {createManualExpense.isPending ? "Saving…" : "Log expense"}
            </Button>
            {saved && !createManualExpense.isError && (
              <p className="text-xs text-emerald-700">Logged.</p>
            )}
          </div>
        </Card>
      </main>
    </>
  );
}
