import { api } from "@/convex/_generated/api";
import { ConnStatusBadge, EmptyPanel, PageHeader, formatDate } from "@/components/atlas-ui";
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
import { useMutation, useQuery } from "convex/react";
import {
  Cable,
  Cloud,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  HardDrive,
  Loader2,
  Mail,
  MessageSquare,
  Plug,
  Plus,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const PROVIDERS: Array<{
  value: string;
  label: string;
  category: string;
  icon: typeof Plug;
}> = [
  { value: "google_drive", label: "Google Drive", category: "document_storage", icon: Cloud },
  { value: "microsoft_365", label: "Microsoft 365 / OneDrive", category: "document_storage", icon: Cloud },
  { value: "sharepoint", label: "SharePoint", category: "document_storage", icon: FolderOpen },
  { value: "manual_upload", label: "Manual file uploads", category: "document_storage", icon: HardDrive },
  { value: "csv", label: "CSV files", category: "file", icon: FileSpreadsheet },
  { value: "excel", label: "Excel files", category: "file", icon: FileSpreadsheet },
  { value: "pdf", label: "PDF files", category: "file", icon: FileText },
  { value: "email", label: "Email (IMAP)", category: "email", icon: Mail },
  { value: "quickbooks", label: "QuickBooks", category: "accounting", icon: FileText },
  { value: "jobnimbus", label: "JobNimbus", category: "crm", icon: Plug },
  { value: "dash", label: "DASH", category: "job_management", icon: Plug },
  { value: "slack", label: "Slack", category: "communication", icon: MessageSquare },
];

const CATEGORIES = [
  "document_storage",
  "file",
  "email",
  "accounting",
  "crm",
  "job_management",
  "communication",
  "other",
];

const PROVIDER_ICONS: Record<string, typeof Plug> = Object.fromEntries(
  PROVIDERS.map((p) => [p.value, p.icon]),
);

export default function Connections() {
  const workspace = useQuery(api.tenants.getMyWorkspace);
  const connections = useQuery(api.connections.listConnections);
  const createConnection = useMutation(api.connections.createConnection);
  const syncConnection = useMutation(api.connections.syncConnection);
  const deleteConnection = useMutation(api.connections.deleteConnection);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", provider: "", category: "", notes: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const isManager = ["owner", "admin", "manager"].includes(
    workspace?.membership?.role ?? "",
  );

  const pickProvider = (value: string) => {
    const p = PROVIDERS.find((x) => x.value === value);
    setForm((f) => ({
      ...f,
      provider: value,
      category: p?.category ?? f.category,
      name: p?.label ?? f.name,
    }));
  };

  const addConnection = async () => {
    if (!form.name.trim() || !form.provider.trim()) {
      toast.error("Name and provider are required");
      return;
    }
    setBusy("create");
    try {
      await createConnection({
        name: form.name.trim(),
        provider: form.provider,
        category: form.category || "other",
        notes: form.notes.trim() || undefined,
      });
      toast.success("Connection added");
      setDialogOpen(false);
      setForm({ name: "", provider: "", category: "", notes: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add connection");
    } finally {
      setBusy(null);
    }
  };

  const sync = async (id: string, name: string) => {
    setBusy(`sync-${id}`);
    try {
      await syncConnection({ connectionId: id as never });
      toast.success(`${name} synced`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, name: string) => {
    setBusy(`del-${id}`);
    try {
      await deleteConnection({ connectionId: id as never });
      toast.success(`${name} removed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Connection Engine"
        title="Source systems"
        description="Atlas syncs your fragmented systems — drives, spreadsheets, email, CRMs — and normalizes them into one knowledge base. Connectors marked 'planned' are ready to wire up."
        actions={
          <Button onClick={() => setDialogOpen(true)} disabled={!isManager} className="gap-2">
            <Plus className="size-4" />
            Add connection
          </Button>
        }
      />

      {(connections ?? []).length === 0 ? (
        <EmptyPanel
          icon={Cable}
          title="No connections yet"
          description="Add a source system to plan a connector, or use manual uploads to start feeding Atlas immediately."
          action={
            <Button onClick={() => setDialogOpen(true)} disabled={!isManager}>
              <Plus className="mr-2 size-4" />
              Add your first connection
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(connections ?? []).map((c) => {
            const Icon = PROVIDER_ICONS[c.provider] ?? Plug;
            const syncing = busy === `sync-${c._id}`;
            return (
              <div
                key={c._id}
                className="flex flex-col rounded-xl border border-border/70 bg-card/60 p-5 transition-colors hover:border-teal-400/25"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-teal-400/10 text-teal-300 ring-1 ring-teal-400/20">
                    <Icon className="size-5" />
                  </div>
                  <ConnStatusBadge status={c.status} />
                </div>
                <h3 className="mt-3 text-sm font-semibold">{c.name}</h3>
                <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {c.provider.replace(/_/g, " ")} · {c.category.replace(/_/g, " ")}
                </p>
                {c.notes && (
                  <p className="mt-2 flex-1 text-xs leading-5 text-muted-foreground">{c.notes}</p>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-3 text-[11px] text-muted-foreground/70">
                  <span>Last sync: {formatDate(c.lastSyncAt)}</span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5"
                    disabled={syncing || busy !== null}
                    onClick={() => void sync(String(c._id), c.name)}
                  >
                    {syncing ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCcw className="size-3.5" />
                    )}
                    Sync
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-muted-foreground"
                    disabled={!isManager || busy !== null}
                    onClick={() => void remove(String(c._id), c.name)}
                  >
                    <Trash2 className="size-3.5" />
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plug className="size-4 text-teal-300" />
              Add a connection
            </DialogTitle>
            <DialogDescription>
              Register a source system. Real OAuth connectors arrive in a later phase — this
              registers the system and lets you simulate syncs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Provider</Label>
              <Select value={form.provider} onValueChange={pickProvider}>
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Company Google Drive"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Notes</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional context for this source"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addConnection} disabled={busy === "create"} className="gap-2">
              {busy === "create" && <Loader2 className="size-4 animate-spin" />}
              Add connection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
