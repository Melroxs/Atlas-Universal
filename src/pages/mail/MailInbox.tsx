// ---------------------------------------------------------------------------
// Atlas Mail — Inbox / Message List
// Gmail-style email client layout with folder navigation, message list,
// and inline compose.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import {
  listEmailAccounts,
  listMessages,
  listSentMessages,
  listDrafts,
  listStarredMessages,
  listAllMessages,
  getMessageCounts,
  markRead,
  markStarred,
  moveMessage,
  deleteMessage,
  saveDraft,
  deleteDraft,
  testConnection,
  syncFolder,
  sendMessage,
  listSignatures,
  createEmailAccount,
  setupAccountCredentials,
  MailEdgeError,
} from "@/lib/mail/api";
import type {
  EmailAccount,
  EmailMessage,
  EmailDraft,
  EmailSignature,
  MailCounts,
  MailFolder,
} from "@/lib/mail/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Inbox,
  Send,
  FileText,
  Trash2,
  Archive,
  Star,
  Search,
  RefreshCw,
  Pencil,
  Mail,
  MailOpen,
  Paperclip,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Settings,
  AlertCircle,
  Loader2,
  Plus,
  X,
  Inbox as InboxIcon,
  Shield,
} from "lucide-react";

// ── Folder config ────────────────────────────────────────────────────────

const FOLDERS: Array<{
  id: MailFolder;
  label: string;
  icon: typeof Inbox;
  action?: "inbox" | "starred" | "sent" | "drafts" | "archive" | "trash";
}> = [
  { id: "INBOX", label: "Inbox", icon: Inbox, action: "inbox" },
  { id: "Starred", label: "Starred", icon: Star, action: "starred" },
  { id: "Sent", label: "Sent", icon: Send, action: "sent" },
  { id: "Drafts", label: "Drafts", icon: FileText, action: "drafts" },
  { id: "Archive", label: "Archive", icon: Archive, action: "archive" },
  { id: "Trash", label: "Trash", icon: Trash2, action: "trash" },
];

// ── Helpers ──────────────────────────────────────────────────────────────

function formatEmailDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return d.toLocaleDateString("en-US", { weekday: "short" });
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: diffDays > 365 ? "numeric" : undefined,
  });
}

function getInitials(name?: string | null, email?: string | null): string {
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

/** Sanitize untrusted email HTML to prevent XSS. */
function sanitizeEmailHtml(html: string): string {
  let safe = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\bon\w+\s*=\s*\S+/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/data\s*:(?!image\/(?:png|gif|jpeg|jpg|svg\+xml))/gi, "")
    .replace(/<(iframe|object|embed|applet|form|input|button|select|textarea)\b[^>]*>/gi, "")
    .replace(/<\/iframe|object|embed|applet|form|input|button|select|textarea>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/-moz-binding\s*:[^;]*/gi, "")
    .replace(/behavior\s*:[^;]*/gi, "");
  return safe;
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-violet-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
    "bg-indigo-500",
    "bg-pink-500",
  ];
  return colors[Math.abs(hash) % colors.length];
}

// ── Setup Screen ─────────────────────────────────────────────────────────

function SetupScreen({ onSetup }: { onSetup: () => void }) {
  const [step, setStep] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    emailAddress: "",
    password: "",
    imapHost: "mailserver.businessidentity.llc",
    imapPort: 993,
    smtpHost: "mailserver.businessidentity.llc",
    smtpPort: 465,
  });

  const handleTest = async () => {
    if (!form.emailAddress || !form.password) {
      setError("Email address and password are required");
      return;
    }
    setStep("testing");
    setError("");
    try {
      const result = await testConnection({
        imapHost: form.imapHost,
        imapPort: form.imapPort,
        imapSecure: true,
        imapUser: form.emailAddress,
        imapPassword: form.password,
        smtpHost: form.smtpHost,
        smtpPort: form.smtpPort,
        smtpSecure: true,
        smtpUser: form.emailAddress,
        smtpPassword: form.password,
      });
      if (result.ok) {
        // Create account in database (no credentials stored client-side)
        const newAccount = await createEmailAccount({
          email_address: form.emailAddress,
          display_name: form.emailAddress.split("@")[0],
          imap_host: form.imapHost,
          imap_port: form.imapPort,
          imap_secure: true,
          smtp_host: form.smtpHost,
          smtp_port: form.smtpPort,
          smtp_secure: true,
        });
        // Store encrypted credentials server-side via Edge Function
        await setupAccountCredentials({
          accountId: newAccount.id,
          imapUser: form.emailAddress,
          imapPassword: form.password,
        });
        setStep("success");
        setTimeout(onSetup, 1500);
      } else {
        const parts: string[] = [];
        if (!result.imap.ok) parts.push(`IMAP: ${result.imap.error ?? "failed"}`);
        if (!result.smtp.ok) parts.push(`SMTP: ${result.smtp.error ?? "failed"}`);
        setError(parts.join(" | ") || "Connection test failed");
        setStep("error");
      }
    } catch (e) {
      // Show user-friendly error messages from MailEdgeError
      // Never expose internal details, credentials, or infrastructure
      if (e instanceof MailEdgeError) {
        setError(e.message);
      } else if (e instanceof Error) {
        // Generic fallback — don't expose raw error messages
        setError("Unable to connect. Please verify your credentials and try again.");
      } else {
        setError("An unexpected error occurred. Please try again.");
      }
      setStep("error");
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-500/10">
            <Mail className="h-8 w-8 text-teal-600 dark:text-teal-400" />
          </div>
          <h1 className="text-2xl font-bold">Set Up Atlas Mail</h1>
          <p className="text-sm text-muted-foreground">
            Connect your Northwest Registered Agent mailbox to send and receive
            emails directly from Atlas.
          </p>
        </div>

        <div className="rounded-xl border border-border/60 bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="h-4 w-4" />
            <span>Credentials are encrypted and stored server-side only</span>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email Address</label>
              <Input
                type="email"
                placeholder="you@businessidentity.llc"
                value={form.emailAddress}
                onChange={(e) =>
                  setForm({ ...form, emailAddress: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Password</label>
              <Input
                type="password"
                placeholder="Your mailbox password"
                value={form.password}
                onChange={(e) =>
                  setForm({ ...form, password: e.target.value })
                }
              />
            </div>

            <Separator className="my-3" />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  IMAP Host
                </label>
                <Input
                  value={form.imapHost}
                  onChange={(e) =>
                    setForm({ ...form, imapHost: e.target.value })
                  }
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  IMAP Port
                </label>
                <Input
                  type="number"
                  value={form.imapPort}
                  onChange={(e) =>
                    setForm({ ...form, imapPort: Number(e.target.value) })
                  }
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  SMTP Host
                </label>
                <Input
                  value={form.smtpHost}
                  onChange={(e) =>
                    setForm({ ...form, smtpHost: e.target.value })
                  }
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  SMTP Port
                </label>
                <Input
                  type="number"
                  value={form.smtpPort}
                  onChange={(e) =>
                    setForm({ ...form, smtpPort: Number(e.target.value) })
                  }
                  className="text-xs"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === "success" && (
            <div className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400 text-center font-medium">
              ✓ Mailbox connected successfully
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleTest}
            disabled={step === "testing" || step === "success"}
          >
            {step === "testing" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing connection…
              </>
            ) : step === "success" ? (
              "Connected!"
            ) : (
              "Test & Connect Mailbox"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Compose Dialog ───────────────────────────────────────────────────────

function ComposeDialog({
  open,
  onOpenChange,
  account,
  replyTo,
  replyAll,
  forward,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: EmailAccount | null;
  replyTo?: EmailMessage | null;
  replyAll?: boolean;
  forward?: boolean;
}) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signatures, setSignatures] = useState<EmailSignature[]>([]);
  const [showCc, setShowCc] = useState(false);

  useEffect(() => {
    if (open) {
      listSignatures().then(setSignatures).catch(() => {});
    }
  }, [open]);

  // Populate for reply/reply-all/forward
  useEffect(() => {
    if (!open) return;
    if (replyTo) {
      if (forward) {
        setTo("");
        setSubject(
          replyTo.subject
            ? `Fwd: ${replyTo.subject}`
            : "",
        );
        setBody(
          `\n\n---------- Forwarded message ----------\nFrom: ${replyTo.from_name ?? replyTo.from_address ?? ""} <${replyTo.from_address ?? ""}>\nSubject: ${replyTo.subject ?? ""}\nDate: ${replyTo.received_at ? new Date(replyTo.received_at).toLocaleString() : ""}\n\n${replyTo.text_body ?? ""}`,
        );
      } else {
        const replyAddr = replyTo.from_address ?? "";
        setTo(replyAddr);
        if (replyAll) {
          const extras = (replyTo.cc_addresses ?? [])
            .map((a) => (typeof a === "string" ? a : a.address))
            .filter((a) => a && a !== account?.email_address);
          if (extras.length > 0) {
            setCc(extras.join(", "));
            setShowCc(true);
          }
        }
        setSubject(
          replyTo.subject
            ? replyTo.subject.startsWith("Re:")
              ? replyTo.subject
              : `Re: ${replyTo.subject}`
            : "",
        );
        setBody("");
      }
    } else {
      setTo("");
      setCc("");
      setSubject("");
      setBody("");
    }
    setShowCc(!!replyAll && !forward);
  }, [open, replyTo, replyAll, forward, account]);

  const handleSend = async () => {
    if (!account || !to.trim()) return;
    setSending(true);
    try {
      const defaultSig = signatures.find((s) => s.is_default);
      const sigHtml = defaultSig?.signature_html ?? "";
      const sigText = defaultSig?.signature_text ?? "";
      const fullBody = body + (sigHtml ? `\n\n${sigHtml}` : sigText ? `\n\n${sigText}` : "");

      await sendMessage({
        accountId: account.id,
        fromAddress: account.email_address,
        fromName: account.display_name ?? account.email_address,
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        cc: cc ? cc.split(",").map((s) => s.trim()).filter(Boolean) : [],
        subject: subject || "(no subject)",
        textBody: fullBody,
        inReplyTo: replyTo?.message_id ?? undefined,
        references: replyTo?.references ?? (replyTo?.message_id ? [replyTo.message_id] : undefined),
      });
      onOpenChange(false);
    } catch (e) {
      console.error("Send failed:", e);
      alert(`Send failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setSending(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!account) return;
    setSaving(true);
    try {
      await saveDraft(account.id, {
        to_addresses: to
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((a) => ({ name: "", address: a })),
        subject,
        text_body: body,
        thread_id: replyTo?.thread_id ?? undefined,
        in_reply_to: replyTo?.message_id ?? undefined,
      });
      onOpenChange(false);
    } catch (e) {
      console.error("Draft save failed:", e);
    } finally {
      setSaving(false);
    }
  };

  const defaultSig = signatures.find((s) => s.is_default);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {forward
              ? "Forward"
              : replyTo
                ? replyAll
                  ? "Reply All"
                  : "Reply"
                : "New Message"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          <div className="flex items-center gap-2">
            <span className="w-12 text-sm text-muted-foreground">To</span>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="flex-1"
            />
          </div>
          {showCc && (
            <div className="flex items-center gap-2">
              <span className="w-12 text-sm text-muted-foreground">Cc</span>
              <Input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="cc@example.com"
                className="flex-1"
              />
            </div>
          )}
          {!showCc && !replyTo && (
            <button
              className="ml-14 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowCc(true)}
            >
              Cc
            </button>
          )}
          <div className="flex items-center gap-2">
            <span className="w-12 text-sm text-muted-foreground">
              Subject
            </span>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1"
            />
          </div>

          <Separator />

          <textarea
            className="min-h-[250px] w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message…"
          />

          {defaultSig && (
            <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <div className="mb-1 font-medium">Signature: {defaultSig.name}</div>
              <div
                dangerouslySetInnerHTML={{
                  __html: defaultSig.signature_html ?? defaultSig.signature_text ?? "",
                }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleSaveDraft} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Save Draft
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Discard
            </Button>
            <Button size="sm" onClick={handleSend} disabled={sending || !to.trim()}>
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Mail Inbox ──────────────────────────────────────────────────────

export default function MailInbox() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [account, setAccount] = useState<EmailAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState<MailFolder>("INBOX");
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [counts, setCounts] = useState<MailCounts>({ total: 0, unread: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<EmailMessage | null>(null);
  const [replyAll, setReplyAll] = useState(false);
  const [forward, setForward] = useState(false);
  const [selectedMsg, setSelectedMsg] = useState<EmailMessage | null>(null);

  // Load accounts
  useEffect(() => {
    (async () => {
      try {
        const accts = await listEmailAccounts();
        setAccounts(accts);
        if (accts.length > 0) setAccount(accts[0]);
      } catch (e) {
        console.error("Failed to load email accounts:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load messages when folder or account changes
  const loadMessages = useCallback(async () => {
    if (!account) return;
    try {
      if (activeFolder === "Drafts") {
        const d = await listDrafts(account.id);
        setDrafts(d);
        setMessages([]);
      } else if (activeFolder === "Sent") {
        const m = await listSentMessages(account.id);
        setMessages(m);
        setDrafts([]);
      } else if (activeFolder === "Starred") {
        const m = await listStarredMessages(account.id);
        setMessages(m);
        setDrafts([]);
      } else if (activeFolder === "Trash") {
        const m = await listMessages(account.id, "Trash");
        setMessages(m);
        setDrafts([]);
      } else if (activeFolder === "Archive") {
        const m = await listMessages(account.id, "Archive");
        setMessages(m);
        setDrafts([]);
      } else {
        const m = searchQuery
          ? await listAllMessages(account.id, 50, 0, searchQuery)
          : await listMessages(account.id, "INBOX");
        setMessages(m);
        setDrafts([]);
      }
      // Update counts
      const c = await getMessageCounts(account.id, "INBOX");
      setCounts(c);
    } catch (e) {
      console.error("Failed to load messages:", e);
    }
  }, [account, activeFolder, searchQuery]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const handleSync = async () => {
    if (!account || syncing) return;
    setSyncing(true);
    try {
      // Sync via Edge Function — credentials are read from DB server-side
      await syncFolder({
        accountId: account.id,
        folder: "INBOX",
        limit: 100,
      });
      await loadMessages();
    } catch (e) {
      console.error("Sync failed:", e);
    } finally {
      setSyncing(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    await markRead(id, true);
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, is_read: true } : m)),
    );
  };

  const handleToggleStar = async (id: string) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg) return;
    await markStarred(id, !msg.is_starred);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, is_starred: !m.is_starred } : m,
      ),
    );
  };

  const handleArchive = async (id: string) => {
    await moveMessage(id, "Archive");
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  const handleTrash = async (id: string) => {
    await moveMessage(id, "Trash");
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  const handleOpenMessage = (msg: EmailMessage) => {
    setSelectedMsg(msg);
    if (!msg.is_read) handleMarkRead(msg.id);
  };

  const handleReply = (msg: EmailMessage) => {
    setReplyTo(msg);
    setReplyAll(false);
    setForward(false);
    setComposeOpen(true);
  };

  const handleReplyAll = (msg: EmailMessage) => {
    setReplyTo(msg);
    setReplyAll(true);
    setForward(false);
    setComposeOpen(true);
  };

  const handleForward = (msg: EmailMessage) => {
    setReplyTo(msg);
    setReplyAll(false);
    setForward(true);
    setComposeOpen(true);
  };

  const handleNewCompose = () => {
    setReplyTo(null);
    setReplyAll(false);
    setForward(false);
    setComposeOpen(true);
  };

  // ── Setup screen ─────────────────────────────────────────────────────

  if (!loading && accounts.length === 0) {
    return (
      <SetupScreen
        onSetup={async () => {
          const accts = await listEmailAccounts();
          setAccounts(accts);
          if (accts.length > 0) setAccount(accts[0]);
        }}
      />
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
          <div className="col-span-9 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Main layout ──────────────────────────────────────────────────────

  return (
    <div className="-mx-4 -mt-6 flex h-[calc(100vh-3.5rem)] flex-col sm:-mx-6 lg:-mx-8">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search emails…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            onKeyDown={(e) => {
              if (e.key === "Enter") loadMessages();
            }}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCw
            className={cn("h-4 w-4", syncing && "animate-spin")}
          />
          <span className="ml-2 hidden sm:inline">Sync</span>
        </Button>
        <Button size="sm" onClick={handleNewCompose}>
          <Pencil className="h-4 w-4" />
          <span className="ml-2 hidden sm:inline">Compose</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/dashboard/mail/settings")}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="hidden w-52 shrink-0 border-r border-border/60 sm:block">
          <nav className="p-2 space-y-0.5">
            {FOLDERS.map((folder) => {
              const Icon = folder.icon;
              const isActive = activeFolder === folder.id;
              return (
                <button
                  key={folder.id}
                  onClick={() => {
                    setActiveFolder(folder.id);
                    setSelectedMsg(null);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-teal-500/10 text-teal-700 font-medium dark:text-teal-300"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{folder.label}</span>
                  {folder.id === "INBOX" && counts.unread > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-auto h-5 min-w-[20px] justify-center rounded-full bg-teal-500/10 text-[10px] font-bold text-teal-700 dark:text-teal-300"
                    >
                      {counts.unread}
                    </Badge>
                  )}
                </button>
              );
            })}
          </nav>

          {account && (
            <div className="border-t border-border/60 p-3">
              <div className="text-xs text-muted-foreground truncate">
                {account.email_address}
              </div>
              {account.last_synced_at && (
                <div className="mt-1 text-[10px] text-muted-foreground/60">
                  Last synced{" "}
                  {formatEmailDate(account.last_synced_at)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile folder selector */}
        <div className="flex sm:hidden gap-1 border-b border-border/60 px-2 py-1.5 overflow-x-auto">
          {FOLDERS.map((folder) => {
            const Icon = folder.icon;
            return (
              <button
                key={folder.id}
                onClick={() => {
                  setActiveFolder(folder.id);
                  setSelectedMsg(null);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs whitespace-nowrap",
                  activeFolder === folder.id
                    ? "bg-teal-500/10 text-teal-700 dark:text-teal-300"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="h-3 w-3" />
                {folder.label}
              </button>
            );
          })}
        </div>

        {/* Content area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Message list */}
          <div className="flex-1 overflow-y-auto">
            {selectedMsg ? (
              // ── Message detail ──────────────────────────────────
              <div className="h-full overflow-y-auto">
                <MessageDetail
                  message={selectedMsg}
                  onBack={() => setSelectedMsg(null)}
                  onReply={() => handleReply(selectedMsg)}
                  onReplyAll={() => handleReplyAll(selectedMsg)}
                  onForward={() => handleForward(selectedMsg)}
                  onArchive={() => {
                    handleArchive(selectedMsg.id);
                    setSelectedMsg(null);
                  }}
                  onTrash={() => {
                    handleTrash(selectedMsg.id);
                    setSelectedMsg(null);
                  }}
                  onToggleStar={() => handleToggleStar(selectedMsg.id)}
                />
              </div>
            ) : (
              // ── Message list ────────────────────────────────────
              <div>
                {activeFolder === "Drafts" ? (
                  drafts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                      <FileText className="mb-3 h-8 w-8" />
                      <p className="text-sm font-medium">No drafts</p>
                      <p className="mt-1 text-xs">Composed emails saved as drafts will appear here.</p>
                    </div>
                  ) : (
                    drafts.map((draft) => (
                      <div
                        key={draft.id}
                        className="flex items-start gap-3 border-b border-border/40 px-4 py-3 hover:bg-muted/30 cursor-pointer"
                        onClick={() => {
                          setReplyTo(null);
                          setComposeOpen(true);
                        }}
                      >
                        <div className="mt-1">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {draft.subject || "(no subject)"}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground truncate">
                            {draft.text_body?.slice(0, 100) || "Empty draft"}
                          </div>
                          <div className="mt-1 text-[10px] text-muted-foreground/60">
                            {formatEmailDate(draft.updated_at)}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={async (e) => {
                            e.stopPropagation();
                            await deleteDraft(draft.id);
                            setDrafts((prev) =>
                              prev.filter((d) => d.id !== draft.id),
                            );
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))
                  )
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <InboxIcon className="mb-3 h-8 w-8" />
                    <p className="text-sm font-medium">{searchQuery ? "No results" : "No messages"}</p>
                    <p className="mt-1 text-xs">
                      {searchQuery ? `No emails match "${searchQuery}"` : `Your ${activeFolder.toLowerCase()} is empty.`}
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <MessageRow
                      key={msg.id}
                      message={msg}
                      onClick={() => handleOpenMessage(msg)}
                      onStar={() => handleToggleStar(msg.id)}
                      onArchive={() => handleArchive(msg.id)}
                      onTrash={() => handleTrash(msg.id)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compose dialog */}
      <ComposeDialog
        open={composeOpen}
        onOpenChange={setComposeOpen}
        account={account}
        replyTo={replyTo}
        replyAll={replyAll}
        forward={forward}
      />
    </div>
  );
}

// ── Message Row ──────────────────────────────────────────────────────────

function MessageRow({
  message,
  onClick,
  onStar,
  onArchive,
  onTrash,
}: {
  message: EmailMessage;
  onClick: () => void;
  onStar: () => void;
  onArchive: () => void;
  onTrash: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group flex items-start gap-3 border-b border-border/40 px-4 py-2.5 cursor-pointer transition-colors hover:bg-muted/30",
        !message.is_read && "bg-teal-500/[0.03]",
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
          hashColor(message.from_address ?? ""),
        )}
      >
        {getInitials(message.from_name, message.from_address)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-sm truncate",
              !message.is_read ? "font-semibold" : "font-medium",
            )}
          >
            {message.from_name || message.from_address || "Unknown"}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            {formatEmailDate(message.received_at)}
          </span>
        </div>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span
            className={cn(
              "text-sm truncate",
              !message.is_read ? "font-medium" : "text-muted-foreground",
            )}
          >
            {message.subject || "(no subject)"}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-xs text-muted-foreground truncate">
            {message.snippet?.slice(0, 80) || ""}
          </span>
          {message.has_attachments && (
            <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStar();
          }}
          className="rounded p-1 hover:bg-muted"
        >
          <Star
            className={cn(
              "h-3.5 w-3.5",
              message.is_starred
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground",
            )}
          />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="rounded p-1 hover:bg-muted"
            >
              <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onArchive();
              }}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onTrash();
              }}
              className="text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ── Message Detail ───────────────────────────────────────────────────────

function MessageDetail({
  message,
  onBack,
  onReply,
  onReplyAll,
  onForward,
  onArchive,
  onTrash,
  onToggleStar,
}: {
  message: EmailMessage;
  onBack: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onToggleStar: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleStar}>
          <Star
            className={cn(
              "h-4 w-4",
              message.is_starred
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground",
            )}
          />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onReply}>
          <Mail className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onArchive}>
          <Archive className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive"
          onClick={onTrash}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Subject */}
      <div className="px-6 py-4">
        <h2 className="text-xl font-semibold">{message.subject || "(no subject)"}</h2>
      </div>

      {/* Sender info */}
      <div className="flex items-start gap-3 px-6 pb-4">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",
            hashColor(message.from_address ?? ""),
          )}
        >
          {getInitials(message.from_name, message.from_address)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">
              {message.from_name || message.from_address}
            </span>
            {message.from_name && message.from_address && (
              <span className="text-xs text-muted-foreground">
                &lt;{message.from_address}&gt;
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            To:{" "}
            {(message.to_addresses ?? [])
              .map((a) =>
                typeof a === "string" ? a : a.name || a.address,
              )
              .join(", ")}
          </div>
          {message.cc_addresses && message.cc_addresses.length > 0 && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              Cc:{" "}
              {message.cc_addresses
                .map((a) =>
                  typeof a === "string" ? a : a.name || a.address,
                )
                .join(", ")}
            </div>
          )}
          <div className="mt-0.5 text-[11px] text-muted-foreground/60">
            {message.received_at
              ? new Date(message.received_at).toLocaleString()
              : ""}
          </div>
        </div>

        {/* Reply actions */}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={onReply}>
            Reply
          </Button>
          <Button variant="outline" size="sm" onClick={onReplyAll}>
            Reply All
          </Button>
          <Button variant="outline" size="sm" onClick={onForward}>
            Forward
          </Button>
        </div>
      </div>

      <Separator />

      {/* Body */}
      <div className="px-6 py-4">
        {message.html_body ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(message.html_body) }}
          />
        ) : (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90 font-[inherit]">
            {message.text_body || message.snippet || "(no content)"}
          </pre>
        )}
      </div>

      {/* Attachments */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="border-t border-border/60 px-6 py-3">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            {message.attachments.length} Attachment
            {message.attachments.length > 1 ? "s" : ""}
          </div>
          <div className="flex flex-wrap gap-2">
            {message.attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs"
              >
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate max-w-[200px]">
                  {att.filename ?? "attachment"}
                </span>
                {att.size != null && (
                  <span className="text-muted-foreground/60">
                    ({(att.size / 1024).toFixed(1)} KB)
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
