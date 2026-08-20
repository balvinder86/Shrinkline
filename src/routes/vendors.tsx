import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Mail, Pencil, Phone, Trash2, UserPlus } from "lucide-react";

import {
  useVendors,
  useCreateVendor,
  useUpdateVendor,
  useDeleteVendor,
  useInventoryItems,
  type Vendor,
} from "@/lib/boh/queries";
import { isFreeEmailProviderDomain } from "@/lib/boh/emailDomains";
import { VENDOR_CATEGORIES } from "@/lib/boh/vendor-categories";

import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/vendors")({
  head: () => ({
    meta: [
      { title: "Vendors · Shrinkline" },
      {
        name: "description",
        content:
          "Manage vendor contacts, invoicing senders, payment terms, and delivery days — shared with Inventory, Invoices, and the Ordering agent.",
      },
    ],
  }),
  component: VendorsPage,
});

const VENDORS_PAGE_SIZE = 50;

function VendorsPage() {
  const { data: vendors = [] } = useVendors();
  // Only needed for "items assigned" counts and the delete-vendor
  // guard (can't delete a vendor items still point to) — same
  // cross-reference Inventory's own Vendors tab used before this page
  // was split out.
  const { data: items = [] } = useInventoryItems();
  const createVendor = useCreateVendor();
  const updateVendor = useUpdateVendor();
  const deleteVendorMutation = useDeleteVendor();

  const [vendorsPage, setVendorsPage] = useState(1);
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [vendorEditing, setVendorEditing] = useState<Vendor | null>(null);
  const [vendorDraft, setVendorDraft] = useState<Omit<Vendor, "id">>({
    name: "",
    contactName: "",
    email: "",
    phone: "",
    accountNo: "",
    deliveryDays: "",
    terms: "Net 30",
    notes: "",
    invoicingSenderEmails: [],
    category: "food_beverage",
  });
  // Kept as free-typed text, not the draft's string[] directly — parsing
  // every keystroke into an array and joining it back for display would
  // fight the cursor position while typing "a, b, ". Parsed into
  // vendorDraft.invoicingSenderEmails only in saveVendor.
  const [vendorSenderEmailsText, setVendorSenderEmailsText] = useState("");
  const [vendorSenderEmailsError, setVendorSenderEmailsError] = useState<string | null>(null);
  const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null);

  const vendorsTotalPages = Math.max(1, Math.ceil(vendors.length / VENDORS_PAGE_SIZE));
  const pagedVendors = useMemo(
    () => vendors.slice((vendorsPage - 1) * VENDORS_PAGE_SIZE, vendorsPage * VENDORS_PAGE_SIZE),
    [vendors, vendorsPage],
  );

  const openAddVendor = () => {
    setVendorEditing(null);
    setVendorDraft({
      name: "",
      contactName: "",
      email: "",
      phone: "",
      accountNo: "",
      deliveryDays: "",
      terms: "Net 30",
      notes: "",
      invoicingSenderEmails: [],
      category: "food_beverage",
    });
    setVendorSenderEmailsText("");
    setVendorSenderEmailsError(null);
    setVendorDialogOpen(true);
  };
  const openEditVendor = (v: Vendor) => {
    setVendorEditing(v);
    const { id: _id, ...rest } = v;
    setVendorDraft(rest);
    setVendorSenderEmailsText(v.invoicingSenderEmails.join(", "));
    setVendorSenderEmailsError(null);
    setVendorDialogOpen(true);
  };
  const saveVendor = () => {
    if (!vendorDraft.name.trim()) return;
    const name = vendorDraft.name.trim();
    const invoicingSenderEmails = vendorSenderEmailsText
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    // A free-email-provider domain entry (@gmail.com etc) would trust
    // literally anyone with an account there — only an exact address
    // on those providers is allowed, never the whole domain.
    const badDomainEntry = invoicingSenderEmails.find(
      (e) => e.startsWith("@") && isFreeEmailProviderDomain(e.slice(1)),
    );
    if (badDomainEntry) {
      setVendorSenderEmailsError(
        `"${badDomainEntry}" is a free email provider — add the specific address(es) this vendor invoices from instead of the whole domain.`,
      );
      return;
    }
    setVendorSenderEmailsError(null);
    if (vendorEditing) {
      updateVendor.mutate({ id: vendorEditing.id, ...vendorDraft, name, invoicingSenderEmails });
    } else {
      createVendor.mutate({ ...vendorDraft, name, invoicingSenderEmails });
    }
    setVendorDialogOpen(false);
  };
  const confirmDeleteVendor = () => {
    if (!vendorToDelete) return;
    deleteVendorMutation.mutate(vendorToDelete.id);
    setVendorToDelete(null);
  };
  const vendorItemCount = (name: string) => items.filter((i) => i.vendor === name).length;

  return (
    <div className="min-h-screen bg-cream">
      <Topbar eyebrow="Stock & purchasing" title="Vendors" />

      <main className="px-8 py-8 max-w-[1500px] mx-auto space-y-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-serif text-2xl text-ink">Vendor management</p>
            <p className="text-sm text-stone-600">
              {vendors.length} vendors · {items.length} items assigned · used by Inventory, Invoices
              and the Ordering agent.
            </p>
          </div>
          <Button onClick={openAddVendor}>
            <UserPlus className="h-4 w-4" /> Add vendor
          </Button>
        </div>

        <Card className="border-stone-200 overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/60">
                  <TableHead className="w-[18%]">Vendor</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Invoicing senders</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Terms</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedVendors.map((v) => {
                  const count = vendorItemCount(v.name);
                  return (
                    <TableRow key={v.id} className="hover:bg-stone-50/50">
                      <TableCell>
                        <p className="font-medium text-ink">{v.name}</p>
                        {v.notes && <p className="text-xs text-stone-500 mt-0.5">{v.notes}</p>}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{v.contactName}</p>
                        <p className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                          <Mail className="h-3 w-3" /> {v.email}
                        </p>
                        <p className="text-xs text-stone-500 flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {v.phone}
                        </p>
                      </TableCell>
                      <TableCell>
                        {v.invoicingSenderEmails.length === 0 ? (
                          <span className="text-xs text-stone-400">— none set</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {v.invoicingSenderEmails.map((email) => (
                              <Badge
                                key={email}
                                variant="outline"
                                className="font-normal text-[11px] font-mono"
                              >
                                {email}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-mono text-stone-700">
                        {v.accountNo}
                      </TableCell>
                      <TableCell className="text-sm text-stone-700">{v.deliveryDays}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">
                          {v.terms}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm tabular-nums font-medium">{count}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => openEditVendor(v)}
                            aria-label={`Edit ${v.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-stone-500 hover:text-terracotta"
                            onClick={() => setVendorToDelete(v)}
                            aria-label={`Delete ${v.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {vendors.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-10 text-sm text-stone-500">
                      No vendors yet. Add one to start assigning items.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-stone-50/60 px-4 py-3 text-sm">
            <span className="text-stone-500">
              {vendors.length === 0
                ? "0 vendors"
                : `Showing ${(vendorsPage - 1) * VENDORS_PAGE_SIZE + 1}–${Math.min(vendorsPage * VENDORS_PAGE_SIZE, vendors.length)} of ${vendors.length} vendor${vendors.length === 1 ? "" : "s"}`}
            </span>
            {vendorsTotalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={vendorsPage <= 1}
                  onClick={() => setVendorsPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs text-stone-500">
                  Page {vendorsPage} of {vendorsTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={vendorsPage >= vendorsTotalPages}
                  onClick={() => setVendorsPage((p) => Math.min(vendorsTotalPages, p + 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </Card>
      </main>

      <Dialog open={vendorDialogOpen} onOpenChange={setVendorDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {vendorEditing ? "Edit vendor" : "Add vendor"}
            </DialogTitle>
            <DialogDescription>
              Vendor details are shared with the Invoices tab and the Ordering agent for
              auto-dispatch.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label htmlFor="v-name">Vendor name</Label>
              <Input
                id="v-name"
                value={vendorDraft.name}
                onChange={(e) => setVendorDraft({ ...vendorDraft, name: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="v-category">Expense category</Label>
              <select
                id="v-category"
                value={vendorDraft.category}
                onChange={(e) =>
                  setVendorDraft({ ...vendorDraft, category: e.target.value as Vendor["category"] })
                }
                className="h-10 w-full rounded-md border border-stone-200 bg-white px-2 text-sm"
              >
                {VENDOR_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="v-contact">Contact name</Label>
              <Input
                id="v-contact"
                value={vendorDraft.contactName}
                onChange={(e) => setVendorDraft({ ...vendorDraft, contactName: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="v-account">Account #</Label>
              <Input
                id="v-account"
                value={vendorDraft.accountNo}
                onChange={(e) => setVendorDraft({ ...vendorDraft, accountNo: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="v-email">Order email</Label>
              <Input
                id="v-email"
                type="email"
                value={vendorDraft.email}
                onChange={(e) => setVendorDraft({ ...vendorDraft, email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="v-phone">Phone</Label>
              <Input
                id="v-phone"
                value={vendorDraft.phone}
                onChange={(e) => setVendorDraft({ ...vendorDraft, phone: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="v-days">Delivery days</Label>
              <Input
                id="v-days"
                placeholder="e.g. Mon, Wed, Fri"
                value={vendorDraft.deliveryDays}
                onChange={(e) => setVendorDraft({ ...vendorDraft, deliveryDays: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="v-terms">Payment terms</Label>
              <select
                id="v-terms"
                value={vendorDraft.terms}
                onChange={(e) => setVendorDraft({ ...vendorDraft, terms: e.target.value })}
                className="h-10 w-full rounded-md border border-stone-200 bg-white px-2 text-sm"
              >
                {["COD", "Net 7", "Net 15", "Net 21", "Net 30", "Net 45", "Net 60"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="v-senders">Invoicing senders</Label>
              <Input
                id="v-senders"
                value={vendorSenderEmailsText}
                onChange={(e) => {
                  setVendorSenderEmailsText(e.target.value);
                  if (vendorSenderEmailsError) setVendorSenderEmailsError(null);
                }}
                placeholder="e.g. invoices@vendor.com, @vendor.com"
                className={vendorSenderEmailsError ? "border-terracotta" : ""}
              />
              {vendorSenderEmailsError ? (
                <p className="mt-1 text-xs text-terracotta">{vendorSenderEmailsError}</p>
              ) : (
                <p className="mt-1 text-xs text-stone-500">
                  Comma-separated — full addresses (invoices@vendor.com) and/or whole domains
                  (@vendor.com) this vendor invoices from. An invoice email matching one of these is
                  auto-assigned to this vendor instead of needing a manual pick. Free providers
                  (Gmail, Outlook, etc) can only be added as specific addresses, never a whole
                  domain.
                </p>
              )}
            </div>
            <div className="col-span-2">
              <Label htmlFor="v-notes">Notes</Label>
              <Textarea
                id="v-notes"
                rows={2}
                value={vendorDraft.notes ?? ""}
                onChange={(e) => setVendorDraft({ ...vendorDraft, notes: e.target.value })}
                placeholder="Optional — minimum orders, rep schedule, special instructions…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVendorDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveVendor} disabled={!vendorDraft.name.trim()}>
              {vendorEditing ? "Save changes" : "Add vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!vendorToDelete} onOpenChange={(o) => !o && setVendorToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {vendorToDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {vendorToDelete && vendorItemCount(vendorToDelete.name) > 0 ? (
                <>
                  <span className="text-terracotta font-medium">
                    {vendorItemCount(vendorToDelete.name)} item(s) are still assigned to this
                    vendor.
                  </span>{" "}
                  Reassign or delete those items first — otherwise the Ordering agent won't know
                  where to send their POs.
                </>
              ) : (
                "This vendor has no items assigned and can be safely removed."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteVendor}
              disabled={!!vendorToDelete && vendorItemCount(vendorToDelete.name) > 0}
              className="bg-terracotta hover:bg-terracotta/90"
            >
              Delete vendor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
