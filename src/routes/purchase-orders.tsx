import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";

import { usePurchaseOrders, useSendPurchaseOrderEmail } from "@/lib/boh/queries";

import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/purchase-orders")({
  head: () => ({
    meta: [
      { title: "Purchase Orders · Shrinkline" },
      {
        name: "description",
        content: "Every purchase order sent to a vendor — status, total, and email delivery.",
      },
    ],
  }),
  component: PurchaseOrdersPage,
});

const ORDERS_PAGE_SIZE = 50;

function PurchaseOrdersPage() {
  const { data: purchaseOrders = [] } = usePurchaseOrders();
  const sendEmail = useSendPurchaseOrderEmail();
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(purchaseOrders.length / ORDERS_PAGE_SIZE));
  const paged = useMemo(
    () => purchaseOrders.slice((page - 1) * ORDERS_PAGE_SIZE, page * ORDERS_PAGE_SIZE),
    [purchaseOrders, page],
  );

  return (
    <div className="min-h-screen bg-cream">
      <Topbar eyebrow="Stock & purchasing" title="Purchase Orders" />

      <main className="px-8 py-8 max-w-[1500px] mx-auto space-y-8">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-terracotta font-semibold">
            Stock & purchasing
          </p>
          <p className="font-serif text-3xl text-ink mt-1">Purchase Orders</p>
          <p className="text-sm text-stone-600 mt-1 max-w-2xl">
            {purchaseOrders.length} order{purchaseOrders.length === 1 ? "" : "s"} — built from a
            cart on the Items page, dispatched here.
          </p>
        </div>

        <Card className="border-stone-200 overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/60">
                  <TableHead>Vendor</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.map((po) => (
                  <TableRow key={po.id} className="hover:bg-stone-50/50">
                    <TableCell className="font-medium text-ink">{po.vendorName}</TableCell>
                    <TableCell className="text-sm text-stone-700">
                      {new Date(po.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="text-center text-sm">{po.lineCount}</TableCell>
                    <TableCell className="text-right font-medium">
                      {po.totalCents != null ? `$${(po.totalCents / 100).toFixed(2)}` : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize font-normal">
                        {po.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {po.emailedAt ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Emailed{" "}
                          {new Date(po.emailedAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      ) : !po.vendorEmail ? (
                        <span className="text-xs text-stone-400">No email on file</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          {po.emailError && (
                            <span className="text-xs text-terracotta" title={po.emailError}>
                              Failed
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={sendEmail.isPending && sendEmail.variables === po.id}
                            onClick={() => sendEmail.mutate(po.id)}
                          >
                            {sendEmail.isPending && sendEmail.variables === po.id
                              ? "Sending…"
                              : po.emailError
                                ? "Retry"
                                : "Send"}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {purchaseOrders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-sm text-stone-500">
                      No purchase orders yet — build a cart and create one from the Items page.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-stone-50/60 px-4 py-3 text-sm">
            <span className="text-stone-500">
              {purchaseOrders.length === 0
                ? "0 purchase orders"
                : `Showing ${(page - 1) * ORDERS_PAGE_SIZE + 1}–${Math.min(page * ORDERS_PAGE_SIZE, purchaseOrders.length)} of ${purchaseOrders.length} purchase order${purchaseOrders.length === 1 ? "" : "s"}`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-stone-500">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
