import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  useTeamMembers,
  useInviteMember,
  useUpdateMember,
  useRemoveMember,
  type Role,
  type TeamMember,
} from "@/lib/admin/queries";
import { useAuth } from "@/lib/supabase/auth-context";
import { useRestaurantIds } from "@/lib/supabase/scope";
import { useCurrentRestaurant } from "@/lib/restaurant-context";
import { PERMISSION_KEYS, PERMISSION_LABEL, type PermissionKey } from "@/lib/permissions";
import { Topbar } from "@/components/dashboard/Topbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Pencil, Shield, UserPlus, X } from "lucide-react";

type Permissions = Partial<Record<PermissionKey, boolean>>;

// Only a starting point for a brand-new invite's checkboxes — an
// owner can freely uncheck/check any of these before sending.
// Managers start with everything on (typical day-to-day operators);
// staff start with nothing on, since "some access" should be a
// deliberate choice per person, not an assumed default.
function defaultPermissions(role: Role): Permissions {
  if (role === "staff") return {};
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true]));
}

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin · Shrinkline" }] }),
  component: AdminPage,
});

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", manager: "Manager", staff: "Staff" };

function AdminPage() {
  const { memberships } = useAuth();
  const restaurantId = useRestaurantIds()[0];
  const { currentRestaurant } = useCurrentRestaurant();
  const restaurantName = currentRestaurant?.name ?? "your restaurant";
  const myRole = memberships.find((m) => m.restaurant_id === restaurantId)?.role;
  const canManage = myRole === "owner";

  const { data: members, isLoading, error } = useTeamMembers();
  const inviteMember = useInviteMember();
  const updateMember = useUpdateMember();
  const removeMember = useRemoveMember();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("staff");
  const [invitePermissions, setInvitePermissions] = useState<Permissions>(
    defaultPermissions("staff"),
  );
  const [memberToRemove, setMemberToRemove] = useState<TeamMember | null>(null);
  const [emailFallback, setEmailFallback] = useState<{ error: string; link: string } | null>(null);
  const [addedExisting, setAddedExisting] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editRole, setEditRole] = useState<Role>("staff");
  const [editPermissions, setEditPermissions] = useState<Permissions>({});

  const ownerCount = (members ?? []).filter((m) => m.role === "owner").length;
  const isLastOwner = (m: TeamMember) => m.role === "owner" && ownerCount <= 1;

  function openEdit(m: TeamMember) {
    setEditingMember(m);
    setEditRole(m.role);
    setEditPermissions(m.permissions);
  }

  return (
    <div className="min-h-screen bg-background">
      <Topbar eyebrow="Workspace" title="Admin" />
      <main className="px-8 py-8 max-w-4xl mx-auto space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-2">
              Team & access
            </p>
            <h1 className="font-serif text-4xl text-foreground">Manage users</h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-xl">
              {canManage
                ? `Invite people to ${restaurantName} and control what they can do.`
                : "Only an owner can invite people or change access. You can see who's on the team below."}
            </p>
          </div>
          {canManage && (
            <Button className="gap-2" onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" /> Invite person
            </Button>
          )}
        </header>

        {error && (
          <div className="text-sm text-[#a8453a]">
            Couldn't load the team: {(error as Error).message}
          </div>
        )}

        <Card className="p-0 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                {canManage && (
                  <TableHead className="text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 4 : 3}
                    className="text-center text-muted-foreground py-8"
                  >
                    Loading team…
                  </TableCell>
                </TableRow>
              ) : !members?.length ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 4 : 3}
                    className="text-center text-muted-foreground py-8"
                  >
                    No one on the team yet.
                  </TableCell>
                </TableRow>
              ) : (
                members.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell className="font-medium">
                      {m.email}
                      {m.isSelf && (
                        <Badge variant="outline" className="ml-2 font-normal text-xs">
                          You
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {ROLE_LABEL[m.role]}
                      </Badge>
                      {m.role !== "owner" && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {PERMISSION_KEYS.filter((k) => m.permissions[k]).length}/
                          {PERMISSION_KEYS.length} pages
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {timeAgo(m.joinedAt)}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(m)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          disabled={isLastOwner(m)}
                          onClick={() => setMemberToRemove(m)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>

        {(updateMember.isError || removeMember.isError) && (
          <p className="text-sm text-[#a8453a]">
            {((updateMember.error ?? removeMember.error) as Error).message}
          </p>
        )}
      </main>

      {/* Invite dialog */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(o) => {
          setInviteOpen(o);
          if (!o) {
            setInviteEmail("");
            setInviteRole("staff");
            setInvitePermissions(defaultPermissions("staff"));
            setEmailFallback(null);
            setAddedExisting(false);
            setLinkCopied(false);
            inviteMember.reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" /> Invite to {restaurantName}
            </DialogTitle>
            <DialogDescription>
              We'll email them a link to set a password and sign in.
            </DialogDescription>
          </DialogHeader>

          {addedExisting ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                They already had an account here — access is granted. They can log in with their
                existing email and password, no new invite needed.
              </p>
              <Button className="w-full" onClick={() => setInviteOpen(false)}>
                Done
              </Button>
            </div>
          ) : emailFallback ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                They now have access, but the invite email couldn't be sent ({emailFallback.error}).
                Share this link with them directly:
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={emailFallback.link} className="text-xs" />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(emailFallback.link).then(() => {
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 1500);
                    });
                  }}
                >
                  {linkCopied ? "Copied" : "Copy"}
                </Button>
              </div>
              <Button className="w-full" onClick={() => setInviteOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="name@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => {
                      const role = v as Role;
                      setInviteRole(role);
                      setInvitePermissions(defaultPermissions(role));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">
                        Owner — full access, can manage the team
                      </SelectItem>
                      <SelectItem value="manager">Manager — day-to-day operations</SelectItem>
                      <SelectItem value="staff">Staff — limited access</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {inviteRole === "owner" ? (
                  <p className="text-xs text-muted-foreground">
                    Owners always have access to every page.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <Label>Pages they can access</Label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-3">
                      {PERMISSION_KEYS.map((key) => (
                        <label key={key} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={invitePermissions[key] === true}
                            onCheckedChange={(checked) =>
                              setInvitePermissions((prev) => ({ ...prev, [key]: checked === true }))
                            }
                          />
                          {PERMISSION_LABEL[key]}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {inviteMember.isError && (
                  <p className="text-sm text-[#a8453a]">{(inviteMember.error as Error).message}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  className="w-full"
                  disabled={!inviteEmail.includes("@") || inviteMember.isPending}
                  onClick={() =>
                    inviteMember.mutate(
                      { email: inviteEmail, role: inviteRole, permissions: invitePermissions },
                      {
                        onSuccess: (result) => {
                          if (result.emailSent) {
                            setInviteOpen(false);
                          } else if (result.alreadyRegistered) {
                            setAddedExisting(true);
                          } else {
                            setEmailFallback({
                              error: result.emailError ?? "unknown error",
                              link: result.inviteLink ?? "",
                            });
                          }
                        },
                      },
                    )
                  }
                >
                  {inviteMember.isPending ? "Sending invite…" : "Send invite"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit access dialog */}
      <Dialog
        open={!!editingMember}
        onOpenChange={(o) => {
          if (!o) {
            setEditingMember(null);
            updateMember.reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl flex items-center gap-2">
              <Pencil className="h-5 w-5 text-muted-foreground" /> Edit access
            </DialogTitle>
            <DialogDescription>{editingMember?.email}</DialogDescription>
          </DialogHeader>
          {editingMember && (
            <>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={editRole}
                    onValueChange={(v) => setEditRole(v as Role)}
                    disabled={isLastOwner(editingMember)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">
                        Owner — full access, can manage the team
                      </SelectItem>
                      <SelectItem value="manager">Manager — day-to-day operations</SelectItem>
                      <SelectItem value="staff">Staff — limited access</SelectItem>
                    </SelectContent>
                  </Select>
                  {isLastOwner(editingMember) && (
                    <p className="text-xs text-muted-foreground">
                      This is the only owner, so their role can't be changed. Make someone else an
                      owner first.
                    </p>
                  )}
                </div>
                {editRole === "owner" ? (
                  <p className="text-xs text-muted-foreground">
                    Owners always have access to every page.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <Label>Pages they can access</Label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-3">
                      {PERMISSION_KEYS.map((key) => (
                        <label key={key} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={editPermissions[key] === true}
                            onCheckedChange={(checked) =>
                              setEditPermissions((prev) => ({ ...prev, [key]: checked === true }))
                            }
                          />
                          {PERMISSION_LABEL[key]}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {updateMember.isError && (
                  <p className="text-sm text-[#a8453a]">{(updateMember.error as Error).message}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  className="w-full"
                  disabled={updateMember.isPending}
                  onClick={() =>
                    updateMember.mutate(
                      {
                        userId: editingMember.userId,
                        role: editRole,
                        permissions: editPermissions,
                      },
                      { onSuccess: () => setEditingMember(null) },
                    )
                  }
                >
                  {updateMember.isPending ? "Saving…" : "Save changes"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Remove confirm */}
      <AlertDialog open={!!memberToRemove} onOpenChange={(o) => !o && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {memberToRemove?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll immediately lose access to {restaurantName}. Their account itself isn't
              deleted — they can be re-invited later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (memberToRemove) removeMember.mutate(memberToRemove.userId);
                setMemberToRemove(null);
              }}
              className="bg-terracotta hover:bg-terracotta/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
