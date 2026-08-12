import { api } from "@/lib/api";
import type { Id } from "@/lib/data-model";
import { PageHeader, formatDate } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAction, useMutation, useQuery } from "@/hooks/use-supabase";
import {
  Cable,
  Cloud,
  CreditCard,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderOpen,
  Github,
  HardDrive,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  Plug,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Unplug,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

const MANAGER_ROLES = ["owner", "admin", "manager"];

const FILE_FORMATS = ["PDF", "DOCX", "XLSX", "XLS", "CSV", "MD", "TXT"];

// ---------------------------------------------------------------------------
// Catalog types (mirror of connections.listConnectorCatalog)
// ---------------------------------------------------------------------------

type CatalogConnection = {
  _id: Id<"connections">;
  name: string;
  provider: string;
  status: string;
  lastSyncAt?: number;
  lastError?: string;
  healthStatus?: string;
  lastTestedAt?: number;
  accountName?: string;
  accountEmail?: string;
};

type CatalogEntry = {
  id: string;
  name: string;
  category: string;
  authType: "oauth2" | "api_key" | "none";
  capabilities: string[];
  requiredEnvVars: string[];
  oauthScopes: string[];
  configured: boolean;
  missingEnvVars: string[];
  displayStatus: string;
  setupInstructions: string;
  docsUrl: string | null;
  connection: CatalogConnection | null;
};

const CATALOG_ICONS: Record<string, typeof HardDrive> = {
  manual_upload: FileUp,
  google_drive: HardDrive,
  google_gmail: Mail,
  microsoft_365: Cloud,
  slack: MessageSquare,
  hubspot: Users,
  quickbooks: FileSpreadsheet,
  stripe: CreditCard,
  dropbox: FolderOpen,
  notion: FileText,
  github: Github,
};

const CATEGORY_FALLBACK_ICONS: Record<string, typeof HardDrive> = {
  document_storage: HardDrive,
  email: Mail,
  communication: MessageSquare,
  crm: Users,
  accounting: FileSpreadsheet,
  payments: CreditCard,
  development: Github,
  productivity: FileText,
  uploads: FileUp,
};

const STATUS_META: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  healthy: {
    label: "Connected · healthy",
    className:
      "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
    dot: "bg-emerald-400",
  },
  connected: {
    label: "Connected",
    className:
      "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
    dot: "bg-emerald-400",
  },
  degraded: {
    label: "Connected · degraded",
    className:
      "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
    dot: "bg-amber-400",
  },
  syncing: {
    label: "Syncing",
    className:
      "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
    dot: "bg-amber-400",
  },
  error: {
    label: "Error",
    className:
      "border-rose-400/30 bg-rose-400/10 text-rose-600 dark:text-rose-300",
    dot: "bg-rose-400",
  },
  not_configured: {
    label: "Not configured",
    className:
      "border-amber-400/30 bg-amber-400/10 text-amber-600 dark:text-amber-300",
    dot: "bg-amber-400",
  },
  authorization_required: {
    label: "Authorization required",
    className:
      "border-sky-400/30 bg-sky-400/10 text-sky-600 dark:text-sky-300",
    dot: "bg-sky-400",
  },
  available: {
    label: "Ready",
    className:
      "border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
    dot: "bg-emerald-400",
  },
  roadmap: {
    label: "Roadmap",
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
};

const CAPABILITY_LABELS: Record<string, string> = {
  read: "Read",
  write: "Write",
  webhook: "Webhooks",
  polling: "Polling",
  sync_documents: "Doc sync",
  search: "Search",
};

function CatalogStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.roadmap;
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 font-mono text-[10px] uppercase tracking-wide ${meta.className}`}
    >
      <span className={`size-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </Badge>
  );
}

export default function Connections() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const workspace = useQuery(api.tenants.getMyWorkspace);
  const catalog = useQuery(api.connections.listConnectorCatalog);
  const beginOAuth = useMutation(api.connections.beginGoogleDriveOAuth);
  const disconnect = useMutation(api.connections.disconnectGoogleDrive);
  const syncDrive = useAction(api.connectionsSync.syncGoogleDrive);
  const testConn = useAction(api.connectionsSync.testConnection);
  const runDueSyncs = useAction(api.connectionsSync.runDueSyncs);

  const [oauthBusy, setOauthBusy] = useState(false);
  const [syncBusyId, setSyncBusyId] = useState<string | null>(null);
  const [testBusyId, setTestBusyId] = useState<string | null>(null);
  const [showKeysHint, setShowKeysHint] = useState(false);

  const isManager = MANAGER_ROLES.includes(workspace?.membership?.role ?? "");
  const entries = catalog ?? [];

  const uploadEntry = entries.find((e) => e.id === "manual_upload");
  const connectable = entries.filter(
    (e) => e.id !== "manual_upload" && e.displayStatus !== "roadmap",
  );
  const roadmap = entries.filter((e) => e.displayStatus === "roadmap");
  const connectedCount = entries.filter((e) =>
    ["connected", "healthy", "degraded", "syncing"].includes(e.displayStatus),
  ).length;

  // Handle the OAuth callback result (?oauth=success|denied|error=…) and kick
  // off the first sync when the connection was just created.
  useEffect(() => {
    const oauth = searchParams.get("oauth");
    if (!oauth) return;
    if (oauth === "success") {
      toast.success("Google Drive connected", {
        description: "Your first sync is starting — documents will appear in Knowledge.",
      });
      void runDueSyncs().catch(() => {});
    } else if (oauth === "denied") {
      toast.info("Google authorization cancelled");
    } else {
      const detail = searchParams.get("oauth")?.split("=")[1] ?? oauth;
      toast.error("Google Drive connection failed", {
        description:
          detail === "not_configured"
            ? "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your project keys first."
            : "The authorization could not be completed. Try again.",
      });
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, runDueSyncs]);

  const siteBase = ((import.meta.env.VITE_SUPABASE_URL as string) ?? "").replace(/\/$/, "");

  const connectDrive = async () => {
    if (!siteBase) {
      toast.error("Can't resolve the Supabase project URL for OAuth redirects.");
      return;
    }
    setOauthBusy(true);
    try {
      const returnTo = `${window.location.origin}${window.location.pathname}`;
      const res = await beginOAuth({ redirectBase: siteBase, returnTo });
      if (!res.ok) {
        if (res.code === "not_configured") {
          setShowKeysHint(true);
          toast.error("Google Drive isn't configured yet", {
            description: res.reason,
          });
        }
        return;
      }
      const w = window.open(
        res.authUrl,
        "_blank",
        "noopener,noreferrer,width=540,height=720",
      );
      if (!w) {
        toast.error("Pop-up blocked", {
          description: "Allow pop-ups for this site and try again.",
        });
        return;
      }
      toast.info("Authorize Atlas in the Google window that opened.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start Google authorization");
    } finally {
      setOauthBusy(false);
    }
  };

  const syncNow = async (conn: CatalogConnection) => {
    if (!conn) return;
    setSyncBusyId(conn._id);
    try {
      const res = await syncDrive({ connectionId: conn._id });
      toast.success("Sync finished", {
        description: `${res.ingested} ingested · ${res.unchanged} unchanged · ${res.skipped} skipped · ${res.failed} failed`,
      });
      if (res.errors.length > 0) {
        toast.warning("Some files failed", { description: res.errors[0] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncBusyId(null);
    }
  };

  const testNow = async (conn: CatalogConnection) => {
    setTestBusyId(conn._id);
    try {
      const res = await testConn({ connectionId: conn._id });
      if (res.ok) {
        toast.success("Connection verified", {
          description: res.accountEmail ?? res.accountName ?? "Live API check passed.",
        });
      } else {
        toast.error("Connection check failed", { description: res.reason });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connection test failed");
    } finally {
      setTestBusyId(null);
    }
  };

  const disconnectConn = async (conn: CatalogConnection) => {
    setSyncBusyId(conn._id);
    try {
      await disconnect();
      toast.success("Google Drive disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setSyncBusyId(null);
    }
  };

  const iconFor = (entry: CatalogEntry) =>
    CATALOG_ICONS[entry.id] ?? CATEGORY_FALLBACK_ICONS[entry.category] ?? Cable;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Connect your company"
        title="Every source, one knowledge layer"
        description="Atlas connects the systems and files your company already uses — no migration needed. Statuses are real: a connector only shows as connected when a live connection exists and has been verified against the provider's API."
      />

      {/* Summary strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-card/60 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Live connections
          </p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {connectedCount}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Verified against the provider API · never assumed
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/60 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Ready to authorize
          </p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {connectable.filter((e) => e.displayStatus === "authorization_required").length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Keys configured · awaiting your authorization
          </p>
        </div>
        <div className="rounded-xl border border-border/70 bg-card/60 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            On the roadmap
          </p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {roadmap.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            APIs documented · clients not built yet
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Files */}
      {/* ------------------------------------------------------------------ */}
      {uploadEntry && (
        <section className="rounded-xl border border-border/70 bg-card/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-teal-400/10 text-teal-600 ring-1 ring-teal-400/20 dark:text-teal-300">
                <FileUp className="size-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold">{uploadEntry.name}</h2>
                  <CatalogStatusBadge status={uploadEntry.displayStatus} />
                </div>
                <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                  Upload your company's documents and spreadsheets directly. Atlas parses them,
                  extracts entities and facts, and grounds every answer in what it read.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {FILE_FORMATS.map((f) => (
                    <span
                      key={f}
                      className="rounded-md border border-border/70 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {f}
                    </span>
                  ))}
                  <span className="text-[10px] text-muted-foreground/70">
                    · scanned PDFs are detected & flagged (OCR roadmap)
                  </span>
                </div>
              </div>
            </div>
            <Button onClick={() => navigate("/dashboard/knowledge")} className="gap-2">
              <FileUp className="size-4" />
              Upload files
            </Button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Connectable apps */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Connections</h2>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {connectable.length} in catalog
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {connectable.map((entry) => {
            const Icon = iconFor(entry);
            const conn = entry.connection;
            const isLive =
              conn &&
              ["connected", "healthy", "degraded", "syncing"].includes(entry.displayStatus);
            return (
              <div
                key={entry.id}
                className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-border"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ${
                        isLive
                          ? "bg-teal-400/10 text-teal-600 ring-teal-400/20 dark:text-teal-300"
                          : "bg-muted/50 text-muted-foreground ring-border/60"
                      }`}
                    >
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{entry.name}</p>
                      <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground/70">
                        {entry.category.replace(/_/g, " ")}
                      </p>
                    </div>
                  </div>
                  <CatalogStatusBadge status={entry.displayStatus} />
                </div>

                <p className="text-xs leading-5 text-muted-foreground">{entry.description}</p>

                <div className="flex flex-wrap gap-1.5">
                  {entry.capabilities.map((c) => (
                    <span
                      key={c}
                      className="rounded-md border border-border/70 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {CAPABILITY_LABELS[c] ?? c}
                    </span>
                  ))}
                </div>

                {entry.displayStatus === "not_configured" && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-[11px] leading-5 text-amber-700 dark:text-amber-200">
                    <KeyRound className="mt-0.5 size-3.5 shrink-0" />
                    <div>
                      <p className="font-semibold">Not configured</p>
                      <p className="mt-0.5">
                        Add to your project Keys:{" "}
                        {entry.missingEnvVars.map((v) => (
                          <code key={v} className="mx-0.5 rounded bg-background/60 px-1 font-mono">
                            {v}
                          </code>
                        ))}
                      </p>
                    </div>
                  </div>
                )}

                {entry.displayStatus === "authorization_required" &&
                  entry.authType === "oauth2" && (
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Lock className="size-3" />
                      Keys detected — connect to authorize Atlas.
                    </p>
                  )}

                {entry.displayStatus === "error" && conn?.lastError && (
                  <p className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-600 dark:text-rose-300">
                    {conn.lastError}
                  </p>
                )}

                {isLive && conn && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-300" />
                      {conn.accountEmail ?? conn.accountName ?? "Live connection"}
                    </span>
                    {conn.lastTestedAt && <span>Tested {formatDate(conn.lastTestedAt)}</span>}
                    {conn.lastSyncAt && <span>Synced {formatDate(conn.lastSyncAt)}</span>}
                  </div>
                )}

                {isLive && entry.oauthScopes.length > 0 && (
                  <p className="text-[10px] leading-4 text-muted-foreground/70">
                    Granted scopes: {entry.oauthScopes.join(" · ")}
                  </p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  {isLive && conn ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={!isManager || syncBusyId !== null || testBusyId !== null}
                        onClick={() => void testNow(conn)}
                      >
                        {testBusyId === conn._id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Search className="size-3.5" />
                        )}
                        Test connection
                      </Button>
                      {entry.id === "google_drive" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={!isManager || syncBusyId !== null || testBusyId !== null}
                          onClick={() => void syncNow(conn)}
                        >
                          {syncBusyId === conn._id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RefreshCcw className="size-3.5" />
                          )}
                          Sync now
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-muted-foreground"
                        disabled={!isManager || syncBusyId !== null || testBusyId !== null}
                        onClick={() => void disconnectConn(conn)}
                      >
                        <Unplug className="size-3.5" />
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    entry.id === "google_drive" && (
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={!isManager || oauthBusy || syncBusyId !== null}
                        onClick={() => void connectDrive()}
                      >
                        {oauthBusy ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Plug className="size-3.5" />
                        )}
                        Connect Google Drive
                      </Button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {showKeysHint && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-[11px] leading-5 text-amber-700 dark:text-amber-200">
            <KeyRound className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong>To enable Google Drive:</strong> add{" "}
              <code className="rounded bg-background/60 px-1 font-mono">GOOGLE_CLIENT_ID</code>{" "}
              and{" "}
              <code className="rounded bg-background/60 px-1 font-mono">GOOGLE_CLIENT_SECRET</code>{" "}
              to your project's Keys, and register{" "}
              <code className="rounded bg-background/60 px-1 font-mono">
                {siteBase || "https://<your-project>.supabase.co"}
                /functions/v1/connections-sync-google-drive/google/oauth/callback
              </code>{" "}
              as an authorized redirect URI in the Google Cloud Console.
            </span>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Roadmap */}
      {/* ------------------------------------------------------------------ */}
      {roadmap.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Connector roadmap</h2>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
              APIs documented · not built
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roadmap.map((entry) => {
              const Icon = iconFor(entry);
              return (
                <div
                  key={entry.id}
                  className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-card/40 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{entry.name}</p>
                        <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground/70">
                          {entry.category.replace(/_/g, " ")}
                        </p>
                      </div>
                    </div>
                    <CatalogStatusBadge status="roadmap" />
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{entry.description}</p>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Sparkles className="size-3 text-teal-500" />
                    Real {entry.authType === "oauth2" ? "OAuth 2.0" : "API key"} pathway defined —
                    client not built yet.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {entry.requiredEnvVars.map((v) => (
                      <span
                        key={v}
                        className="rounded-md border border-border/70 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] leading-5 text-muted-foreground/80">
                    {entry.setupInstructions}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!isManager && (
        <p className="border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
          Managers and above can connect, test, sync and disconnect sources.
        </p>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        No connector is ever shown as connected without a real connection and a live API check —
        nothing here is simulated.
      </p>
    </div>
  );
}
