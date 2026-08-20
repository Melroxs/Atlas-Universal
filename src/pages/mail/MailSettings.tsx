// ---------------------------------------------------------------------------
// Atlas Mail — Settings page for email accounts, signatures, and labels
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  listEmailAccounts,
  deleteEmailAccount,
  setSyncState,
  testExistingAccount,
  listSignatures,
  saveSignature,
  deleteSignature,
  listLabels,
  saveLabel,
  deleteLabel,
} from "@/lib/mail/api";
import type {
  EmailAccount,
  EmailSignature,
  EmailLabel,
} from "@/lib/mail/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Mail,
  Shield,
  CheckCircle2,
  XCircle,
  Trash2,
  Plus,
  Loader2,
  Settings,
  Palette,
} from "lucide-react";

const LABEL_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#6b7280",
];

export default function MailSettings() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [signatures, setSignatures] = useState<EmailSignature[]>([]);
  const [labels, setLabels] = useState<EmailLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingAccount, setTestingAccount] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Signature form
  const [sigDialogOpen, setSigDialogOpen] = useState(false);
  const [editingSig, setEditingSig] = useState<EmailSignature | null>(null);
  const [sigName, setSigName] = useState("");
  const [sigHtml, setSigHtml] = useState("");
  const [sigText, setSigText] = useState("");
  const [sigDefault, setSigDefault] = useState(false);

  // Label form
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<EmailLabel | null>(null);
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState(LABEL_COLORS[5]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s, l] = await Promise.all([
        listEmailAccounts(),
        listSignatures(),
        listLabels(),
      ]);
      setAccounts(a);
      setSignatures(s);
      setLabels(l);
    } catch (e) {
      console.error("Failed to load mail settings:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Connection test ──────────────────────────────────────────────────

  const handleTestAccount = async (account: EmailAccount) => {
    setTestingAccount(account.id);
    setTestResult(null);
    try {
      // Test existing account — credentials read from DB server-side
      const result = await testExistingAccount({
        accountId: account.id,
      });
      if (result.ok) {
        setTestResult({ ok: true, message: "All connections verified ✓" });
      } else {
        const parts: string[] = [];
        if (!result.imap.ok) parts.push(`IMAP: ${result.imap.error}`);
        if (!result.smtp.ok) parts.push(`SMTP: ${result.smtp.error}`);
        setTestResult({ ok: false, message: parts.join(" | ") || "Test failed" });
      }
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : "Test failed",
      });
    } finally {
      setTestingAccount(null);
    }
  };

  // ── Sync toggle ──────────────────────────────────────────────────────

  const handleToggleSync = async (account: EmailAccount) => {
    await setSyncState(account.id, !account.sync_enabled);
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === account.id
          ? { ...a, sync_enabled: !a.sync_enabled }
          : a,
      ),
    );
  };

  // ── Delete account ───────────────────────────────────────────────────

  const handleDeleteAccount = async (id: string) => {
    if (!confirm("Delete this email account? This cannot be undone.")) return;
    await deleteEmailAccount(id);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  };

  // ── Signature CRUD ───────────────────────────────────────────────────

  const openSigDialog = (sig?: EmailSignature) => {
    setEditingSig(sig ?? null);
    setSigName(sig?.name ?? "");
    setSigHtml(sig?.signature_html ?? "");
    setSigText(sig?.signature_text ?? "");
    setSigDefault(sig?.is_default ?? false);
    setSigDialogOpen(true);
  };

  const handleSaveSig = async () => {
    if (!sigName.trim()) return;
    await saveSignature({
      id: editingSig?.id,
      name: sigName,
      signature_html: sigHtml || null,
      signature_text: sigText || null,
      is_default: sigDefault,
    });
    setSigDialogOpen(false);
    loadData();
  };

  const handleDeleteSig = async (id: string) => {
    await deleteSignature(id);
    loadData();
  };

  // ── Label CRUD ───────────────────────────────────────────────────────

  const openLabelDialog = (label?: EmailLabel) => {
    setEditingLabel(label ?? null);
    setLabelName(label?.name ?? "");
    setLabelColor(label?.color ?? LABEL_COLORS[5]);
    setLabelDialogOpen(true);
  };

  const handleSaveLabel = async () => {
    if (!labelName.trim()) return;
    await saveLabel({
      id: editingLabel?.id,
      name: labelName,
      color: labelColor,
    });
    setLabelDialogOpen(false);
    loadData();
  };

  const handleDeleteLabel = async (id: string) => {
    await deleteLabel(id);
    loadData();
  };

  // ── Loading ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">Atlas Mail Settings</h1>
      </div>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Email Accounts</TabsTrigger>
          <TabsTrigger value="signatures">Signatures</TabsTrigger>
          <TabsTrigger value="labels">Labels</TabsTrigger>
        </TabsList>

        {/* ── Accounts Tab ──────────────────────────────────── */}
        <TabsContent value="accounts" className="space-y-4">
          {accounts.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <Mail className="mx-auto mb-3 h-8 w-8" />
                <p className="text-sm">
                  No email accounts configured. Go to Atlas Mail to set up your
                  first mailbox.
                </p>
              </CardContent>
            </Card>
          ) : (
            accounts.map((account) => (
              <Card key={account.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/10">
                        <Mail className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          {account.email_address}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {account.imap_host}:{account.imap_port} ·{" "}
                          {account.smtp_host}:{account.smtp_port}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {account.sync_enabled && (
                        <Badge variant="secondary" className="text-[10px]">
                          Sync enabled
                        </Badge>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestAccount(account)}
                        disabled={testingAccount === account.id}
                      >
                        {testingAccount === account.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Shield className="h-3.5 w-3.5" />
                        )}
                        Test
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleSync(account)}
                      >
                        {account.sync_enabled ? "Disable Sync" : "Enable Sync"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => handleDeleteAccount(account.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {testResult && testingAccount === null && (
                  <CardContent className="pt-0">
                    <div
                      className={cn(
                        "flex items-center gap-2 rounded-lg p-3 text-sm",
                        testResult.ok
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {testResult.ok ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      {testResult.message}
                    </div>
                  </CardContent>
                )}
                <CardContent className="pt-0">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full",
                          account.imap_host ? "bg-emerald-500" : "bg-red-500",
                        )}
                      />
                      IMAP
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full",
                          account.smtp_host ? "bg-emerald-500" : "bg-red-500",
                        )}
                      />
                      SMTP
                    </div>
                    {account.last_synced_at && (
                      <span>
                        Last synced{" "}
                        {new Date(account.last_synced_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ── Signatures Tab ────────────────────────────────── */}
        <TabsContent value="signatures" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Manage email signatures. The default signature is automatically
              added to new messages.
            </p>
            <Button size="sm" onClick={() => openSigDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              New Signature
            </Button>
          </div>

          {signatures.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <p className="text-sm">No signatures created yet.</p>
              </CardContent>
            </Card>
          ) : (
            signatures.map((sig) => (
              <Card key={sig.id}>
                <CardContent className="flex items-start justify-between py-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{sig.name}</span>
                      {sig.is_default && (
                        <Badge variant="secondary" className="text-[10px]">
                          Default
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground max-h-20 overflow-hidden">
                      <div
                        dangerouslySetInnerHTML={{
                          __html: sig.signature_html ?? sig.signature_text ?? "",
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openSigDialog(sig)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => handleDeleteSig(sig.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* ── Labels Tab ────────────────────────────────────── */}
        <TabsContent value="labels" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Create labels to organize your emails.
            </p>
            <Button size="sm" onClick={() => openLabelDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              New Label
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {labels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No labels created yet.
              </p>
            ) : (
              labels.map((label) => (
                <div
                  key={label.id}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5"
                >
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="text-sm">{label.name}</span>
                  <button
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    onClick={() => openLabelDialog(label)}
                  >
                    <Settings className="h-3 w-3" />
                  </button>
                  <button
                    className="text-destructive/60 hover:text-destructive"
                    onClick={() => handleDeleteLabel(label.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Signature Dialog ────────────────────────────────── */}
      <Dialog open={sigDialogOpen} onOpenChange={setSigDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingSig ? "Edit Signature" : "New Signature"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={sigName}
                onChange={(e) => setSigName(e.target.value)}
                placeholder="e.g. Professional, Personal"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">HTML Signature</label>
              <textarea
                className="min-h-[100px] w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={sigHtml}
                onChange={(e) => setSigHtml(e.target.value)}
                placeholder="<p>Best regards,<br>Your Name</p>"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Plain Text Signature</label>
              <textarea
                className="min-h-[60px] w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={sigText}
                onChange={(e) => setSigText(e.target.value)}
                placeholder="Best regards,\nYour Name"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sigDefault"
                checked={sigDefault}
                onChange={(e) => setSigDefault(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="sigDefault" className="text-sm">
                Set as default signature
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSigDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveSig}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Label Dialog ────────────────────────────────────── */}
      <Dialog open={labelDialogOpen} onOpenChange={setLabelDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editingLabel ? "Edit Label" : "New Label"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={labelName}
                onChange={(e) => setLabelName(e.target.value)}
                placeholder="e.g. Pilot Outreach"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Color</label>
              <div className="flex gap-2">
                {LABEL_COLORS.map((c) => (
                  <button
                    key={c}
                    className={cn(
                      "h-6 w-6 rounded-full transition-transform",
                      labelColor === c && "ring-2 ring-offset-2 ring-foreground scale-110",
                    )}
                    style={{ backgroundColor: c }}
                    onClick={() => setLabelColor(c)}
                  />
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setLabelDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveLabel}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
