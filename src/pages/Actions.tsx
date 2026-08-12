import { api } from "@/lib/api";
import type { Id } from "@/lib/data-model";
import {
  ActionStatusBadge,
  EmptyPanel,
  ImplBadge,
  PageHeader,
  RiskBadge,
  StatCard,
  VerificationBadge,
  formatDate,
} from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction, useQuery } from "@/hooks/use-supabase";
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  ChevronDown,
  FileSearch,
  History,
  Loader2,
  Play,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types (mirror of the server-derived catalog — availability is never hardcoded)
// ---------------------------------------------------------------------------

interface ToolRow {
  id: string;
  name: string;
  description: string;
  category: string;
  provider: string | null;
  version: string;
  capabilities: string[];
  riskLevel: string;
  riskLabel: string;
  confirmationRequired: boolean;
  policyReason: string;
  implementationStatus: string;
  minRole: string;
  inputFields: ToolField[];
  requiredScopes: string[];
  documentationUrl: string | null;
  enabled: boolean;
  connected: boolean;
  scopesOk: boolean;
  canRun: boolean;
}

interface HistoryRow {
  _id: string;
  _creationTime: number;
  toolId: string;
  toolName: string;
  status: string;
  actorName: string;
  confirmedByName?: string | null;
  error?: string | null;
  input?: unknown;
  result?: unknown;
  confirmationRequired?: boolean;
  confirmationMessage?: string | null;
  confirmedAt?: number | null;
  verificationStatus?: string | null;
  verificationResult?: unknown;
  evidence?: unknown;
  requestText?: string | null;
  explanation?: unknown;
  startedAt?: number | null;
  completedAt?: number | null;
}

// ---------------------------------------------------------------------------
// Local mirrors of the server tool-schema types. These used to be imported
// (type-only) from src/convex/tools/*, but that pulled the Convex modules into
// the client TypeScript program, making the deploy build exceed its time/memory
// budget. The shapes are stable contract types — kept in sync with the server
// registry (src/convex/tools/registry.ts, src/convex/tools/policy.ts).
// ---------------------------------------------------------------------------

interface ToolField {
  key: string;
  type: "string" | "number" | "boolean" | "enum";
  required?: boolean;
  description: string;
  /** Values for type "enum". */
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  /** Rendered as a multi-line input when true. */
  longText?: boolean;
}

interface ConfirmationDetails {
  toolId: string;
  message: string;
  what: string;
  system: string;
  account: string;
  resource: string;
  consequences: string[];
  reversible: boolean;
}

type ComposerValues = Record<string, string | number | boolean>;

const PROVIDER_LABELS: Record<string, string> = {
  google_drive: "Google Drive",
};

function providerLabel(p: string | null): string {
  if (!p) return "Atlas workspace";
  return PROVIDER_LABELS[p] ?? p;
}

function displayValue(v: unknown, max = 240): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > max ? `${v.slice(0, max)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v, null, 2);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return String(v);
  }
}

function defaultFor(field: ToolField): ComposerValues[string] {
  if (field.type === "boolean") return false;
  if (field.type === "enum") return field.enum?.[0] ?? "";
  if (field.type === "number") return "";
  return "";
}

/** Strip empty/unset values and coerce numbers before sending to the runtime. */
function normalizeValues(values: ComposerValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === "" || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export default function Actions() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const tools = useQuery(api.tools.tools.listTools);
  const history = useQuery(api.tools.tools.listToolActions, {});
  const executeTool = useAction(api.tools.execute.executeTool);
  const confirmToolAction = useAction(api.tools.execute.confirmToolAction);
  const cancelToolAction = useAction(api.tools.execute.cancelToolAction);

  const [composerTool, setComposerTool] = useState<ToolRow | null>(null);
  const [composerValues, setComposerValues] = useState<ComposerValues>({});
  const [runningToolId, setRunningToolId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    actionId: Id<"toolActions">;
    toolName: string;
    details: ConfirmationDetails;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Ask Atlas handoff: ?tool=<toolId>&args=<JSON> opens the composer prefilled.
  useEffect(() => {
    const toolId = searchParams.get("tool");
    if (!toolId || !tools) return;
    const tool = tools.find((t) => t.id === toolId);
    if (!tool) return;
    const raw = searchParams.get("args");
    let prefill: Record<string, unknown> = {};
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          prefill = parsed as Record<string, unknown>;
        }
      } catch {
        // ignore malformed prefill
      }
    }
    openComposer(tool, prefill);
  }, [searchParams, tools]);

  const openComposer = (tool: ToolRow, prefill?: Record<string, unknown>) => {
    const values: ComposerValues = {};
    for (const f of tool.inputFields) {
      const existing = prefill?.[f.key];
      values[f.key] =
        existing !== undefined
          ? (existing as ComposerValues[string])
          : defaultFor(f);
    }
    setComposerValues(values);
    setComposerTool(tool);
  };

  const runTool = async (tool: ToolRow, values: ComposerValues) => {
    const input = normalizeValues(values);
    setRunningToolId(tool.id);
    try {
      const res = await executeTool({ toolId: tool.id, input });
      setComposerTool(null);
      switch (res.outcome) {
        case "completed":
          toast.success(
            `${tool.name} succeeded${
              res.verificationStatus === "verified"
                ? " — result verified against the live system"
                : res.verificationStatus === "verification_failed"
                  ? " — execution succeeded but verification failed"
                  : ""
            }`,
          );
          break;
        case "awaiting_confirmation":
          setConfirmation({
            actionId: res.actionId,
            toolName: tool.name,
            details: res.confirmation,
          });
          break;
        case "failed":
          toast.error(res.error);
          break;
        case "denied":
          toast.error(res.reason);
          break;
        case "unsupported":
          toast.error(res.reason);
          break;
        case "invalid_input":
          toast.error(res.errors.join(" "));
          break;
        case "invalid_state":
          toast.error(res.reason);
          break;
        case "cancelled":
          toast.info("Action cancelled.");
          break;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Tool execution failed");
    } finally {
      setRunningToolId(null);
    }
  };

  const confirmAction = async () => {
    if (!confirmation) return;
    setConfirming(true);
    try {
      const res = await confirmToolAction({ actionId: confirmation.actionId });
      setConfirmation(null);
      switch (res.outcome) {
        case "completed":
          toast.success(
            res.verificationStatus === "verified"
              ? `${confirmation.toolName} approved, executed and verified.`
              : `${confirmation.toolName} approved and executed.`,
          );
          break;
        case "failed":
          toast.error(res.error);
          break;
        case "invalid_state":
          toast.error(res.reason);
          break;
        case "denied":
          toast.error(res.reason);
          break;
        case "cancelled":
          toast.info("Action cancelled.");
          break;
        default:
          toast.info("Action updated.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not confirm action");
    } finally {
      setConfirming(false);
    }
  };

  const cancelAction = async () => {
    if (!confirmation) return;
    setConfirming(true);
    try {
      const res = await cancelToolAction({ actionId: confirmation.actionId });
      setConfirmation(null);
      switch (res.outcome) {
        case "cancelled":
          toast.info("Action cancelled.");
          break;
        case "invalid_state":
          toast.info(res.reason);
          break;
        case "denied":
          toast.error(res.reason);
          break;
        default:
          toast.info("Action updated.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel action");
    } finally {
      setConfirming(false);
    }
  };

  const stats = useMemo(() => {
    const list = tools ?? [];
    return {
      total: list.length,
      implemented: list.filter((t) => t.implementationStatus === "implemented").length,
      enabled: list.filter((t) => t.enabled).length,
      run: history?.length ?? 0,
    };
  }, [tools, history]);

  const filteredHistory = useMemo(() => {
    const list = history ?? [];
    if (statusFilter === "all") return list;
    return list.filter((r) => r.status === statusFilter);
  }, [history, statusFilter]);

  const disabledReason = (tool: ToolRow): string | null => {
    if (tool.implementationStatus !== "implemented") return "Documented — not implemented yet.";
    if (!tool.canRun) return `Requires ${tool.minRole} role or above.`;
    if (!tool.connected) return "No connected source yet.";
    if (!tool.scopesOk) return "Connected source is missing required OAuth scopes.";
    return null;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Actions & Tools"
        title="What Atlas can do"
        description="Every executable capability is registered server-side and runs through the same authorized pipeline — schema validation, risk policy, confirmation, real execution, verification and audit. Nothing here is simulated."
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/connections")}>
            <Cable className="size-3.5 text-teal-600 dark:text-teal-300" />
            Manage connections
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Wrench} label="Tool catalog" value={stats.total} hint="Registered capabilities" />
        <StatCard
          icon={Zap}
          label="Implemented"
          value={stats.implemented}
          hint="Ready in this deployment"
          accent="text-emerald-600 dark:text-emerald-300"
        />
        <StatCard
          icon={ShieldCheck}
          label="Enabled now"
          value={stats.enabled}
          hint="Connected + authorized"
          accent="text-sky-600 dark:text-sky-300"
        />
        <StatCard
          icon={History}
          label="Actions run"
          value={stats.run}
          hint="All persisted + audited"
          accent="text-violet-600 dark:text-violet-300"
        />
      </div>

      {/* Tool catalog */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Wrench className="size-4 text-teal-600 dark:text-teal-300" />
          Tool catalog
          <span className="font-mono text-[11px] font-normal text-muted-foreground">
            generated from the server registry
          </span>
        </h2>
        {tools === undefined ? (
          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
            Loading tool registry…
          </div>
        ) : tools.length === 0 ? (
          <EmptyPanel
            icon={Wrench}
            title="No tools registered"
            description="The registry is empty — register tools in the backend to surface them here."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {tools.map((tool) => {
              const reason = disabledReason(tool);
              return (
                <Card key={tool.id} className="border-border/70 bg-card/60 shadow-none">
                  <CardContent className="flex h-full flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-5">{tool.name}</p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80">
                          {tool.id} · v{tool.version}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <RiskBadge level={tool.riskLevel} />
                        <ImplBadge status={tool.implementationStatus} />
                      </div>
                    </div>

                    <p className="text-xs leading-5 text-muted-foreground">{tool.description}</p>

                    <div className="flex flex-wrap gap-1.5">
                      {tool.capabilities.map((c) => (
                        <span
                          key={c}
                          className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                        >
                          {c}
                        </span>
                      ))}
                      <span className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-teal-700 dark:text-teal-200">
                        {providerLabel(tool.provider)}
                      </span>
                    </div>

                    <div className="mt-auto space-y-1.5 border-t border-border/50 pt-3">
                      <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
                        {tool.confirmationRequired ? (
                          <>
                            <ShieldAlert className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-300" />
                            <span>
                              <span className="font-medium text-amber-700 dark:text-amber-200">
                                Requires confirmation.
                              </span>{" "}
                              {tool.policyReason}
                            </span>
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-300" />
                            <span>
                              <span className="font-medium text-emerald-700 dark:text-emerald-200">
                                Executes automatically.
                              </span>{" "}
                              {tool.policyReason}
                            </span>
                          </>
                        )}
                      </p>
                      {tool.requiredScopes.length > 0 && (
                        <p className="truncate font-mono text-[10px] text-muted-foreground/60">
                          scope: {tool.requiredScopes[0]}
                          {tool.requiredScopes.length > 1
                            ? ` +${tool.requiredScopes.length - 1}`
                            : ""}
                        </p>
                      )}
                      {reason ? (
                        <p className="text-[11px] font-medium text-muted-foreground">{reason}</p>
                      ) : null}
                    </div>

                    <Button
                      size="sm"
                      className="w-full gap-2"
                      disabled={!tool.enabled || runningToolId !== null}
                      onClick={() => openComposer(tool)}
                    >
                      {runningToolId === tool.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                      {runningToolId === tool.id ? "Running…" : "Run tool"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Action history */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-cyan-600 dark:text-cyan-300" />
            Action history
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              {stats.run} recorded
            </span>
          </h2>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="awaiting_confirmation">Awaiting confirmation</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="succeeded">Succeeded</SelectItem>
              <SelectItem value="verification_failed">Verification failed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {history === undefined ? (
          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
            Loading history…
          </div>
        ) : filteredHistory.length === 0 ? (
          <EmptyPanel
            icon={History}
            title={statusFilter === "all" ? "No actions yet" : "No actions in this state"}
            description={
              statusFilter === "all"
                ? "Run a tool and its full lifecycle — proposal, confirmation, execution, verification, audit — will appear here."
                : "Try a different filter, or run a tool to start a new action."
            }
          />
        ) : (
          <div className="space-y-2">
            {filteredHistory.map((r) => (
              <details
                key={r._id}
                className="group rounded-xl border border-border/60 bg-card/50 transition-colors open:border-border/80"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                  <FileSearch className="size-4 shrink-0 text-teal-600 dark:text-teal-300" />
                  <span className="text-sm font-medium">{r.toolName}</span>
                  <ActionStatusBadge status={r.status} />
                  {r.trigger === "event" ? (
                    <Badge
                      variant="outline"
                      className="font-mono text-[10px] uppercase tracking-wide border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300"
                    >
                      event-triggered
                    </Badge>
                  ) : null}
                  {r.verificationStatus ? (
                    <VerificationBadge status={r.verificationStatus} />
                  ) : null}
                  <span className="text-xs text-muted-foreground">{r.actorName}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/60">
                    {formatDate(r._creationTime)}
                  </span>
                  <ChevronDown className="ml-auto size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="space-y-3 border-t border-border/50 px-4 py-3.5">
                  {r.requestText && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      <span className="font-medium text-foreground">Request: </span>
                      “{r.requestText}”
                    </p>
                  )}
                  {r.explanation && typeof r.explanation === "object" && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {(r.explanation as Record<string, unknown>).summary as string}
                    </p>
                  )}
                  <div className="grid gap-3 text-xs sm:grid-cols-2">
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                      <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        Input (validated)
                      </p>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-foreground/90">
                        {displayValue(r.input)}
                      </pre>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                      <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        Result
                      </p>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-foreground/90">
                        {r.status === "failed" ? (r.error ?? "—") : displayValue(r.result)}
                      </pre>
                    </div>
                  </div>
                  {r.verificationResult ? (
                    <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-2.5 text-xs">
                      <p className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-200">
                        {r.verificationStatus === "verified" ? (
                          <CheckCircle2 className="size-3" />
                        ) : (
                          <XCircle className="size-3" />
                        )}
                        Verification
                      </p>
                      <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-muted-foreground">
                        {displayValue(r.verificationResult)}
                      </pre>
                    </div>
                  ) : null}
                  {r.confirmedByName && (
                    <p className="text-[11px] text-muted-foreground">
                      Confirmed by {r.confirmedByName}
                      {r.confirmedAt ? ` · ${formatDate(r.confirmedAt)}` : ""}
                    </p>
                  )}
                  {r.error && r.status !== "failed" && (
                    <p className="text-[11px] text-muted-foreground">{r.error}</p>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* Schema-driven composer */}
      <Dialog open={composerTool !== null} onOpenChange={(o) => !o && setComposerTool(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radar className="size-4 text-teal-600 dark:text-teal-300" />
              {composerTool?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {composerTool?.id} — arguments are validated against the tool schema before the
              runtime touches any external system.
            </DialogDescription>
          </DialogHeader>
          {composerTool && (
            <div className="space-y-4">
              {composerTool.inputFields.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  This tool takes no arguments.
                </p>
              )}
              {composerTool.inputFields.map((field) => (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={composerValues[field.key]}
                  onChange={(v) =>
                    setComposerValues((prev) => ({ ...prev, [field.key]: v }))
                  }
                />
              ))}
              {composerTool.confirmationRequired && (
                <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-[11px] leading-4 text-amber-700 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  This action will be reviewed before execution: Atlas will show exactly what it
                  will change and ask for explicit approval.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setComposerTool(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-2"
              disabled={
                runningToolId !== null ||
                (composerTool !== null && !requiredFieldsFilled(composerTool, composerValues))
              }
              onClick={() => composerTool && void runTool(composerTool, composerValues)}
            >
              {runningToolId === composerTool?.id ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {composerTool?.confirmationRequired
                ? "Prepare action"
                : "Execute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Descriptive confirmation */}
      <Dialog open={confirmation !== null} onOpenChange={(o) => !o && !confirming && setConfirmation(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-300">
              <ShieldAlert className="size-4" />
              Confirm action — {confirmation?.toolName}
            </DialogTitle>
          </DialogHeader>
          {confirmation && (
            <div className="space-y-3">
              <p className="text-sm leading-6 text-foreground">
                {confirmation.details.message}
              </p>
              <div className="grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-5">
                <p>
                  <span className="font-medium">System:</span>{" "}
                  <span className="text-muted-foreground">{confirmation.details.system}</span>
                </p>
                <p>
                  <span className="font-medium">Account:</span>{" "}
                  <span className="text-muted-foreground">{confirmation.details.account}</span>
                </p>
                <p>
                  <span className="font-medium">What changes:</span>{" "}
                  <span className="text-muted-foreground">{confirmation.details.what}</span>
                </p>
                <div>
                  <p className="font-medium">Consequences:</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                    {confirmation.details.consequences.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
                <p>
                  <span className="font-medium">Reversible:</span>{" "}
                  <span className="text-muted-foreground">
                    {confirmation.details.reversible
                      ? "Yes — the change can be undone"
                      : "No — this change is not directly reversible"}
                  </span>
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => void cancelAction()} disabled={confirming}>
              Cancel action
            </Button>
            <Button
              size="sm"
              className="gap-2"
              onClick={() => void confirmAction()}
              disabled={confirming}
            >
              {confirming ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Approve & run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function requiredFieldsFilled(tool: ToolRow, values: ComposerValues): boolean {
  return tool.inputFields
    .filter((f) => f.required)
    .every((f) => {
      const v = values[f.key];
      if (f.type === "number") return typeof v === "number" && !Number.isNaN(v);
      if (f.type === "boolean") return true;
      return typeof v === "string" && v.trim().length > 0;
    });
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ToolField;
  value: ComposerValues[string];
  onChange: (v: ComposerValues[string]) => void;
}) {
  const label = (
    <span>
      {field.key}
      {field.required && <span className="text-rose-500"> *</span>}
    </span>
  );

  if (field.type === "enum") {
    return (
      <div className="space-y-1">
        <label className="block font-mono text-[11px] text-muted-foreground">{label}</label>
        <Select
          value={typeof value === "string" ? value : ""}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {field.enum?.map((opt) => (
              <SelectItem key={opt} value={opt} className="text-xs">
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldHint field={field} />
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-3.5 accent-teal-600"
        />
        <span className="text-xs">
          <span className="font-mono">{field.key}</span>
          {field.required && <span className="text-rose-500"> *</span>}
          <span className="block text-[11px] text-muted-foreground">{field.description}</span>
        </span>
      </label>
    );
  }

  if (field.type === "number") {
    return (
      <div className="space-y-1">
        <label className="block font-mono text-[11px] text-muted-foreground">{label}</label>
        <Input
          type="number"
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          value={typeof value === "number" ? String(value) : (value as string)}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? "" : Number(raw));
          }}
          className="h-9 text-xs"
        />
        <FieldHint field={field} />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="block font-mono text-[11px] text-muted-foreground">{label}</label>
      {field.longText ? (
        <Textarea
          rows={4}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="text-xs"
        />
      ) : (
        <Input
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 text-xs"
        />
      )}
      <FieldHint field={field} />
    </div>
  );
}

function FieldHint({ field }: { field: ToolField }) {
  const hints: string[] = [];
  if (field.minLength !== undefined || field.maxLength !== undefined) {
    hints.push(`${field.minLength ?? 0}–${field.maxLength ?? "∞"} chars`);
  }
  if (field.min !== undefined || field.max !== undefined) {
    hints.push(`${field.min ?? "−∞"}–${field.max ?? "∞"}`);
  }
  if (hints.length === 0) return null;
  return <p className="font-mono text-[10px] text-muted-foreground/60">{field.description} — {hints.join(", ")}</p>;
}
