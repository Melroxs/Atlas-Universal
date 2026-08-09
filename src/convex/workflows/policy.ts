// ---------------------------------------------------------------------------
// Workflow policy + safety enforcement.
//
// The engine NEVER bypasses the existing action policy. Every action step is
// resolved here: READ may run automatically, LOW_WRITE needs approval unless
// a tenant policy explicitly allows it, HIGH_WRITE and IRREVERSIBLE always
// need approval — and the Phase 4 runtime still enforces connector, scope and
// verification. A workflow definition can never override a stricter tenant
// safety setting.
//
// PURE module.
// ---------------------------------------------------------------------------

import type { RiskLevel } from "../tools/registry";
import { WORKFLOW_LIMITS, type WorkflowDefinition, type WorkflowStatus } from "./contract";

export interface WorkflowSettingsLike {
  enabled: boolean;
  approvalRoleOverride?: string | null;
  maxActionsOverride?: number | null;
}

export interface TenantRestrictionsLike {
  allowedWorkflows?: string[];
  blockedWorkflows?: string[];
  allowedTools?: string[];
  blockedTools?: string[];
  maxConcurrent?: number;
}

export interface WorkflowEnabled {
  enabled: boolean;
  reason: string;
}

/** Definitions must be active, and the tenant must not have disabled/blocked them. */
export function resolveWorkflowEnabled(
  def: WorkflowDefinition,
  settings: WorkflowSettingsLike | null,
  restrictions?: TenantRestrictionsLike | null,
): WorkflowEnabled {
  if (def.status !== "active") {
    return { enabled: false, reason: `Workflow is ${def.status}.` };
  }
  if (restrictions?.blockedWorkflows?.includes(def.id)) {
    return { enabled: false, reason: "Workflow is blocked by tenant policy." };
  }
  if (restrictions?.allowedWorkflows && !restrictions.allowedWorkflows.includes(def.id)) {
    return { enabled: false, reason: "Workflow is not in the tenant's allowed list." };
  }
  if (settings && !settings.enabled) {
    return { enabled: false, reason: "Workflow is disabled in this workspace." };
  }
  return { enabled: true, reason: "Eligible." };
}

/**
 * Loop protection at dispatch time. The same workflow for the same resource
 * within the cooldown window is skipped — this breaks update→event→update
 * loops honestly, without inventing provenance.
 */
export function shouldDispatch(opts: {
  def: WorkflowDefinition;
  settings: WorkflowSettingsLike | null;
  restrictions?: TenantRestrictionsLike | null;
  lastInstanceStartedAt?: number | null;
  now: number;
  cooldownMs?: number;
}): { ok: boolean; reason?: string } {
  const enabled = resolveWorkflowEnabled(opts.def, opts.settings, opts.restrictions);
  if (!enabled.enabled) return { ok: false, reason: enabled.reason };
  const cooldown = opts.cooldownMs ?? WORKFLOW_LIMITS.dispatchCooldownMs;
  if (opts.lastInstanceStartedAt && opts.now - opts.lastInstanceStartedAt < cooldown) {
    return {
      ok: false,
      reason: `A run of this workflow for the same resource started recently (loop protection).`,
    };
  }
  return { ok: true };
}

/**
 * Authorize a workflow action. The workflow engine cannot elevate its own
 * permissions: risk always wins, and approval (from the workflow's approval
 * step) is required wherever the risk ladder demands it.
 */
export function resolveActionExecution(opts: {
  riskLevel: RiskLevel;
  toolId: string;
  blockedTools?: string[];
  allowedTools?: string[];
  /** An explicit approval was granted for THIS step. */
  approvalGrantedForStep: boolean;
  /** The tenant explicitly allows automatic low-risk writes for workflows. */
  autoLowRiskWrite: boolean;
}): { mode: "execute" | "request_approval" | "blocked"; reason: string } {
  const { riskLevel, toolId, blockedTools, allowedTools, approvalGrantedForStep, autoLowRiskWrite } = opts;
  if (blockedTools?.includes(toolId)) {
    return { mode: "blocked", reason: `Tool "${toolId}" is blocked by policy.` };
  }
  if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(toolId)) {
    return { mode: "blocked", reason: `Tool "${toolId}" is not in the allowed list.` };
  }
  if (riskLevel === "READ") {
    return { mode: "execute", reason: "Read-only — safe to run automatically." };
  }
  if (approvalGrantedForStep) {
    return { mode: "execute", reason: "Approved by the required role for this workflow step." };
  }
  if (riskLevel === "LOW_WRITE" && autoLowRiskWrite) {
    return { mode: "execute", reason: "Low-risk write permitted by tenant workflow policy." };
  }
  if (riskLevel === "LOW_WRITE") {
    return { mode: "request_approval", reason: "Low-risk write — approval required unless auto-writes are enabled." };
  }
  return {
    mode: "request_approval",
    reason: "High-impact change — human approval is always required.",
  };
}

export interface LimitsCheck {
  ok: true;
}
export interface LimitsFailure {
  ok: false;
  /** Which terminal state to enter. */
  failure: "timed_out" | "failed";
  reason: string;
}
export type LimitsResult = LimitsCheck | LimitsFailure;

/** Resource + loop-protection limits, checked before every step. */
export function checkWorkflowLimits(opts: {
  def: WorkflowDefinition;
  startedAt: number;
  now: number;
  actionCount: number;
  completedSteps: number;
  maxSteps?: number;
  maxActions?: number;
}): LimitsResult {
  const { def, startedAt, now, actionCount, completedSteps } = opts;
  const timeout = def.timeoutMs > 0 ? def.timeoutMs : WORKFLOW_LIMITS.maxRuntimeMs;
  if (now - startedAt > timeout) {
    return { ok: false, failure: "timed_out", reason: `Exceeded the ${Math.round(timeout / 3600000)}h runtime limit.` };
  }
  const maxActions = opts.maxActions ?? def.policies.maxActions ?? WORKFLOW_LIMITS.maxActionsPerInstance;
  if (actionCount >= maxActions) {
    return {
      ok: false,
      failure: "failed",
      reason: `Action limit reached (${maxActions}) — possible loop, stopping safely.`,
    };
  }
  const maxSteps = opts.maxSteps ?? WORKFLOW_LIMITS.maxStepsPerWorkflow;
  if (completedSteps > maxSteps) {
    return { ok: false, failure: "failed", reason: `Step count exceeded the ${maxSteps} safety limit.` };
  }
  return { ok: true };
}

/** Role gate: who may decide a workflow approval. */
export function roleSatisfies(role: string | undefined, required: string): boolean {
  const order: Record<string, number> = { viewer: 0, member: 1, manager: 2, owner: 3 };
  return (order[role ?? ""] ?? 0) >= (order[required] ?? 3);
}

export function isTerminalStatus(status: WorkflowStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "timed_out";
}
