"use node";

// ---------------------------------------------------------------------------
// Universal workflow step executors.
//
// Each step kind is executed here. Executors NEVER call external provider
// APIs directly for actions — the "action" executor routes through the
// Phase 4 tool runtime (policy → execution → verification → audit). Executors
// return a StepResult; the engine authorizes, persists and advances.
// ---------------------------------------------------------------------------

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { TOOL_BY_ID } from "../tools/registry";
import { evaluateRisk } from "../tools/policy";
import { validateToolInput } from "../tools/schema";
import { classifyFailure } from "../events/contract";
import {
  getContextPath,
  WORKFLOW_LIMITS,
  type ActionStep,
  type ApprovalStep,
  type ConditionStep,
  type DecisionStep,
  type NotifyStep,
  type RetrieveStep,
  type UpdateStep,
  type WaitStep,
  type WorkflowDefinition,
  type WorkflowStep,
} from "./contract";
import { evaluateCondition } from "./conditions";
import { evaluateRules } from "./decision";
import { resolveActionExecution, type WorkflowSettingsLike } from "./policy";

export interface WorkflowInstanceLike {
  _id: Id<"workflowInstances">;
  tenantId: Id<"tenants">;
  definitionId: string;
  status: string;
  currentStepId: string;
  context: Record<string, unknown>;
  sourceResourceId?: string | null;
  triggerEventId?: Id<"events"> | null;
  startedAt: number;
  actionCount: number;
  completedStepIds?: string[];
  waitResumeKeys?: string[];
  approvalReferences?: string[];
  actionReferences?: string[];
  retryCounts?: Record<string, number>;
  evidenceReferences?: unknown;
}

export interface WorkflowApprovalLike {
  _id: Id<"workflowApprovals">;
  stepId: string;
  status: string;
  requestedRole: string;
  expiresAt?: number;
}

export interface WorkflowStepLike {
  _id?: Id<"workflowSteps">;
  stepId: string;
  status: string;
  actionId?: Id<"toolActions"> | null;
}

export interface StepExecutorInput {
  ctx: ActionCtx;
  instance: WorkflowInstanceLike;
  step: WorkflowStep;
  def: WorkflowDefinition;
  settings: WorkflowSettingsLike | null;
  approvals: WorkflowApprovalLike[];
  existingStep: WorkflowStepLike | null;
}

export interface StepResult {
  block: boolean;
  blockKind?: "wait_time" | "wait_event" | "approval";
  output?: Record<string, unknown>;
  nextStepId?: string | null;
  error?: string;
  errorClass?: "retryable" | "permanent";
  approvalId?: Id<"workflowApprovals">;
  actionId?: Id<"toolActions">;
  waitUntil?: number;
  waitFor?: { eventType: string; correlation: { resource: boolean } };
  evidence?: unknown;
}

export type StepExecutor = (input: StepExecutorInput) => Promise<StepResult>;

function err(error: string, errorClass: "retryable" | "permanent" = "permanent"): StepResult {
  return { block: false, output: {}, error, errorClass };
}

function ok(output: Record<string, unknown>, extra: Partial<StepResult> = {}): StepResult {
  return { block: false, output, ...extra };
}

function resourceName(instance: WorkflowInstanceLike): string {
  const ctx = instance.context ?? {};
  const trigger = ctx.triggerEvent as Record<string, unknown> | undefined;
  const payload = (trigger?.payload ?? {}) as Record<string, unknown>;
  if (typeof payload.name === "string" && payload.name) return payload.name;
  const doc = ctx.document as Record<string, unknown> | undefined;
  if (doc && typeof doc.title === "string") return doc.title;
  return instance.sourceResourceId ?? "resource";
}

function fillPlaceholders(text: string, instance: WorkflowInstanceLike): string {
  return text
    .replace(/\{resourceName\}/g, resourceName(instance))
    .replace(/\{workflowName\}/g, instance.definitionId);
}

export function sequentialNext(def: WorkflowDefinition, stepId: string): string | null {
  const idx = def.steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return null;
  const next = def.steps[idx + 1];
  return next ? next.id : null;
}

export function approvalGrantedForStep(
  instance: WorkflowInstanceLike,
  stepId: string,
): boolean {
  const granted = instance.context?.approvalGranted as
    | { stepId?: string; approvalId?: string }
    | null
    | undefined;
  return !!granted && granted.stepId === stepId;
}

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

async function conditionExecutor(input: StepExecutorInput): Promise<StepResult> {
  const step = input.step as ConditionStep;
  const result = evaluateCondition(step.condition, input.instance.context ?? {});
  const nextStepId = (result.result ? step.then : step.else) ?? step.next ?? sequentialNext(input.def, step.id);
  return ok({ result: result.result, error: result.error ?? null }, { nextStepId });
}

async function retrieveExecutor(input: StepExecutorInput): Promise<StepResult> {
  const step = input.step as RetrieveStep;
  const { ctx, instance } = input;
  const tenantId = instance.tenantId;

  if (step.source === "document_by_resource") {
    const resourceId =
      instance.sourceResourceId ??
      (getContextPath(instance.context ?? {}, "triggerEvent.sourceResourceId") as string | undefined);
    if (!resourceId) {
      return ok({ found: false, storeKey: step.storeKey, note: "No source resource id in context." });
    }
    const doc = await ctx.runQuery(internal.internal.getDocBySource, {
      tenantId,
      sourceId: resourceId,
    });
    if (!doc) {
      return ok({ found: false, storeKey: step.storeKey, note: "Document not ingested yet." });
    }
    const summary = {
      _id: String(doc._id),
      title: doc.title,
      mimeType: doc.mimeType ?? null,
      size: doc.size ?? null,
      classification: doc.classification,
      status: doc.status,
      chunkCount: doc.chunkCount ?? null,
      entityCount: doc.entityCount ?? null,
      summary: doc.summary ?? null,
      externalDeletedAt: doc.externalDeletedAt ?? null,
    };
    return ok(
      { found: true, storeKey: step.storeKey, document: summary },
      {
        evidence: [{ kind: "document", documentId: String(doc._id), title: doc.title }],
      },
    );
  }

  if (step.source === "entities_by_document") {
    const docId = getContextPath(instance.context ?? {}, "document._id") as string | undefined;
    if (!docId) return ok({ found: false, storeKey: step.storeKey, note: "No document in context." });
    const entities = await ctx.runQuery(internal.internal.listEntitiesByTenant, { tenantId });
    const refs = entities
      .filter((e) => e.sourceDocumentId === (docId as Id<"documents">))
      .slice(0, 10)
      .map((e) => ({ entityId: String(e._id), name: e.name, entityTypeKey: e.entityTypeKey }));
    return ok({ found: refs.length > 0, storeKey: step.storeKey, entities: refs });
  }

  return ok({ found: false, storeKey: step.storeKey, note: "Unsupported retrieve source." });
}

async function decisionExecutor(input: StepExecutorInput): Promise<StepResult> {
  const step = input.step as DecisionStep;
  const decision = evaluateRules(
    step.rules,
    input.instance.context ?? {},
    {
      decision: "no_action",
      confidence: 0.5,
      rationale: "No rule matched — no action is warranted.",
      risk: input.def.policies.riskLevel,
      requiresHumanReview: false,
      recommendedNextStep: step.defaultNext ?? null,
    },
  );
  const nextStepId = decision.recommendedNextStep ?? step.defaultNext ?? step.next ?? sequentialNext(input.def, step.id);
  return ok(
    { ...decision },
    {
      nextStepId,
      evidence: decision.evidenceReferences,
    },
  );
}

/** Descriptive approval request shared by approval steps and defensive action paths. */
async function requestApproval(
  input: StepExecutorInput,
  targetStepId: string,
  tool: { id: string; name: string } | null,
  args: Record<string, unknown> | undefined,
  title: string,
  description: string,
  consequences: string,
  reversibility: string,
  role: string,
): Promise<Id<"workflowApprovals">> {
  const { ctx, instance, def } = input;
  const expiresAt =
    Date.now() +
    ((input.step as ApprovalStep).expiresAfterMs ?? WORKFLOW_LIMITS.defaultApprovalExpiryMs);
  const approvalId = await ctx.runMutation(internal.internal.insertWorkflowApproval, {
    tenantId: instance.tenantId,
    instanceId: instance._id,
    workflowDefinitionId: def.id,
    stepId: targetStepId,
    title: fillPlaceholders(title, instance),
    description: fillPlaceholders(description, instance),
    proposedAction: tool ? { toolId: tool.id, toolName: tool.name, args } : undefined,
    affectedSystem: tool ? "google_drive" : undefined,
    targetResource: resourceName(instance),
    expectedConsequences: fillPlaceholders(consequences, instance) || undefined,
    evidence: input.instance.evidenceReferences ?? [],
    rationale: `Approval requested by workflow "${def.name}" before a ${tool?.name ?? "workflow"} action.`,
    reversibility: fillPlaceholders(reversibility, instance) || undefined,
    requestedRole: (role as "member" | "manager" | "owner") ?? "manager",
    status: "pending",
    expiresAt,
    createdAt: Date.now(),
  });
  await ctx.runMutation(internal.internal.insertNotification, {
    tenantId: instance.tenantId,
    severity: "high",
    title: `Approval required: ${fillPlaceholders(title, instance)}`,
    description: fillPlaceholders(description, instance),
    sourceEventId: instance.triggerEventId ?? undefined,
    createdAt: Date.now(),
  });
  await ctx.runMutation(internal.internal.logAudit, {
    tenantId: instance.tenantId,
    actorType: "system",
    actionType: "workflow_approval_requested",
    targetType: "workflow_approval",
    targetId: String(approvalId),
    metadata: {
      instanceId: String(instance._id),
      workflowId: def.id,
      stepId: targetStepId,
      requestedRole: role,
    },
  });
  return approvalId;
}

async function approvalExecutor(input: StepExecutorInput): Promise<StepResult> {
  const step = input.step as ApprovalStep;
  const { def, instance } = input;
  const targetStepId = step.next ?? sequentialNext(def, step.id);
  if (!targetStepId) return err("Approval step has no following action to authorize.");

  const nextAction = def.steps.find((s) => s.id === targetStepId);
  const tool =
    nextAction && nextAction.type === "action"
      ? TOOL_BY_ID[(nextAction as ActionStep).toolId] ?? null
      : null;
  const role =
    input.settings?.approvalRoleOverride ?? def.approvalRole ?? step.role ?? "manager";

  // Deterministic context for the action that follows (e.g. the
  // reviewed-document marker description). Re-emitted on the resume path so
  // the following action step always sees it in context.
  const reviewDescription =
    tool?.id === "drive.update_file"
      ? `Reviewed by Atlas on ${new Date(instance.startedAt).toISOString().slice(0, 10)}`
      : undefined;

  const already = input.approvals.find(
    (a) => a.stepId === targetStepId && a.status === "approved",
  );
  if (already) {
    return ok({
      status: "already_approved",
      approvalId: String(already._id),
      reviewDescription,
    });
  }
  const pending = input.approvals.find(
    (a) => a.stepId === targetStepId && a.status === "pending",
  );
  if (pending) {
    // resume path — re-block on the existing request
    return {
      block: true,
      blockKind: "approval",
      approvalId: pending._id,
      output: { status: "pending", reviewDescription },
    };
  }

  const approvalId = await requestApproval(
    input,
    targetStepId,
    tool,
    nextAction && nextAction.type === "action"
      ? Object.fromEntries(
          (nextAction as ActionStep).args.map((a) => [a.key, a.from === "literal" ? a.value : a.path]),
        )
      : undefined,
    step.title,
    step.description,
    step.consequences ?? "",
    step.reversibility ?? "",
    role,
  );
  return {
    block: true,
    blockKind: "approval",
    approvalId,
    output: {
      status: "requested",
      reviewDescription,
      requestedRole: role,
      expiresAt: Date.now() + (step.expiresAfterMs ?? WORKFLOW_LIMITS.defaultApprovalExpiryMs),
    },
  };
}

async function actionExecutor(input: StepExecutorInput): Promise<StepResult> {
  const step = input.step as ActionStep;
  const { ctx, instance, def } = input;
  const tool = TOOL_BY_ID[step.toolId];
  if (!tool || tool.implementationStatus !== "implemented") {
    return err(`Tool "${step.toolId}" is not implemented.`);
  }

  const args: Record<string, unknown> = {};
  for (const arg of step.args) {
    if (arg.from === "literal") {
      args[arg.key] = arg.value;
    } else {
      const v = getContextPath(instance.context ?? {}, arg.path ?? "");
      if (v === undefined) return err(`Missing context value for action arg "${arg.key}".`);
      args[arg.key] = v;
    }
  }

  // Idempotency: reuse a terminal action record for this step attempt.
  if (input.existingStep?.actionId) {
    const existing = await ctx.runQuery(internal.internal.getToolActionById, {
      actionId: input.existingStep.actionId,
    });
    if (existing) {
      if (existing.status === "succeeded" || existing.status === "verified") {
        return ok(
          {
            outcome: "completed",
            actionId: String(existing._id),
            status: existing.status,
            verificationStatus: existing.verificationStatus ?? null,
            result: existing.result ?? null,
          },
          { actionId: existing._id },
        );
      }
      if (existing.status === "verification_failed" || existing.status === "failed") {
        return err(existing.error ?? "Action failed or failed verification.", "permanent");
      }
    }
  }

  const validation = validateToolInput(tool, args);
  if (!validation.ok) {
    return err(`Invalid action input: ${validation.errors.join("; ")}`);
  }
  const { riskLevel } = evaluateRisk(tool, validation.value);

  const authorization = resolveActionExecution({
    riskLevel,
    toolId: tool.id,
    blockedTools: def.policies.blockedTools,
    allowedTools: def.policies.allowedTools,
    approvalGrantedForStep: approvalGrantedForStep(instance, step.id),
    autoLowRiskWrite: false, // conservative — tenant workflow auto-writes are a future toggle
  });
  if (authorization.mode === "blocked") {
    return err(authorization.reason);
  }
  if (authorization.mode === "request_approval") {
    const approvalId = await requestApproval(
      input,
      step.id,
      tool,
      validation.value,
      `Approve: ${tool.name}`,
      `Atlas wants to run "${tool.name}" as part of workflow "${def.name}". ${authorization.reason}`,
      "",
      "",
      def.approvalRole ?? "manager",
    );
    return { block: true, blockKind: "approval", approvalId, output: { status: "requested" } };
  }

  // Execute through the Phase 4 runtime — the ONLY path to external systems.
  const conns = await ctx.runQuery(internal.internal.listConnectionsByTenant, {
    tenantId: instance.tenantId,
  });
  const conn = tool.authRequirements.provider
    ? conns.find((c) => c.provider === tool.authRequirements.provider)
    : undefined;
  const recordId = await ctx.runMutation(internal.internal.insertToolAction, {
    tenantId: instance.tenantId,
    trigger: "workflow",
    sourceEventId: instance.triggerEventId ?? undefined,
    workflowInstanceId: instance._id,
    toolId: tool.id,
    connectorId: conn?._id,
    status: "approved",
    input: validation.value,
    confirmationRequired: false,
    startedAt: Date.now(),
  });
  const outcome = await ctx.runAction(internal.tools.execute.executeEventAction, {
    actionId: recordId,
    tenantId: instance.tenantId,
  });

  if (outcome.outcome === "failed") {
    const cls =
      classifyFailure(new Error(outcome.error ?? "Action failed."), outcome.code ?? null);
    return {
      block: false,
      output: { outcome: "failed", actionId: String(recordId), error: outcome.error },
      actionId: recordId,
      error: outcome.error ?? "Action failed.",
      errorClass: cls,
    };
  }
  return ok(
    {
      outcome: outcome.outcome,
      actionId: String(recordId),
      status: "status" in outcome ? outcome.status : null,
      verificationStatus: "verificationStatus" in outcome ? outcome.verificationStatus : null,
      result: "result" in outcome ? outcome.result : null,
      riskLevel,
    },
    { actionId: recordId },
  );
}

async function waitExecutor(input: StepExecutorInput): Promise<StepResult> {
  const step = input.step as WaitStep;
  if (step.mode === "time") {
    const until = input.instance.startedAt + (step.durationMs ?? 0);
    return { block: true, blockKind: "wait_time", waitUntil: until, output: { until } };
  }
  return {
    block: true,
    blockKind: "wait_event",
    waitFor: {
      eventType: step.eventType ?? "",
      correlation: { resource: step.correlation === "resource" },
    },
    output: { eventType: step.eventType ?? null },
  };
}

async function notifyExecutor(input: StepExecutorInput): Promise<StepResult> {
  const step = input.step as NotifyStep;
  await input.ctx.runMutation(internal.internal.insertNotification, {
    tenantId: input.instance.tenantId,
    severity: step.severity,
    title: fillPlaceholders(step.title, input.instance),
    description: step.description ? fillPlaceholders(step.description, input.instance) : undefined,
    sourceEventId: input.instance.triggerEventId ?? undefined,
    createdAt: Date.now(),
  });
  return ok({ notified: true });
}

async function updateExecutor(input: StepExecutorInput): Promise<StepResult> {
  const step = input.step as UpdateStep;
  const { ctx, instance } = input;
  if (step.kind === "patch_document") {
    const docId = getContextPath(instance.context ?? {}, "document._id") as string | undefined;
    if (!docId) return err("No document in context to patch.");
    const value =
      typeof step.value === "string"
        ? fillPlaceholders(step.value, instance)
        : step.value;
    await ctx.runMutation(internal.internal.patchDoc, {
      id: docId as Id<"documents">,
      patch: { [step.documentField ?? "summary"]: value },
    });
    return ok({ patched: step.documentField ?? "summary" });
  }
  if (step.kind === "add_assertion" && step.assertion) {
    await ctx.runMutation(internal.internal.insertAssertion, {
      tenantId: instance.tenantId,
      classification: step.assertion.classification,
      statement: fillPlaceholders(step.assertion.statement, instance),
      confidence: step.assertion.confidence,
      sourceDocumentId: (getContextPath(instance.context ?? {}, "document._id") as
        | string
        | undefined) as Id<"documents"> | undefined,
      evidence: `Workflow ${instance.definitionId}`,
    });
    return ok({ assertion: fillPlaceholders(step.assertion.statement, instance) });
  }
  return err("Unsupported update step kind.");
}

async function completeExecutor(): Promise<StepResult> {
  return ok({ completed: true });
}

// ---------------------------------------------------------------------------
// Registry-driven dispatch — add a step executor here when a new kind lands.
// ---------------------------------------------------------------------------

export const STEP_EXECUTORS: Record<string, StepExecutor> = {
  condition: conditionExecutor,
  retrieve: retrieveExecutor,
  decision: decisionExecutor,
  action: actionExecutor,
  approval: approvalExecutor,
  wait: waitExecutor,
  notify: notifyExecutor,
  update: updateExecutor,
  complete: completeExecutor,
};
