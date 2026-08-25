import { api } from "@/lib/api";
import { EmptyPanel, PageHeader, formatDate } from "@/components/atlas-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import {
  Crown,
  Loader2,
  Mail,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { sendTeamInviteEmail } from "@/lib/actions/team-invite";
import { useState } from "react";
import { toast } from "sonner";

const ROLES = ["owner", "admin", "manager", "analyst", "viewer"] as const;
const ROLE_DESC: Record<string, string> = {
  owner: "Full control — can do everything including removing the workspace",
  admin: "Full control — cannot remove the workspace itself",
  manager: "Approves recommendations, invites members, manages connections",
  analyst: "Uploads documents and asks questions",
  viewer: "Read-only access to knowledge and answers",
};

function initials(name?: string | null, email?: string | null): string {
  const src = name ?? email ?? "?";
  return (
    src
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

export default function Team() {
  const workspace = useQuery(api.tenants.getMyWorkspace);
  const updateMemberRole = useMutation(api.tenants.updateMemberRole);
  const removeMember = useMutation(api.tenants.removeMember);
  const inviteMember = useMutation(api.tenants.inviteMember);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "analyst" });
  const [busy, setBusy] = useState<string | null>(null);

  const meId = workspace?.membership?.userId;
  const isManager = ["owner", "admin", "manager"].includes(
    workspace?.membership?.role ?? "",
  );
  const members = workspace?.members ?? [];
  const invites = workspace?.invites ?? [];

  const changeRole = async (userId: string, role: string) => {
    setBusy(`role-${userId}`);
    try {
      await updateMemberRole({ userId: userId as never, role: role as never });
      toast.success("Role updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update role");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (userId: string, name?: string | null) => {
    setBusy(`del-${userId}`);
    try {
      await removeMember({ userId: userId as never });
      toast.success(`${name ?? "Member"} removed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove member");
    } finally {
      setBusy(null);
    }
  };

  const invite = async () => {
    if (!inviteForm.email.trim()) {
      toast.error("Enter an email address");
      return;
    }
    setBusy("invite");
    try {
      const res = await inviteMember({
        email: inviteForm.email.trim(),
        role: inviteForm.role as never,
      });

      if (res.membershipCreated) {
        toast.success("Member added", { description: inviteForm.email.trim() });
        setInviteOpen(false);
        setInviteForm({ email: "", role: "analyst" });
        return;
      }

      // Invitation row created — now attempt to deliver the actual email.
      const tenantId = workspace?.tenant?._id as string | undefined;
      if (!tenantId) {
        toast.success("Invitation saved", {
          description:
            "The invitation is pending. No workspace ID was available to send the email, but the user can join by signing up with this email.",
        });
        setInviteOpen(false);
        setInviteForm({ email: "", role: "analyst" });
        return;
      }

      const emailResult = await sendTeamInviteEmail({
        email: inviteForm.email.trim(),
        tenantId,
        tenantName: workspace?.tenant?.name as string | undefined,
        inviterName: workspace?.profile?.name as string | undefined,
      });

      if (emailResult.ok) {
        toast.success("Invitation sent", {
          description: `${inviteForm.email.trim()} will receive an email with instructions to join this workspace.`,
        });
      } else {
        toast.warning("Invite saved, but email was not delivered", {
          description:
            `${inviteForm.email.trim()} was added to the pending invitations list. ` +
            `The email could not be sent (${emailResult.error ?? "unknown error"}). ` +
            `The user can still join automatically by signing up with this email address.`,
        });
      }

      setInviteOpen(false);
      setInviteForm({ email: "", role: "analyst" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to invite");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Team"
        title="Who works in Atlas"
        description="Roles decide what each member can do — only managers and above can approve recommendations, invite members or manage connections."
        actions={
          <Button onClick={() => setInviteOpen(true)} disabled={!isManager} className="gap-2">
            <UserPlus className="size-4" />
            Invite member
          </Button>
        }
      />

      {members.length === 0 ? (
        <EmptyPanel
          icon={Users}
          title="No members yet"
          description="Invite your team to share the workspace. You're the owner, so you have full control."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
          <div className="divide-y divide-border/50">
            {members.map((m) => {
              const isOwner = m.role === "owner";
              const isSelf = m.userId === meId;
              return (
                <div key={m.userId} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <Avatar className="size-9 rounded-lg">
                    {m.user?.image && <AvatarImage src={m.user.image} alt="" />}
                    <AvatarFallback className="rounded-lg bg-teal-400/15 text-xs text-teal-600 dark:text-teal-300">
                      {initials(m.user?.name, m.user?.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      {m.user?.name ?? "Invited user"}
                      {isSelf && (
                        <Badge
                          variant="outline"
                          className="border-border/70 font-mono text-[10px] text-muted-foreground"
                        >
                          you
                        </Badge>
                      )}
                      {isOwner && <Crown className="size-3.5 text-amber-600 dark:text-amber-300" />}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m.user?.email ?? "—"} · joined {formatDate(m.joinedAt)}
                    </p>
                  </div>
                  <Select
                    value={m.role}
                    disabled={!isManager || isOwner || busy !== null}
                    onValueChange={(v) => void changeRole(String(m.userId), v)}
                  >
                    <SelectTrigger className={cn("h-8 w-32 text-xs", !isManager && "opacity-70")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r} disabled={r === "owner" && !isOwner}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground"
                    disabled={!isManager || isOwner || busy !== null}
                    onClick={() => void remove(String(m.userId), m.user?.name)}
                  >
                    {busy === `del-${m.userId}` ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                    <span className="hidden sm:inline">Remove</span>
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Role legend */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="size-3.5 text-teal-600 dark:text-teal-300" />
          Role permissions
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r) => (
            <div key={r} className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <p className="font-mono text-[11px] font-semibold text-foreground">{r}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{ROLE_DESC[r]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pending invites */}
      {invites.filter((i) => i.status === "pending").length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
          <p className="border-b border-border/60 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pending invitations
          </p>
          <div className="divide-y divide-border/50">
            {invites
              .filter((i) => i.status === "pending")
              .map((i) => (
                <div key={i._id} className="flex items-center gap-3 px-5 py-3">
                  <Mail className="size-4 text-muted-foreground" />
                  <p className="flex-1 text-sm">{i.email}</p>
                  <Badge
                    variant="outline"
                    className="border-amber-400/30 bg-amber-400/10 font-mono text-[10px] text-amber-600 dark:text-amber-300"
                  >
                    {i.role}
                  </Badge>
                  <span className="font-mono text-[11px] text-muted-foreground/60">pending</span>
                </div>
              ))}
          </div>
        </div>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4 text-teal-600 dark:text-teal-300" />
              Invite a member
            </DialogTitle>
            <DialogDescription>
              People with an existing Atlas account join instantly. Others get an invitation to
              claim on their next sign-in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Email</Label>
              <Input
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="teammate@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Role</Label>
              <Select
                value={inviteForm.role}
                onValueChange={(v) => setInviteForm((f) => ({ ...f, role: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => r !== "owner").map((r) => (
                    <SelectItem key={r} value={r}>
                      {r} — {ROLE_DESC[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={invite} disabled={busy === "invite"} className="gap-2">
              {busy === "invite" && <Loader2 className="size-4 animate-spin" />}
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
