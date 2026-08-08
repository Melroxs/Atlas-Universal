import { api } from "@/convex/_generated/api";
import { ConnStatusBadge, PageHeader, formatDate } from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Cable,
  Cloud,
  FileSpreadsheet,
  FileUp,
  HardDrive,
  KeyRound,
  Loader2,
  Mail,
  MessageSquare,
  Plug,
  RefreshCcw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

const MANAGER_ROLES = ["owner", "admin", "manager"];

const FILE_FORMATS = ["PDF", "DOCX", "XLSX", "XLS", "CSV", "MD", "TXT"];

const COMING_SOON: Array<{
  name: string;
  icon: typeof Plug;
  note: string;
}> = [
  { name: "CRM", icon: Plug, note: "JobNimbus, HubSpot and other customer platforms" },
  { name: "Accounting", icon: FileSpreadsheet, note: "QuickBooks, Xero — invoices, AR and GL" },
  { name: "Project management", icon: Cable, note: "DASH, ServiceTitan, job boards" },
  { name: "Email", icon: Mail, note: "IMAP ingestion for proposals and correspondence" },
  { name: "Communication", icon: MessageSquare, note: "Slack, Microsoft Teams" },
  { name: "Microsoft 365", icon: Cloud, note: "OneDrive & SharePoint — OAuth, same pipeline" },
];

export default function Connections() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const workspace = useQuery(api.tenants.getMyWorkspace);
  const connections = useQuery(api.connections.listConnections);
  const beginOAuth = useMutation(api.connections.beginGoogleDriveOAuth);
  const disconnect = useMutation(api.connections.disconnectGoogleDrive);
  const syncDrive = useAction(api.connectionsSync.syncGoogleDrive);
  const runDueSyncs = useAction(api.connectionsSync.runDueSyncs);

  const [oauthBusy, setOauthBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [showKeysHint, setShowKeysHint] = useState(false);

  const isManager = MANAGER_ROLES.includes(workspace?.membership?.role ?? "");
  const drive = (connections ?? []).find((c) => c.provider === "google_drive");
  const manualUpload = (connections ?? []).find((c) => c.provider === "manual_upload");

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

  const siteBase = (
    (import.meta.env.VITE_CONVEX_URL as string) ?? ""
  ).replace(/\.convex\.cloud$/, ".convex.site");

  const connectDrive = async () => {
    if (!siteBase) {
      toast.error("Can't resolve the Convex site URL for OAuth redirects.");
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
      const w = window.open(res.authUrl, "_blank", "noopener,noreferrer,width=540,height=720");
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

  const syncNow = async () => {
    if (!drive) return;
    setSyncBusy(true);
    try {
      const res = await syncDrive({ connectionId: drive._id });
      toast.success("Sync finished", {
        description: `${res.ingested} ingested · ${res.unchanged} unchanged · ${res.skipped} skipped · ${res.failed} failed`,
      });
      if (res.errors.length > 0) {
        toast.warning("Some files failed", { description: res.errors[0] });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncBusy(false);
    }
  };

  const disconnectDrive = async () => {
    setSyncBusy(true);
    try {
      await disconnect();
      toast.success("Google Drive disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setSyncBusy(false);
    }
  };

  const driveConnected = drive?.status === "connected";
  const driveError = drive?.status === "error";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Connect your company"
        title="Every source, one knowledge layer"
        description="Atlas connects the systems and files your company already uses — no migration needed. Files upload directly; cloud sources connect with real OAuth and feed the exact same ingestion pipeline."
      />

      {/* ------------------------------------------------------------------ */}
      {/* Files */}
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-xl border border-border/70 bg-card/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-teal-400/10 text-teal-600 ring-1 ring-teal-400/20 dark:text-teal-300">
              <FileUp className="size-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">Files</h2>
                {manualUpload && (
                  <Badge
                    variant="outline"
                    className="font-mono text-[10px] uppercase tracking-wide border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300"
                  >
                    Active · live
                  </Badge>
                )}
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
                  · scanned PDFs are detected & flagged (OCR coming soon)
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

      {/* ------------------------------------------------------------------ */}
      {/* Cloud storage */}
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-xl border border-border/70 bg-card/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-teal-400/10 text-teal-600 ring-1 ring-teal-400/20 dark:text-teal-300">
              <Cloud className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">Google Drive</h2>
                {drive ? (
                  <ConnStatusBadge status={drive.status} />
                ) : (
                  <Badge
                    variant="outline"
                    className="border-muted-foreground/30 text-muted-foreground"
                  >
                    Not connected
                  </Badge>
                )}
              </div>
              <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
                Real OAuth connector. Syncs PDFs, Word documents, Excel spreadsheets, CSV files,
                Google Docs and Google Sheets into the knowledge base — with change detection and
                de-duplication. Only shows as connected when a live connection exists.
              </p>

              {drive && driveConnected && (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5 text-emerald-600 dark:text-emerald-300" />
                    Live connection · read-only scope
                  </span>
                  <span>Last sync: {formatDate(drive.lastSyncAt)}</span>
                </div>
              )}

              {driveError && drive.lastError && (
                <p className="mt-2.5 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-600 dark:text-rose-300">
                  {drive.lastError}
                </p>
              )}

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
                      {siteBase || "https://<your-deployment>.convex.site"}
                      /google/oauth/callback
                    </code>{" "}
                    as an authorized redirect URI in the Google Cloud Console.
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {driveConnected ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={!isManager || syncBusy || oauthBusy}
                  onClick={() => void syncNow()}
                >
                  {syncBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="size-3.5" />
                  )}
                  Sync now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-muted-foreground"
                  disabled={!isManager || syncBusy || oauthBusy}
                  onClick={() => void disconnectDrive()}
                >
                  <Unplug className="size-3.5" />
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!isManager || oauthBusy}
                onClick={() => void connectDrive()}
              >
                {oauthBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plug className="size-3.5" />
                )}
                Connect Google Drive
              </Button>
            )}
          </div>
        </div>
        {!isManager && (
          <p className="mt-3 border-t border-border/50 pt-2.5 text-[11px] text-muted-foreground">
            Managers and above can connect, sync and disconnect sources.
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Coming soon */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Future connectors</h2>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
            coming soon
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COMING_SOON.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.name}
                className="flex items-start gap-3 rounded-xl border border-dashed border-border/70 bg-card/40 p-4"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{c.name}</p>
                    <Badge
                      variant="outline"
                      className="border-muted-foreground/30 px-1.5 py-0 font-mono text-[9px] uppercase tracking-wide text-muted-foreground"
                    >
                      Coming soon
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{c.note}</p>
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <HardDrive className="size-3.5" />
          Connectors are only shown as connected when a real connection exists — nothing here is
          simulated.
        </p>
      </section>
    </div>
  );
}
