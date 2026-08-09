import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ApprovalStatusBadge,
  EmptyPanel,
  PageHeader,
  RiskBadge,
  StepStatusBadge,
  WorkflowStatusBadge,
  formatDate,
} from "@/components/atlas-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMutation, useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  GitBranch,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  UserCheck,
  Workflow as WorkflowIcon,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

const MANAGER_ROLES = ["owner", "admin", "manager"] as const;

const STEP_TYPE_LABELS: Record<string, { label: string; icon: string }> = {
  condition: { label: "Condition", icon: "⇄" },
  retrieve: { label: "Retrieve evidence", icon: "⬇" },
  decision: { label: "Decision", icon: "◆" },
  action: { label: "Tool action", icon: "⚡" },
  approval: { label: "Human approval", icon: "✋" },
  wait: { label: "Wait", icon: "⏳" },
  notify: { label: "Notify", icon: "🔔" },
  update: { label: "Update Atlas state", icon: "✎" },
  complete: { label: "Complete", icon: "✓" },
};

interface DefDetail {
  definition: {
    id: string;
    name: string;
    description: string;
    version: string;
    industry: string;
    status: string;
    trigger: { eventTypes: string[]; connector?: string };
    steps: Array<{
      id: string;
      type: string;
      next?: string;
      toolId?: string;
      condition?: unknown;
      role?: string;
      mode?: string;
    }>;
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
    enabled: boolean;
    approvalRoleOverride?: string | null;
    maxActionsOverride?: number | null;
  } | null;
  instances: Array<{
    _id: Id<"workflowInstances">;
    status: string;
    currentStepId: string;
    triggerEventType?: string | null;
    sourceResourceId?: string | null;
    failureReason?: string | null;
    errorClass?: string | null;
    startedAt: number;
    completedAt?: number | null;
    actionCount: number;
  }>;
}

interface InstanceStep {
  _id: Id<"workflowSteps">;
  stepId: string;
  stepType: string;
  attempt: number;
  status: string;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  actionId?: Id<"toolActions"> | null;
  approvalId?: Id<"workflowApprovals"> | null;
  evidenceReferences?: unknown;
}

interface InstanceApproval {
  _id: Id<"workflowApprovals">;
  stepId: string;
  title: string;
  description: string;
  targetResource?: string | null;
  expectedConsequences?: string | null;
  reversibility?: string | null;
  proposedAction?: { toolId: string; toolName?: string } | null;
  requestedRole: string;
  status: string;
  expiresAt?: number | null;
  createdAt: number;
}

interface InstanceDetail {
  instance: {
    _id: Id<"workflowInstances">;
    definitionId: string;
    status: string;
    currentStepId: string;
    context: Record<string, unknown>;
    evidenceReferences?: unknown;
    actionReferences?: string[] | null;
    approvalReferences?: string[] | null;
    waitConditions?: unknown;
    completedStepIds?: string[] | null;
    retryCounts?: Record<string, number> | null;
    actionCount: number;
    failureReason?: string | null;
    errorClass?: string | null;
    triggerEventType?: string | null;
    sourceResourceId?: string | null;
    startedAt: number;
    updatedAt: number;
    completedAt?: number | null;
  };
  definition: DefDetail["definition"] | null;
  steps: InstanceStep[];
  approvals: InstanceApproval[];
}

function StepGlyph({ type }: { type: string }) {
  const meta = STEP_TYPE_LABELS[type];
  return (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/40 text-[11px] text-muted-foreground">
      {meta?.icon ?? "·"}
    </div>
  );
}

export default function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const instanceParam = searchParams.get("instance");

  const detail = useQuery(api.workflows.api.getWorkflowDetail, { workflowId: id ?? "" });
  const instanceDetail = useQuery(
    api.workflows.api.getWorkflowInstanceDetail,
    instanceParam ? { instanceId: instanceParam as Id<"workflowInstances"> } : "skip",
  ) as unknown as InstanceDetail | undefined;
  const workspace = useQuery(api.tenants.getMyWorkspace);

  const decide = useMutation(api.workflows.api.decideWorkflowApproval);
  const cancelInstance = useMutation(api.workflows.api.cancelWorkflowInstance);
  const retryInstance = useMutation(api.workflows.api.retryWorkflowInstance);

  const [busyApproval, setBusyApproval] = useState<Id<"workflowApprovals"> | null>(null);
  const [busyInstance, setBusyInstance] = useState<Id<"workflowInstances"> | null>(null);

  const isManager = MANAGER_ROLES.includes(
    workspace?.membership?.role as (typeof MANAGER_ROLES)[number],
  );

  if (detail === undefined) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
          Loading workflow…
        </div>
      </div>
    );
  }

  const data = detail as unknown as DefDetail;
  if (!data.definition) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <EmptyPanel
          icon={WorkflowIcon}
          title="Workflow not found"
          description="The workflow definition is no longer registered."
          action={
            <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/workflows")}>
              <ArrowLeft className="size-3" /> Back to workflows
            </Button>
          }
        />
      </div>
    );
  }

  const def = data.definition;
  const enabled = data.settings?.enabled ?? true;
  const selectedId = instanceParam as Id<"workflowInstances"> | null;
  const inst = instanceDetail?.instance;

  const handleDecide = async (approvalId: Id<"workflowApprovals">, decision: "approve" | "reject") => {
    setBusyApproval(approvalId);
    try {
      const res = await decide({ approvalId, decision });
      if (!res.ok) toast.error(res.reason ?? "Could not decide the request.");
      else toast.success(decision === "approve" ? "Approved — workflow continues." : "Rejected — workflow stopped.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not decide the request.");
    } finally {
      setBusyApproval(null);
    }
  };

  const handleCancel = async (instanceId: Id<"workflowInstances">) => {
    setBusyInstance(instanceId);
    try {
      const res = await cancelInstance({ instanceId });
      if (!res.ok) toast.error(res.reason ?? "Could not cancel the workflow.");
      else toast.success("Workflow cancelled.");
    } catch {
      toast.error("Only managers and above can cancel workflows.");
    } finally {
      setBusyInstance(null);
    }
  };

  const handleRetry = async (instanceId: Id<"workflowInstances">) => {
    setBusyInstance(instanceId);
    try {
      const res = await retryInstance({ instanceId });
      if (!res.ok) toast.error(res.reason ?? "Could not retry the workflow.");
      else toast.success("Workflow resumed.");
    } catch {
      toast.error("Only managers and above can retry workflows.");
    } finally {
      setBusyInstance(null);
    }
  };

  const selectInstance = (instanceId: Id<"workflowInstances">) => {
    setSearchParams({ instance: instanceId });
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Workflow definition"
        title={def.name}
        description={def.description}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => navigate("/dashboard/workflows")}
            >
              <ArrowLeft className="size-3" />
              All workflows
            </Button>
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-teal-400/30 bg-teal-400/10 text-teal-600 dark:text-teal-300">
              <WorkflowIcon className="mr-1 size-3" />
              v{def.version}
            </Badge>
            {enabled ? (
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-emerald-400/30 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300">
                active
              </Badge>
            ) : (
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-muted-foreground/30 bg-muted text-muted-foreground">
                paused
              </Badge>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Definition facts */}
        <Card className="border-border/70 bg-card/50 lg:col-span-1">
          <CardContent className="flex flex-col gap-4 p-4">
            <div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Trigger</p>
              <div className="flex flex-wrap gap-1.5">
                {def.trigger.eventTypes.map((t) => (
                  <Badge key={t} variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-cyan-400/30 bg-cyan-400/10 text-cyan-600 dark:text-cyan-300">
                    {t.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Policy</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <RiskBadge level={def.policies.riskLevel} />
                <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-violet-400/30 bg-violet-400/10 text-violet-600 dark:text-violet-300">
                  {def.policies.requiresApproval ? "approval required" : "no approval"}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-muted-foreground/30 text-muted-foreground">
                  ≤ {def.policies.maxActions ?? 5} actions
                </Badge>
              </div>
            </div>
            <div>
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Required systems</p>
              <div className="flex flex-wrap gap-1.5">
                {def.requiredConnectors.map((c) => (
                  <Badge key={c} variant="outline" className="font-mono text-[10px] uppercase tracking-wide border-teal-400/30 bg-teal-400/10 text-teal-600 dark:text-teal-300">
                    {c}
                  </Badge>
                ))}
                {def.requiredTools.map((t) => (
                  <Badge key={t} variant="outline" className="font-mono text-[10px]">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Clock className="size-3" />
                timeout {Math.round(def.timeoutMs / 3600000)}h
              </span>
              <span className="flex items-center gap-1.5">
                <RefreshCw className="size-3" />
                {def.retryPolicy.maxAttempts} retries
              </span>
            </div>
            {def.approvalRole && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Lock className="size-3" />
                Approval role: {def.approvalRole}+
              </p>
            )}
          </CardContent>
        </Card>

        {/* Step sequence */}
        <Card className="border-border/70 bg-card/50 lg:col-span-2">
          <CardContent className="p-4">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Step sequence
            </p>
            <div className="flex flex-col">
              {def.steps.map((step, i) => {
                const meta = STEP_TYPE_LABELS[step.type];
                return (
                  <div key={step.id} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <StepGlyph type={step.type} />
                      {i < def.steps.length - 1 && (
                        <div className="w-px flex-1 bg-border/60" />
                      )}
                    </div>
                    <div className="pb-4">
                      <p className="text-sm font-medium">
                        {meta?.label ?? step.type}
                        {step.type === "action" && step.toolId && (
                          <span className="ml-2 font-mono text-[10px] text-violet-600 dark:text-violet-300">
                            {step.toolId}
                          </span>
                        )}
                        {step.type === "approval" && step.role && (
                          <span className="ml-2 font-mono text-[10px] text-orange-600 dark:text-orange-300">
                            {step.role}+
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                        {step.id}
                        {step.next ? ` → next: ${step.next}` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Instances */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="size-4 text-indigo-600 dark:text-indigo-300" />
            Instances
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              durable · resumable · tenant-scoped
            </span>
          </h2>
        </div>
        {data.instances.length === 0 ? (
          <EmptyPanel
            icon={WorkflowIcon}
            title="No runs yet"
            description={`This workflow starts when Atlas processes a matching event (${def.trigger.eventTypes.join(", ")}).`}
          />
        ) : (
          <div className="space-y-2">
            {data.instances.map((r) => (
              <button
                key={r._id}
                onClick={() => selectInstance(r._id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                  r._id === selectedId
                    ? "border-indigo-400/40 bg-indigo-400/5"
                    : "border-border/60 bg-card/50 hover:border-border/80 hover:bg-card"
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <WorkflowStatusBadge status={r.status} />
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    {r.currentStepId}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.actionCount} action{r.actionCount === 1 ? "" : "s"}
                  </span>
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
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {formatDate(r.startedAt)}
                    </span>
                    <ChevronRight
                      className={`size-3.5 text-muted-foreground transition-transform ${
                        r._id === selectedId ? "rotate-90" : ""
                      }`}
                    />
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

      {/* Selected instance timeline */}
      {selectedId && (
        <InstanceTimeline
          detail={instanceDetail}
          instanceId={selectedId}
          isManager={isManager}
          busyApproval={busyApproval}
          busyInstance={busyInstance}
          onDecide={handleDecide}
          onCancel={handleCancel}
          onRetry={handleRetry}
          onBack={() => setSearchParams({})}
        />
      )}
    </div>
  );
}

function InstanceTimeline({
  detail,
  instanceId,
  isManager,
  busyApproval,
  busyInstance,
  onDecide,
  onCancel,
  onRetry,
  onBack,
}: {
  detail: InstanceDetail | undefined;
  instanceId: Id<"workflowInstances">;
  isManager: boolean;
  busyApproval: Id<"workflowApprovals"> | null;
  busyInstance: Id<"workflowInstances"> | null;
  onDecide: (approvalId: Id<"workflowApprovals">, decision: "approve" | "reject") => void;
  onCancel: (instanceId: Id<"workflowInstances">) => void;
  onRetry: (instanceId: Id<"workflowInstances">) => void;
  onBack: () => void;
}) {
  if (detail === undefined) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-teal-600 dark:text-teal-300" />
        Loading instance timeline…
      </div>
    );
  }
  const inst = detail.instance;
  const canCancel =
    inst.status === "running" ||
    inst.status === "waiting" ||
    inst.status === "awaiting_approval" ||
    inst.status === "paused" ||
    inst.status === "pending";
  const canRetry = inst.status === "failed" || inst.status === "timed_out";
  const waitConditions = inst.waitConditions as
    | { kind?: string; eventType?: string; until?: number }
    | null
    | undefined;
  const trigger = inst.context?.triggerEvent as
    | { eventType?: string; sourceResourceId?: string; occurredAt?: number; payload?: Record<string, unknown> }
    | undefined;
  const decision = inst.context?.decision as
    | { decision?: string; confidence?: number; rationale?: string; requiresHumanReview?: boolean }
    | undefined;

  return (
    <Card className="border-indigo-400/20 bg-card/60">
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <WorkflowIcon className="size-4 text-indigo-600 dark:text-indigo-300" />
            <h3 className="text-sm font-semibold">Execution timeline</h3>
            <WorkflowStatusBadge status={inst.status} />
            <span className="font-mono text-[10px] text-muted-foreground/60">{String(instanceId)}</span>
          </div>
          <div className="flex items-center gap-2">
            {canRetry && isManager && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                disabled={busyInstance === instanceId}
                onClick={() => onRetry(instanceId)}
              >
                <RefreshCw className={`size-3 ${busyInstance === instanceId ? "animate-spin" : ""}`} />
                Retry
              </Button>
            )}
            {canCancel && isManager && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs text-rose-600 dark:text-rose-300"
                disabled={busyInstance === instanceId}
                onClick={() => onCancel(instanceId)}
              >
                <XCircle className="size-3" />
                Cancel
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onBack}>
              Close
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Trigger</p>
            <p className="text-xs">
              {trigger?.eventType ?? inst.triggerEventType ?? "—"}
              {trigger?.sourceResourceId && (
                <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                  {trigger.sourceResourceId}
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Wait state</p>
            {inst.status === "waiting" && waitConditions ? (
              <p className="text-xs text-amber-600 dark:text-amber-300">
                {waitConditions.kind === "time"
                  ? `until ${formatDate(waitConditions.until)}`
                  : waitConditions.kind === "event"
                    ? `for ${waitConditions.eventType ?? "a matching event"}`
                    : inst.status}
              </p>
            ) : inst.status === "awaiting_approval" ? (
              <p className="text-xs text-orange-600 dark:text-orange-300">waiting for a human decision</p>
            ) : (
              <p className="text-xs text-muted-foreground">{inst.status}</p>
            )}
          </div>
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Decision</p>
            {decision ? (
              <p className="text-xs">
                <span className="font-mono text-[11px] text-violet-600 dark:text-violet-300">
                  {decision.decision}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {Math.round((decision.confidence ?? 0) * 100)}%
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">—</p>
            )}
            {inst.failureReason && (
              <p className="mt-1 flex items-start gap-1.5 text-[11px] text-rose-600 dark:text-rose-300">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {inst.failureReason}
              </p>
            )}
          </div>
        </div>

        {/* Steps timeline */}
        <div className="flex flex-col">
          {detail.steps.map((step) => {
            const meta = STEP_TYPE_LABELS[step.stepType];
            return (
              <div key={String(step._id)} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <StepGlyph type={step.stepType} />
                  <div className="w-px flex-1 bg-border/60" />
                </div>
                <div className="w-full pb-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{meta?.label ?? step.stepType}</p>
                    <StepStatusBadge status={step.status} />
                    {step.attempt > 1 && (
                      <span className="font-mono text-[10px] text-muted-foreground/60">
                        attempt {step.attempt}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                      {step.completedAt ? formatDate(step.completedAt) : step.startedAt ? formatDate(step.startedAt) : "—"}
                      {step.durationMs != null ? ` · ${step.durationMs}ms` : ""}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{step.stepId}</p>
                  {step.actionId && (
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-violet-600 dark:text-violet-300">
                      <Zap className="size-3" />
                      action {String(step.actionId)}
                    </p>
                  )}
                  {step.approvalId && (
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-orange-600 dark:text-orange-300">
                      <UserCheck className="size-3" />
                      approval {String(step.approvalId)}
                    </p>
                  )}
                  {step.output && Object.keys(step.output).length > 0 && (
                    <p className="mt-1.5 truncate rounded-lg border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                      {JSON.stringify(step.output)}
                    </p>
                  )}
                  {step.error && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-rose-600 dark:text-rose-300">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      {step.error}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Approvals */}
        {detail.approvals.length > 0 && (
          <div className="border-t border-border/50 pt-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Approval requests
            </p>
            <div className="space-y-2">
              {detail.approvals.map((a) => (
                <div key={String(a._id)} className="rounded-xl border border-border/60 bg-card/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ApprovalStatusBadge status={a.status} />
                    <span className="text-sm font-medium">{a.title}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                      {formatDate(a.createdAt)}
                      {a.expiresAt ? ` · expires ${formatDate(a.expiresAt)}` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{a.description}</p>
                  {a.status === "pending" && isManager && (
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 text-xs"
                        disabled={busyApproval === a._id}
                        onClick={() => onDecide(a._id, "reject")}
                      >
                        <ThumbsDown className="size-3" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        disabled={busyApproval === a._id}
                        onClick={() => onDecide(a._id, "approve")}
                      >
                        <ThumbsUp className="size-3" />
                        Approve
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3 shrink-0 text-teal-600 dark:text-teal-300" />
          Every step ran through the shared engine: decisions propose, the Phase 4 action runtime
          authorizes and executes, and the whole path — evidence, decision, approval, action,
          verification — is recorded in the audit log.
        </p>
      </CardContent>
    </Card>
  );
}
