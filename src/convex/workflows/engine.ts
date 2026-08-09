"use node";

// ---------------------------------------------------------------------------
// Durable workflow engine.
//
// The engine ORCHESTRATES existing primitives — it never calls external
// provider APIs directly. All actions go through the Phase 4 tool runtime.
//
// Execution is durable: instance state, step records and approvals are
// persisted before any side effect, so a restarted worker resumes from the
// exact step, never re-running completed steps (idempotent step keys) and
// never inventing state.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { backoffMs, sanitizeEventError } from "../events/contract";
import {
  eventResumeKey,
  RESUMABLE_STATUSES,
  sanitizeWorkflowContext,
  stepExecutionKey,
  TERMINAL_STATUSES,
  type ActionStep,
  type DecisionStep,
  type WorkflowDefinition,
  type WorkflowStep,
} from "./contract";
import { evaluateCondition } from "./conditions";
import { shouldDispatch, checkWorkflowLimits } from "./policy";
import { getWorkflowDefinition, WORKFLOW_REGISTRY } from "./registry";
import {
  STEP_EXECUTORS,
  sequentialNext,
  type StepResult,
  type WorkflowInstanceLike,
  type WorkflowStepLike,
} from "./executors";

type InstanceDoc = WorkflowInstanceLike & {
  retryCounts?: Record<string, number>;
  completedStepIds?: string[];
  waitResumeKeys?: string[];
  waitConditions?: unknown;
  failureReason?: string | null;
  errorClass?: string | null;
  startedAt: number;
  updatedAt: number;
  context: Record<string, unknown>;
};

async function loadInstance(
  ctx: ActionCtx,
  instanceId: Id<"workflowInstances">,
): Promise<InstanceDoc | null> {
  const inst = await ctx.runQuery(internal.internal.getWorkflowInstanceById, { instanceId });
  return (inst as InstanceDoc | null) ?? null;
}

async function audit(
  ctx: ActionCtx,
  inst: InstanceDoc,
  actionType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await ctx.runMutation(internal.internal.logAudit, {
    tenantId: inst.tenantId,
    actorType: "system",
    actionType,
    targetType: "workflow_instance",
    targetId: String(inst._id),
    metadata: { workflowId: inst.definitionId, instanceId: String(inst._id), ...metadata },
  });
}

async function notifyInstance(
  ctx: ActionCtx,
  inst: InstanceDoc,
  severity: "info" | "low" | "medium" | "high" | "critical",
  title: string,
  description?: string,
): Promise<void> {
  await ctx.runMutation(internal.internal.insertNotification, {
    tenantId: inst.tenantId,
    severity,
    title,
    description,
    sourceEventId: inst.triggerEventId ?? undefined,
    createdAt: Date.now(),
  });
}

async function failInstance(
  ctx: ActionCtx,
  inst: InstanceDoc,
  reason: string,
  errorClass?: string,
): Promise<void> {
  await ctx.runMutation(internal.internal.patchWorkflowInstance, {
    id: inst._id,
    patch: {
      status: "failed",
      failureReason: reason,
      errorClass: errorClass ?? "permanent",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    },
  });
  await notifyInstance(ctx, inst, "medium", `Workflow failed: ${inst.definitionId}`, reason);
  await audit(ctx, inst, "workflow_failed", { reason, errorClass: errorClass ?? "permanent" });
}

function nextStepId(
  def: WorkflowDefinition,
  step: WorkflowStep,
  result?: StepResult,
): string | null {
  if (result?.nextStepId) return result.nextStepId;
  return step.next ?? sequentialNext(def, step.id);
}

/** Merge a step's output into the instance context (safe, sanitized). */
function mergeStepOutput(
  context: Record<string, unknown>,
  step: WorkflowStep,
  output: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out = output ?? {};
  let merged: Record<string, unknown>;
  if (step.type === "decision") {
    merged = { ...context, [step.id]: out, [(step as DecisionStep).storeKey]: out };
  } else if (step.type === "approval") {
    // Approval outputs are tiny + safe; surface them at the top level so
    // following action args (e.g. reviewDescription) can read them.
    merged = { ...context, [step.id]: out, ...out };
  } else if (step.type === "action") {
    merged = { ...context, [step.id]: out, [(step as ActionStep).storeKey ?? "lastAction"]: out };
  } else {
    merged = { ...context, [step.id]: out };
  }
  return sanitizeWorkflowContext(merged) as Record<string, unknown>;
}

async function completeWorkflow(
  ctx: ActionCtx,
  inst: InstanceDoc,
): Promise<void> {
  await ctx.runMutation(internal.internal.patchWorkflowInstance, {
    id: inst._id,
    patch: { status: "completed", completedAt: Date.now(), updatedAt: Date.now() },
  });
  await notifyInstance(ctx, inst, "info", `Workflow completed: ${inst.definitionId}`);
  await audit(ctx, inst, "workflow_completed", {});
}

// ---------------------------------------------------------------------------
// Advance — the durable execution loop
// ---------------------------------------------------------------------------

export const advanceWorkflow = internalAction({
  args: { instanceId: v.id("workflowInstances") },
  handler: async (ctx, { instanceId }): Promise<{ status: string }> => {
    const loaded = await loadInstance(ctx, instanceId);
    if (!loaded) return { status: "missing" };
    let inst: InstanceDoc = loaded;
    if (!(RESUMABLE_STATUSES as readonly string[]).includes(inst.status)) {
      return { status: inst.status };
    }

    // 1. Expire stale approvals before deciding anything.
    const approvals = await ctx.runQuery(internal.internal.listApprovalsByInstance, { instanceId });
    const now = Date.now();
    let expiredAny = false;
    for (const a of approvals) {
      if (a.status === "pending" && a.expiresAt && a.expiresAt < now) {
        await ctx.runMutation(internal.internal.patchWorkflowApproval, {
          id: a._id,
          patch: { status: "expired" },
        });
        expiredAny = true;
      }
    }
    if (expiredAny && inst.status === "awaiting_approval") {
      await failInstance(ctx, inst, "An approval request expired before it was decided.");
      return { status: "failed" };
    }
    if (inst.status === "awaiting_approval") {
      return { status: "awaiting_approval" };
    }

    const def = getWorkflowDefinition(inst.definitionId);
    if (!def) {
      await failInstance(ctx, inst, "Workflow definition is no longer registered.");
      return { status: "failed" };
    }
    const settings =
      (await ctx.runQuery(internal.internal.getWorkflowSettingsByTenant, {
        tenantId: inst.tenantId,
      })).find((s) => s.workflowId === def.id) ?? null;

    let iterations = 0;
    while (iterations++ < 40) {
      if (!(RESUMABLE_STATUSES as readonly string[]).includes(inst.status)) break;

      const limits = checkWorkflowLimits({
        def,
        startedAt: inst.startedAt,
        now: Date.now(),
        actionCount: inst.actionCount,
        completedSteps: inst.completedStepIds?.length ?? 0,
      });
      if (!limits.ok) {
        if (limits.failure === "timed_out") {
          await ctx.runMutation(internal.internal.patchWorkflowInstance, {
            id: inst._id,
            patch: { status: "timed_out", failureReason: limits.reason, completedAt: Date.now(), updatedAt: Date.now() },
          });
          await notifyInstance(ctx, inst, "medium", `Workflow timed out: ${inst.definitionId}`, limits.reason);
          await audit(ctx, inst, "workflow_timed_out", { reason: limits.reason });
        } else {
          await failInstance(ctx, inst, limits.reason);
        }
        return { status: limits.failure === "timed_out" ? "timed_out" : "failed" };
      }

      const step = def.steps.find((s) => s.id === inst.currentStepId);
      if (!step) {
        await failInstance(ctx, inst, `Unknown step "${inst.currentStepId}".`);
        return { status: "failed" };
      }

      // 2. Idempotency — a completed step is never executed again.
      if ((inst.completedStepIds ?? []).includes(step.id)) {
        const nextId = step.next ?? sequentialNext(def, step.id);
        if (!nextId) {
          await completeWorkflow(ctx, inst);
          return { status: "completed" };
        }
        inst = {
          ...inst,
          currentStepId: nextId,
          updatedAt: Date.now(),
        };
        await ctx.runMutation(internal.internal.patchWorkflowInstance, {
          id: inst._id,
          patch: { currentStepId: nextId, updatedAt: Date.now() },
        });
        continue;
      }

      // 3. Deterministic step identity: instance + step + attempt.
      const attempt = (inst.retryCounts?.[step.id] ?? 0) + 1;
      const stepKey = stepExecutionKey(String(inst._id), step.id, attempt);
      const existingStep = (await ctx.runQuery(internal.internal.getWorkflowStepByKey, {
        stepKey,
      })) as WorkflowStepLike | null;
      if (existingStep && (existingStep.status === "succeeded" || existingStep.status === "skipped")) {
        const nextId = step.next ?? sequentialNext(def, step.id);
        if (!nextId) {
          await completeWorkflow(ctx, inst);
          return { status: "completed" };
        }
        inst = { ...inst, currentStepId: nextId, updatedAt: Date.now() };
        await ctx.runMutation(internal.internal.patchWorkflowInstance, {
          id: inst._id,
          patch: { currentStepId: nextId, updatedAt: Date.now() },
        });
        continue;
      }

      const started = Date.now();
      await ctx.runMutation(internal.internal.upsertWorkflowStep, {
        tenantId: inst.tenantId,
        instanceId: inst._id,
        stepId: step.id,
        stepType: step.type,
        attempt,
        stepKey,
        status: "running",
        startedAt: started,
        createdAt: Date.now(),
      });

      const executor = STEP_EXECUTORS[step.type];
      let result: StepResult;
      if (!executor) {
        result = { block: false, output: {}, error: `No executor for step type "${step.type}".`, errorClass: "permanent" };
      } else {
        try {
          result = await executor({
            ctx,
            instance: inst,
            step,
            def,
            settings,
            approvals,
            existingStep,
          });
        } catch (e) {
          result = {
            block: false,
            output: {},
            error: sanitizeEventError(e),
            errorClass: "retryable",
          };
        }
      }

      // 4. Failure path — bounded retries, never infinite.
      if (result.error) {
        const failedAttempts = (inst.retryCounts?.[step.id] ?? 0) + 1;
        await ctx.runMutation(internal.internal.upsertWorkflowStep, {
          tenantId: inst.tenantId,
          instanceId: inst._id,
          stepId: step.id,
          stepType: step.type,
          attempt,
          stepKey,
          status: "failed",
          error: result.error,
          actionId: result.actionId,
          approvalId: result.approvalId,
          completedAt: Date.now(),
          durationMs: Date.now() - started,
          createdAt: Date.now(),
        });
        const cls = result.errorClass ?? "permanent";
        if (cls === "retryable" && failedAttempts < def.retryPolicy.maxAttempts) {
          const retryCounts = { ...(inst.retryCounts ?? {}), [step.id]: failedAttempts };
          await ctx.runMutation(internal.internal.patchWorkflowInstance, {
            id: inst._id,
            patch: { retryCounts, updatedAt: Date.now() },
          });
          inst = { ...inst, retryCounts };
          ctx.scheduler.runAfter(
            backoffMs(failedAttempts, def.retryPolicy.baseMs),
            internal.workflows.engine.advanceWorkflow,
            { instanceId },
          );
          await audit(ctx, inst, "workflow_step_retry", {
            stepId: step.id,
            attempt: failedAttempts,
            error: result.error,
          });
          return { status: "running" };
        }
        await failInstance(ctx, inst, result.error, cls);
        return { status: "failed" };
      }

      // 5. Block path — wait / approval — durable and resumable.
      if (result.block) {
        await ctx.runMutation(internal.internal.upsertWorkflowStep, {
          tenantId: inst.tenantId,
          instanceId: inst._id,
          stepId: step.id,
          stepType: step.type,
          attempt,
          stepKey,
          status: "waiting",
          output: result.output,
          actionId: result.actionId,
          approvalId: result.approvalId,
          completedAt: Date.now(),
          durationMs: Date.now() - started,
          createdAt: Date.now(),
        });
        if (result.blockKind === "approval") {
          const approvalReferences = [...(inst.approvalReferences ?? [])];
          if (result.approvalId) approvalReferences.push(String(result.approvalId));
          await ctx.runMutation(internal.internal.patchWorkflowInstance, {
            id: inst._id,
            patch: {
              status: "awaiting_approval",
              approvalReferences,
              updatedAt: Date.now(),
            },
          });
          await audit(ctx, inst, "workflow_step_waiting", { stepId: step.id, kind: "approval" });
          return { status: "awaiting_approval" };
        }
        if (result.blockKind === "wait_time") {
          const until = result.waitUntil ?? Date.now();
          await ctx.runMutation(internal.internal.patchWorkflowInstance, {
            id: inst._id,
            patch: {
              status: "waiting",
              waitConditions: { kind: "time", until },
              updatedAt: Date.now(),
            },
          });
          await audit(ctx, inst, "workflow_step_waiting", { stepId: step.id, kind: "time", until });
          const delay = Math.max(0, until - Date.now());
          ctx.scheduler.runAfter(
            delay,
            internal.workflows.engine.advanceWorkflow,
            { instanceId },
          );
          return { status: "waiting" };
        }
        // wait_event — resumed by the event dispatch pipeline.
        const waitFor = result.waitFor ?? { eventType: "", correlation: { resource: true } };
        await ctx.runMutation(internal.internal.patchWorkflowInstance, {
          id: inst._id,
          patch: {
            status: "waiting",
            waitConditions: { kind: "event", ...waitFor },
            updatedAt: Date.now(),
          },
        });
        await audit(ctx, inst, "workflow_step_waiting", {
          stepId: step.id,
          kind: "event",
          eventType: waitFor.eventType,
        });
        return { status: "waiting" };
      }

      // 6. Success path — persist, merge context, advance.
      const nextId = nextStepId(def, step, result);
      await ctx.runMutation(internal.internal.upsertWorkflowStep, {
        tenantId: inst.tenantId,
        instanceId: inst._id,
        stepId: step.id,
        stepType: step.type,
        attempt,
        stepKey,
        status: "succeeded",
        output: result.output,
        actionId: result.actionId,
        approvalId: result.approvalId,
        evidenceReferences: result.evidence,
        completedAt: Date.now(),
        durationMs: Date.now() - started,
        createdAt: Date.now(),
      });

      const context = mergeStepOutput(inst.context ?? {}, step, result.output);
      const completedStepIds = [...(inst.completedStepIds ?? []), step.id];
      const actionCount =
        inst.actionCount + (step.type === "action" && result.actionId ? 1 : 0);
      const actionReferences = result.actionId
        ? [...(inst.actionReferences ?? []), String(result.actionId)]
        : inst.actionReferences;
      const approvalReferences = result.approvalId
        ? [...(inst.approvalReferences ?? []), String(result.approvalId)]
        : inst.approvalReferences;

      if (!nextId) {
        await ctx.runMutation(internal.internal.patchWorkflowInstance, {
          id: inst._id,
          patch: {
            status: "completed",
            context,
            completedStepIds,
            actionCount,
            actionReferences,
            approvalReferences,
            currentStepId: step.id,
            completedAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
        await notifyInstance(ctx, inst, "info", `Workflow completed: ${inst.definitionId}`);
        await audit(ctx, inst, "workflow_completed", {});
        return { status: "completed" };
      }

      inst = {
        ...inst,
        context,
        completedStepIds,
        actionCount,
        actionReferences,
        approvalReferences,
        currentStepId: nextId,
        updatedAt: Date.now(),
      };
      await ctx.runMutation(internal.internal.patchWorkflowInstance, {
        id: inst._id,
        patch: {
          status: "running",
          context,
          completedStepIds,
          actionCount,
          actionReferences,
          approvalReferences,
          currentStepId: nextId,
          updatedAt: Date.now(),
        },
      });
      await audit(ctx, inst, "workflow_step_completed", { stepId: step.id, stepType: step.type });
    }

    return { status: inst.status };
  },
});

// ---------------------------------------------------------------------------
// Event → Workflow dispatch (extended event pipeline — no new ingestion)
// ---------------------------------------------------------------------------

export const dispatchWorkflowsForEvent = internalAction({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }): Promise<{ dispatched: number; resumed: number }> => {
    const evt = await ctx.runQuery(internal.internal.getEventById, { eventId });
    if (!evt) return { dispatched: 0, resumed: 0 };
    const tenantId = evt.tenantId;
    const settings = await ctx.runQuery(internal.internal.getWorkflowSettingsByTenant, {
      tenantId,
    });
    let dispatched = 0;
    let resumed = 0;

    // 1. Resume any event-waits this event satisfies.
    const waiting = await ctx.runQuery(internal.internal.listInstancesByTenant, {
      tenantId,
      limit: 200,
    });
    for (const w of waiting.filter((x) => x.status === "waiting")) {
      const cond = w.waitConditions as
        | { kind: string; eventType?: string; correlation?: { resource?: boolean } }
        | undefined;
      if (!cond || cond.kind !== "event") continue;
      if (cond.eventType && cond.eventType !== evt.eventType) continue;
      if (cond.correlation?.resource && w.sourceResourceId !== evt.sourceResourceId) {
        continue; // unrelated resource — never resume
      }
      const key = eventResumeKey(evt.eventType, evt.sourceResourceId);
      if ((w.waitResumeKeys ?? []).includes(key)) continue;
      const def = getWorkflowDefinition(w.definitionId);
      if (!def) continue;
      const waitStep = def.steps.find((s) => s.id === w.currentStepId);
      const nextId = waitStep ? (waitStep.next ?? sequentialNext(def, waitStep.id)) : null;
      if (!nextId) continue;
      const waitResumeKeys = [...(w.waitResumeKeys ?? []), key];
      await ctx.runMutation(internal.internal.patchWorkflowInstance, {
        id: w._id,
        patch: { status: "running", currentStepId: nextId, waitResumeKeys, updatedAt: Date.now() },
      });
      await audit(ctx, w as InstanceDoc, "workflow_wait_resumed", {
        stepId: w.currentStepId,
        eventId: String(evt._id),
        eventType: evt.eventType,
        resourceId: evt.sourceResourceId,
      });
      ctx.scheduler.runAfter(0, internal.workflows.engine.advanceWorkflow, { instanceId: w._id });
      resumed++;
    }

    // 2. Dispatch new instances for matching workflow definitions.
    for (const def of WORKFLOW_REGISTRY) {
      if (!def.trigger.eventTypes.includes(evt.eventType)) continue;
      if (def.trigger.conditions) {
        const context = { triggerEvent: { eventType: evt.eventType, sourceResourceId: evt.sourceResourceId, payload: evt.payload } };
        if (!def.trigger.conditions.every((c) => evaluateCondition(c, context as Record<string, unknown>).result)) {
          continue;
        }
      }
      const setting = settings.find((s) => s.workflowId === def.id) ?? null;
      const lastInstance = evt.sourceResourceId
        ? await ctx.runQuery(internal.internal.getLatestInstanceByResource, {
            tenantId,
            definitionId: def.id,
            resourceId: evt.sourceResourceId,
          })
        : null;
      const dispatch = shouldDispatch({
        def,
        settings: setting,
        lastInstanceStartedAt: lastInstance?.startedAt ?? null,
        now: Date.now(),
      });
      if (!dispatch.ok) continue;

      const dedupeKey = `${def.id}:${String(evt._id)}`;
      const existing = await ctx.runQuery(internal.internal.getWorkflowInstanceByDedupeKey, {
        dedupeKey,
      });
      if (existing) continue;

      // Context carries REFERENCES + a restricted payload summary — never raw bodies.
      const payload = (evt.payload ?? {}) as Record<string, unknown>;
      const restricted: Record<string, unknown> = {};
      for (const k of ["fileId", "name", "mimeType", "size", "parents", "changeId"]) {
        if (payload[k] !== undefined) restricted[k] = payload[k];
      }
      const context = {
        triggerEvent: {
          eventId: String(evt._id),
          eventType: evt.eventType,
          sourceResourceId: evt.sourceResourceId,
          occurredAt: evt.occurredAt,
          payload: restricted,
        },
        evidenceReferences: [
          { kind: "event", title: evt.eventType, eventId: String(evt._id) },
        ],
        approvalGranted: null,
      };
      const instanceId = await ctx.runMutation(internal.internal.insertWorkflowInstance, {
        tenantId,
        definitionId: def.id,
        workflowVersion: def.version,
        triggerEventId: evt._id,
        triggerEventType: evt.eventType,
        sourceResourceId: evt.sourceResourceId || undefined,
        status: "pending",
        currentStepId: def.steps[0]?.id ?? "",
        context: sanitizeWorkflowContext(context),
        evidenceReferences: context.evidenceReferences,
        completedStepIds: [],
        retryCounts: {},
        actionCount: 0,
        dedupeKey,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.runMutation(internal.internal.logAudit, {
        tenantId,
        actorType: "system",
        actionType: "workflow_triggered",
        targetType: "workflow_instance",
        targetId: String(instanceId),
        metadata: {
          workflowId: def.id,
          instanceId: String(instanceId),
          eventId: String(evt._id),
          eventType: evt.eventType,
          resourceId: evt.sourceResourceId,
        },
      });
      dispatched++;
      ctx.scheduler.runAfter(0, internal.workflows.engine.advanceWorkflow, { instanceId });
    }

    return { dispatched, resumed };
  },
});

// ---------------------------------------------------------------------------
// Sweep — approval expiry + workflow timeouts (cron)
// ---------------------------------------------------------------------------

export const sweepWorkflows = internalAction({
  args: {},
  handler: async (ctx): Promise<{ expiredApprovals: number; timedOut: number }> => {
    let expiredApprovals = 0;
    let timedOut = 0;
    const now = Date.now();

    const pending = await ctx.runQuery(internal.internal.listAllPendingApprovals, {});
    for (const a of pending) {
      if (!a.expiresAt || a.expiresAt >= now) continue;
      await ctx.runMutation(internal.internal.patchWorkflowApproval, {
        id: a._id,
        patch: { status: "expired" },
      });
      expiredApprovals++;
      const inst = await ctx.runQuery(internal.internal.getWorkflowInstanceById, {
        instanceId: a.instanceId,
      });
      if (inst && inst.status === "awaiting_approval") {
        await ctx.runMutation(internal.internal.patchWorkflowInstance, {
          id: inst._id,
          patch: {
            status: "failed",
            failureReason: "An approval request expired before it was decided.",
            errorClass: "approval_expired",
            completedAt: now,
            updatedAt: now,
          },
        });
        await ctx.runMutation(internal.internal.insertNotification, {
          tenantId: inst.tenantId,
          severity: "medium",
          title: "Workflow failed: approval expired",
          description: `Workflow "${inst.definitionId}" stopped because its approval request expired.`,
          sourceEventId: inst.triggerEventId ?? undefined,
          createdAt: now,
        });
      }
    }

    // Tenant-scoped timeout sweep happens inside advance (limits check) —
    // this cron only expires approvals, which is the actionable drift.
    return { expiredApprovals, timedOut };
  },
});

export type { WorkflowDefinition, WorkflowStep, WorkflowInstanceLike };
export { TERMINAL_STATUSES };
