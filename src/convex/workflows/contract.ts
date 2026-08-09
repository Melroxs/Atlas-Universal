// ---------------------------------------------------------------------------
// Atlas Universal — Workflow Contract
//
// The typed, versioned representation of a workflow. Definitions are
// declarative data (no code steps, no provider-specific step types) so they
// can be validated, audited and safely orchestrated. The workflow engine is
// an ORCHESTRATOR over existing primitives: events (Phase 5), tools/actions
// (Phase 4), knowledge, approvals, notifications and audit.
//
// PURE module (no Convex runtime) — shared by V8 queries, node executors and
// unit tests.
// ---------------------------------------------------------------------------

import type { RiskLevel } from "../tools/registry";

// ---------------------------------------------------------------------------
// Steps — universal step model (no provider-specific types)
// ---------------------------------------------------------------------------

export type WorkflowStepType =
  | "condition"
  | "retrieve"
  | "decision"
  | "action"
  | "approval"
  | "wait"
  | "notify"
  | "update"
  | "complete";

export type Condition =
  | { op: "and" | "or"; conditions: Condition[] }
  | { op: "not"; condition: Condition }
  | {
      op: "equals" | "contains" | "exists" | "gt" | "gte" | "lt" | "lte";
      path: string;
      value?: unknown;
    };

export type ApprovalRole = "member" | "manager" | "owner";

export interface BaseStep {
  id: string;
  type: WorkflowStepType;
  /** Explicit next step id — overrides sequential order when present. */
  next?: string;
}

export interface ConditionStep extends BaseStep {
  type: "condition";
  condition: Condition;
  then?: string;
  else?: string;
}

export interface RetrieveStep extends BaseStep {
  type: "retrieve";
  /** What to load into context. */
  source: "document_by_resource" | "entities_by_document" | "context";
  /** Context key to store the retrieved evidence under. */
  storeKey: string;
}

export interface DecisionRule {
  if: Condition;
  then: {
    decision: string;
    confidence: number;
    requiresHumanReview: boolean;
    /** Where the workflow continues when this rule fires. */
    nextStepId?: string;
    rationale: string;
  };
}

export interface DecisionStep extends BaseStep {
  type: "decision";
  rules: DecisionRule[];
  defaultNext?: string;
  storeKey: string;
}

export interface ActionArg {
  key: string;
  from: "context" | "literal";
  /** Dot-path into the instance context when from === "context". */
  path?: string;
  value?: unknown;
}

export interface ActionStep extends BaseStep {
  type: "action";
  toolId: string;
  args: ActionArg[];
  /** Context key for the structured result (default "lastAction"). */
  storeKey?: string;
}

export interface ApprovalStep extends BaseStep {
  type: "approval";
  role: ApprovalRole;
  title: string;
  /** Supports {resourceName}, {workflowName} placeholders. */
  description: string;
  consequences?: string;
  reversibility?: string;
  expiresAfterMs?: number;
}

export interface WaitStep extends BaseStep {
  type: "wait";
  mode: "time" | "event";
  /** For time waits — how long to wait from instance start. */
  durationMs?: number;
  /** For event waits — which event type resumes the workflow. */
  eventType?: string;
  /** For event waits — how to correlate the incoming event. */
  correlation?: "resource";
}

export interface NotifyStep extends BaseStep {
  type: "notify";
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  description?: string;
}

export interface UpdateStep extends BaseStep {
  type: "update";
  kind: "patch_document" | "add_assertion";
  documentField?: string;
  value?: unknown;
  assertion?: {
    statement: string;
    classification: "FACT" | "RULE" | "OBSERVATION" | "INFERENCE" | "RECOMMENDATION";
    confidence: number;
  };
}

export interface CompleteStep extends BaseStep {
  type: "complete";
}

export type WorkflowStep =
  | ConditionStep
  | RetrieveStep
  | DecisionStep
  | ActionStep
  | ApprovalStep
  | WaitStep
  | NotifyStep
  | UpdateStep
  | CompleteStep;

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  industry: string;
  status: "active" | "draft" | "deprecated";
  trigger: {
    eventTypes: string[];
    connector?: string;
    conditions?: Condition[];
  };
  steps: WorkflowStep[];
  policies: {
    riskLevel: RiskLevel;
    requiresApproval: boolean;
    allowedTools?: string[];
    blockedTools?: string[];
    maxActions?: number;
  };
  requiredConnectors: string[];
  requiredTools: string[];
  timeoutMs: number;
  retryPolicy: { maxAttempts: number; baseMs: number };
  approvalRole?: ApprovalRole;
  createdBy: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Instance state model
// ---------------------------------------------------------------------------

export const WORKFLOW_STATUSES = [
  "pending",
  "running",
  "waiting",
  "awaiting_approval",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const TERMINAL_STATUSES: WorkflowStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
];

export const RESUMABLE_STATUSES: WorkflowStatus[] = [
  "pending",
  "running",
  "waiting",
  "awaiting_approval",
  "paused",
];

/**
 * Explicit, validated transitions. The client can only request cancel/retry;
 * every other transition happens inside the engine. No arbitrary mutations.
 */
export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  if (from === to) return true;
  switch (from) {
    case "pending":
      return to === "running" || to === "cancelled" || to === "timed_out";
    case "running":
      return (
        to === "waiting" ||
        to === "awaiting_approval" ||
        to === "paused" ||
        to === "completed" ||
        to === "failed" ||
        to === "cancelled" ||
        to === "timed_out"
      );
    case "waiting":
    case "awaiting_approval":
    case "paused":
      return (
        to === "running" ||
        to === "failed" ||
        to === "cancelled" ||
        to === "timed_out"
      );
    case "completed":
    case "failed":
    case "cancelled":
    case "timed_out":
      return false;
  }
}

// ---------------------------------------------------------------------------
// Idempotency — deterministic step execution identity
// ---------------------------------------------------------------------------

export function stepExecutionKey(
  instanceId: string,
  stepId: string,
  attempt: number,
): string {
  return `${instanceId}:${stepId}:${attempt}`;
}

/** Correlation key used to dedupe event waits (loop + duplicate protection). */
export function eventResumeKey(eventType: string, resourceId: string | null): string {
  return `${eventType}:${resourceId ?? "?"}`;
}

// ---------------------------------------------------------------------------
// Safety limits (loop protection + resource bounds)
// ---------------------------------------------------------------------------

export const WORKFLOW_LIMITS = {
  maxStepsPerWorkflow: 30,
  maxActionsPerInstance: 5,
  maxRuntimeMs: 7 * 24 * 60 * 60 * 1000,
  maxConcurrentPerTenant: 25,
  maxRetriesPerStep: 4,
  /** Same workflow + same resource within this window is a loop — skipped. */
  dispatchCooldownMs: 10 * 60 * 1000,
  defaultApprovalExpiryMs: 48 * 60 * 60 * 1000,
} as const;

export function effectiveMaxActions(def: WorkflowDefinition, maxActionsOverride?: number): number {
  return maxActionsOverride ?? def.policies.maxActions ?? WORKFLOW_LIMITS.maxActionsPerInstance;
}

export function effectiveTimeoutMs(def: WorkflowDefinition): number {
  return def.timeoutMs > 0 ? def.timeoutMs : WORKFLOW_LIMITS.maxRuntimeMs;
}

// ---------------------------------------------------------------------------
// Definition validation
// ---------------------------------------------------------------------------

const STEP_TYPES: WorkflowStepType[] = [
  "condition",
  "retrieve",
  "decision",
  "action",
  "approval",
  "wait",
  "notify",
  "update",
  "complete",
];

export type DefinitionValidation =
  | { ok: true }
  | { ok: false; errors: string[] };

/** Validate a workflow definition before it can be registered or dispatched. */
export function validateWorkflowDefinition(
  def: WorkflowDefinition,
  opts: {
    hasTool: (toolId: string) => boolean;
    hasConnector: (connectorId: string) => boolean;
  },
): DefinitionValidation {
  const errors: string[] = [];
  if (!def.id || !def.name || !def.description) errors.push("Workflow needs id, name and description.");
  if (!def.version) errors.push("Workflow needs a version.");
  if (def.trigger.eventTypes.length === 0) errors.push("Workflow needs at least one trigger event type.");
  if (def.steps.length === 0) errors.push("Workflow has no steps.");
  const ids = def.steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) errors.push("Step ids must be unique.");
  for (const s of def.steps) {
    if (!STEP_TYPES.includes(s.type)) errors.push(`Step "${s.id}" has an unknown type "${s.type}".`);
    if (s.type === "action") {
      const a = s as ActionStep;
      if (!opts.hasTool(a.toolId)) errors.push(`Step "${s.id}" references missing tool "${a.toolId}".`);
      if (a.args.length === 0) errors.push(`Step "${s.id}" declares no args.`);
    }
    if (s.type === "approval") {
      const role = (s as ApprovalStep).role;
      if (role !== "member" && role !== "manager" && role !== "owner") {
        errors.push(`Step "${s.id}" has an invalid approval role.`);
      }
    }
    if (s.type === "wait") {
      const w = s as WaitStep;
      if (w.mode === "time" && !w.durationMs) errors.push(`Step "${s.id}" needs durationMs for a time wait.`);
      if (w.mode === "event" && !w.eventType) errors.push(`Step "${s.id}" needs eventType for an event wait.`);
    }
  }
  for (const c of def.requiredConnectors) {
    if (!opts.hasConnector(c)) errors.push(`Required connector "${c}" is not registered.`);
  }
  for (const t of def.requiredTools) {
    if (!opts.hasTool(t)) errors.push(`Required tool "${t}" is not registered.`);
  }
  const last = def.steps[def.steps.length - 1];
  if (last && last.type !== "complete") {
    errors.push("The final step must be a complete step.");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

/** Sanitize workflow context — never store credentials or raw provider bodies. */
export function sanitizeWorkflowContext(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.map((x) => sanitizeWorkflowContext(x, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /token|secret|authorization|api[_-]?key|password/i.test(k)
        ? "[redacted]"
        : sanitizeWorkflowContext(val, depth + 1);
    }
    return out;
  }
  return value;
}

/** Dot-path lookup into context (e.g. "triggerEvent.payload.fileId"). */
export function getContextPath(
  context: Record<string, unknown>,
  path: string,
): unknown {
  if (!path) return undefined;
  let cur: unknown = context;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
