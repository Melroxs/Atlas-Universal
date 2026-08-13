import { api } from "@/lib/api";
import type { Id } from "@/lib/data-model";
import {
  ApprovalStatusBadge,
  EmptyPanel,
  PageHeader,
  RiskBadge,
  StatCard,
  WorkflowStatusBadge,
  formatDate,
} from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useMutation, useQuery } from "@/hooks/use-supabase";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock,
  GitBranch,
  Hourglass,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Timer,
  UserCheck,
  Workflow as WorkflowIcon,
  XCircle,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types (mirror of the server surface — nothing hardcoded in the UI)
// ---------------------------------------------------------------------------

interface WorkflowDefRow {
  definition: {
    id: string;
    name: string;
    description: string;
    version: string;
    industry: string;
    status: string;
    trigger: { eventTypes: string[]; connector?: string };
    steps: Array<{ id: string; type: string; next?: string }>;
    policies: {
      riskLevel: string;
      requiresApproval: boolean;
      allowedTools?: string[];
      blockedTools?: string[];
      maxActions?: number;
    };
    requiredConnectors: string[];
    requiredTools: string[];
    timeoutMs: number;
    retryPolicy: { maxAttempts: number; baseMs: number };
    approvalRole?: string;
  };
  settings: {
    workflowId: string;
    enabled: boolean;
    approvalRoleOverride?: string | null;
    maxActionsOverride?: number | null;
  } | null;
  active: number;
  completed: number;
  failed: number;
  total: number;
}

interface StatsResult {
  total: number;
  byStatus: Record<string, number>;
  active: number;
  completed: number;
  failed: number;
  pendingApprovals: number;
}

interface InstanceRow {
  _id: Id<"workflowInstances">;
  definitionId: string;
  definitionName: string;
  triggerLabel: string | null;
  status: string;
  currentStepId: string;
  sourceResourceId: string | null;
  resourceName: string | null;
  failureReason: string | null;
  errorClass: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface ApprovalRow {
  _id: Id<"workflowApprovals">;
  title: string;
  description: string;
  targetResource: string | null;
  expectedConsequences: string | null;
  reversibility: string | null;
  affectedSystem: string | null;
  proposedAction: {
    toolId: string;
    toolName?: string;
    args?: Record<string, unknown>;
  } | null;
  requestedRole: string;
  status: string;
  expiresAt: number | null;
  instanceStatus: string | null;
  workflowName: string;
  createdAt: number;
}

const MANAGER_ROLES = ["owner", "admin", "manager"] as const;

const STEP_TYPE_LABELS: Record<string, string> = {
  condition: "Condition",
  retrieve: "Retrieve evidence",
  decision: "Decision",
  action: "Tool action",
  approval: "Human approval",
  wait: "Wait",
  notify: "Notify",
  update: "Update Atlas state",
  complete: "Complete",
};

export default function Workflows() {
  const navigate = useNavigate();
  const defs = useQuery(api.workflows.listWorkflowDefinitions);
  const stats = useQuery(api.workflows.workflowStats);
  const instances = useQuery(api.workflows.listWorkflowInstances, {});
  const approvals = useQuery(api.workflows.listWorkflowApprovals, {
    pendingOnly: true,
  });
  const workspace = useQuery(api.tenants.getMyWorkspace);

  const setSetting = useMutation(api.workflows.setWorkflowSetting);
  const decide = useMutation(api.workflows.decideWorkflowApproval);
  const cancelInstance = useMutation(api.workflows.cancelWorkflowInstance);
  const retryInstance = useMutation(api.workflows.retryWorkflowInstance);

  const [busyWorkflow, setBusyWorkflow] = useState<string | null>(null);
  const [busyApproval, setBusyApproval] = useState<Id<"workflowApprovals"> | null>(null);
  const [busyInstance, setBusyInstance] = useState<Id<"workflowInstances"> | null>(null);

  const isManager = MANAGER_ROLES.includes(
    workspace?.membership?.role as (typeof MANAGER_ROLES)[number],
  );

  const statValues = useMemo(() => {
    const s = stats as StatsResult | undefined;
    return {
      total: s?.total ?? 0,
      active: s?.active ?? 0,
      completed: s?.completed ?? 0,
      failed: s?.failed ?? 0,
      pendingApprovals: s?.pendingApprovals ?? 0,
    };
  }, [stats]);

  const handleToggle = async (row: WorkflowDefRow, enabled: boolean) => {
    if (!isManager) {
      toast.error("Only managers and above can configure workflows.");
      return;
    }
    setBusyWorkflow(row.definition.id);
    try {
      await setSetting({
        workflowId: row.definition.id,
        enabled,
      });
      toast.success(
        enabled
          ? `"${row.definition.name}" is now active.`
          : `"${row.definition.name}" is now paused.`,
      );
    } catch {
      toast.error("Only managers and above can configure workflows.");
    } finally {
      setBusyWorkflow(null);
    }
  };

  const handleDecide = async (
    approvalId: Id<"workflowApprovals">,
    decision: "approve" | "reject",
  ) => {
    setBusyApproval(approvalId);
    try {
      const res = await decide({ approvalId, decision });
      if (!res.ok) toast.error(res.reason ?? "Could not decide the request.");
      else
        toast.success(
          decision === "approve"
            ? "Approved — the workflow will continue."
            : "Rejected — the workflow was stopped.",
        );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not decide the request.");
    } finally {
      setBusyApproval(null);
    }
  };

  const handleCancel = async (id: Id<"workflowInstances">) => {
    setBusyInstance(id);
    try {
      const res = await cancelInstance({ instanceId: id });
      if (!res.ok) toast.error(res.reason ?? "Could not cancel the workflow.");
      else toast.success("Workflow cancelled.");
    } catch {
      toast.error("Only managers and above can cancel workflows.");
    } finally {
      setBusyInstance(null);
    }
  };

  const handleRetry = async (id: Id<"workflowInstances">) => {
    setBusyInstance(id);
    try {
      const res = await retryInstance({ instanceId: id });
      if (!res.ok) toast.error(res.reason ?? "Could not retry the workflow.");
      else toast.success("Workflow resumed.");
    } catch {
      toast.error("Only managers and above can retry workflows.");
    } finally {
      setBusyInstance(null);
    }
  };

  const defRows = (defs as WorkflowDefRow[] | undefined) ?? [];
  const instRows = (instances as InstanceRow[] | undefined) ?? [];
  const approvalRows = (approvals as ApprovalRow[] | undefined) ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Closed-loop automation"
        title="Workflows"
        description="Event → Workflow → Understand → Decide → Act → Verify → Continue. Atlas orchestrates the existing tool runtime, knowledge, approvals and audit — one engine, no second execution path."
        actions={
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-teal-400/30 bg-teal-400/10 text-teal-600 dark:text-teal-300">
            <WorkflowIcon className="mr-1 size-3" />
            durable engine
          </Badge>
        }
      />

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Activity} label="Total runs" value={statValues.total} hint="All instances" />
        <StatCard
          icon={Hourglass}
          label="Active"
          value={statValues.active}
          hint="running / waiting / approval"
          accent="text-indigo-600 dark:text-indigo-300"
        />
        <StatCard
          icon={CheckCircle2}
          label="Completed"
          value={statValues.completed}
          hint="closed loops"
          accent="text-emerald-600 dark:text-emerald-300"
        />
        <StatCard
          icon={statValues.failed > 0 ? AlertTriangle : ShieldCheck}
          label="Failed"
          value={`${statValues.failed} · ${statValues.pendingApprovals} awaiting approval`}
          hint="failed / timed out · pending decisions"
          accent={statValues.failed > 0 ? "text-rose-600 dark:text-rose-300" : "text-teal-600 dark:text-teal-300"}
        />
      </div>

      {/* Pending approvals */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <UserCheck className="size-4 text-orange-600 dark:text-orange-300" />
            Approval requests
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              role-gated · expires {48}h
            </span>
            {!isManager && (
              <span className="flex items-center gap-1 font-mono text-[10px] font-normal text-muted-foreground">
                <Lock className="size-3" /> managers only
              </span>
            )}
          </h2>
        </div>
        {approvals === undefined ? (
          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
            Loading approvals…
          </div>
        ) : approvalRows.length === 0 ? (
          <EmptyPanel
            icon={UserCheck}
            title="No pending approvals"
            description="When a workflow needs a human decision — for example marking a changed document as reviewed — the request appears here with the exact action, affected system and consequences."
          />
        ) : (
          <div className="space-y-2">
            {approvalRows.map((a) => (
              <Card key={a._id} className="border-orange-400/20 bg-card/50">
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <ApprovalStatusBadge status={a.status} />
                    <span className="text-sm font-medium">{a.title}</span>
                    <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-orange-400/30 bg-orange-400/10 text-orange-600 dark:text-orange-300">
                      {a.requestedRole}+
                    </Badge>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                      {formatDate(a.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{a.description}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    {a.proposedAction?.toolName && (
                      <span className="font-mono text-[11px] text-violet-600 dark:text-violet-300">
                        {a.proposedAction.toolName}
                      </span>
                    )}
                    {a.affectedSystem && <span>system: {a.affectedSystem}</span>}
                    {a.targetResource && <span>resource: {a.targetResource}</span>}
                    <span className="text-muted-foreground/70">workflow: {a.workflowName}</span>
                  </div>
                  {a.expectedConsequences && (
                    <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-300" />
                      {a.expectedConsequences}
                    </p>
                  )}
                  {a.reversibility && (
                    <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
                      <RefreshCw className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-300" />
                      {a.reversibility}
                    </p>
                  )}
                  <div className="flex items-center gap-2 border-t border-border/50 pt-3">
                    {isManager ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-xs"
                          disabled={busyApproval === a._id}
                          onClick={() => handleDecide(a._id, "reject")}
                        >
                          <ThumbsDown className="size-3" />
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          disabled={busyApproval === a._id}
                          onClick={() => handleDecide(a._id, "approve")}
                        >
                          <ThumbsUp className="size-3" />
                          Approve
                        </Button>
                      </>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Only {a.requestedRole}s and above can decide this request.
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Definitions — server-driven */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="size-4 text-teal-600 dark:text-teal-300" />
            Workflow definitions
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              {defRows.length} registered · server-driven
            </span>
          </h2>
        </div>
        {defs === undefined ? (
          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
            Loading workflows…
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {defRows.map((row) => {
              const def = row.definition;
              const enabled = row.settings?.enabled ?? true;
              return (
                <Card key={def.id} className="border-border/70 bg-card/50 transition-colors hover:border-teal-400/30">
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{def.name}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {def.description}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <RiskBadge level={def.policies.riskLevel} />
                        <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-muted-foreground/30 text-muted-foreground">
                          v{def.version}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {def.trigger.eventTypes.map((t) => (
                        <Badge key={t} variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-cyan-400/30 bg-cyan-400/10 text-cyan-600 dark:text-cyan-300">
                          {t.replace(/_/g, " ")}
                        </Badge>
                      ))}
                      {def.trigger.connector && (
                        <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-teal-400/30 bg-teal-400/10 text-teal-600 dark:text-teal-300">
                          {def.trigger.connector}
                        </Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                      <span>
                        <span className="font-mono text-[10px] uppercase tracking-wide">Steps</span>{" "}
                        — {def.steps.length}
                      </span>
                      <span>
                        <span className="font-mono text-[10px] uppercase tracking-wide">Tools</span>{" "}
                        — {def.requiredTools.length}
                      </span>
                      <span>
                        <span className="font-mono text-[10px] uppercase tracking-wide">Runs</span>{" "}
                        — {row.total} ({row.active} active)
                      </span>
                      <span>
                        <span className="font-mono text-[10px] uppercase tracking-wide">Outcome</span>{" "}
                        — {row.completed} done · {row.failed} failed
                      </span>
                    </div>

                    <div className="flex items-center gap-2 border-t border-border/50 pt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => navigate(`/dashboard/workflows/${def.id}`)}
                      >
                        Open
                        <ChevronRight className="size-3" />
                      </Button>
                      <label className="ml-auto flex items-center gap-2 text-xs">
                        <Switch
                          checked={enabled}
                          disabled={!isManager || busyWorkflow === def.id}
                          onCheckedChange={(v) => handleToggle(row, v)}
                        />
                        {enabled ? "Active" : "Paused"}
                      </label>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Instances */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="size-4 text-indigo-600 dark:text-indigo-300" />
            Recent instances
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              {instRows.length} shown
            </span>
          </h2>
        </div>
        {instances === undefined ? (
          <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
            Loading instances…
          </div>
        ) : instRows.length === 0 ? (
          <EmptyPanel
            icon={WorkflowIcon}
            title="No workflow runs yet"
            description="Workflows start when Atlas processes a matching event — e.g. a new file appears in the connected Drive. Runs are durable: they survive restarts and resume from the exact step."
          />
        ) : (
          <div className="space-y-2">
            {instRows.map((r) => (
              <button
                key={r._id}
                onClick={() => navigate(`/dashboard/workflows/${r.definitionId}?instance=${r._id}`)}
                className="w-full rounded-xl border border-border/60 bg-card/50 px-4 py-3 text-left transition-colors hover:border-border/80 hover:bg-card"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <WorkflowIcon className="size-4 shrink-0 text-teal-600 dark:text-teal-300" />
                  <span className="text-sm font-medium">{r.definitionName}</span>
                  <WorkflowStatusBadge status={r.status} />
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {r.currentStepId}
                  </span>
                  {r.resourceName && (
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {r.resourceName}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2">
                    {(r.status === "failed" || r.status === "timed_out") && isManager && (
                      <span
                        role="button"
                        tabIndex={0}
                        className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-teal-600 hover:text-teal-500 dark:text-teal-300"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetry(r._id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.stopPropagation();
                            handleRetry(r._id);
                          }
                        }}
                      >
                        <RefreshCw className={`size-3 ${busyInstance === r._id ? "animate-spin" : ""}`} />
                        retry
                      </span>
                    )}
                    {(r.status === "running" ||
                      r.status === "waiting" ||
                      r.status === "awaiting_approval" ||
                      r.status === "paused") &&
                      isManager && (
                        <span
                          role="button"
                          tabIndex={0}
                          className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-rose-600 hover:text-rose-500 dark:text-rose-300"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancel(r._id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              handleCancel(r._id);
                            }
                          }}
                        >
                          <XCircle className="size-3" />
                          cancel
                        </span>
                      )}
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {formatDate(r.startedAt)}
                    </span>
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  </span>
                </div>
                {r.failureReason && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-300">
                    <AlertTriangle className="size-3" />
                    {r.failureReason}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
