// ---------------------------------------------------------------------------
// Workflows — Convex surface.
//
// The UI is server-driven: definitions come from the registry, tenant
// activation from workflowSettings, instances from the durable engine.
// Approvals are decided here with the existing membership/role model; the
// engine resumes execution through the scheduler. No client can mutate a
// workflow status directly — every transition happens inside the engine
// (explicit transitions in workflows/contract.ts).
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { isManager, requireTenant, requireUser } from "../helpers";
import { getWorkflowDefinition, WORKFLOW_REGISTRY } from "./registry";
import { roleSatisfies } from "./policy";
import type { WorkflowStatus } from "./contract";

const ACTIVE_STATUSES: WorkflowStatus[] = [
  "pending",
  "running",
  "waiting",
  "awaiting_approval",
  "paused",
];

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const listWorkflowDefinitions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const settings = await ctx.db
      .query("workflowSettings")
      .withIndex("by_tenant_workflow", (q) => q.eq("tenantId", tenantId))
      .collect();
    const byId = new Map(settings.map((s) => [s.workflowId, s]));
    const instances = await ctx.db
      .query("workflowInstances")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
      .collect();
    return WORKFLOW_REGISTRY.map((def) => {
      const mine = instances.filter((i) => i.definitionId === def.id);
      return {
        definition: def,
        settings: byId.get(def.id) ?? null,
        active: mine.filter((i) => ACTIVE_STATUSES.includes(i.status)).length,
        completed: mine.filter((i) => i.status === "completed").length,
        failed: mine.filter((i) => i.status === "failed" || i.status === "timed_out").length,
        total: mine.length,
      };
    });
  },
});

export const getWorkflowDetail = query({
  args: { workflowId: v.string() },
  handler: async (ctx, { workflowId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const def = getWorkflowDefinition(workflowId);
    if (!def) throw new Error("Workflow not found.");
    const setting = await ctx.db
      .query("workflowSettings")
      .withIndex("by_tenant_workflow", (q) =>
        q.eq("tenantId", tenantId).eq("workflowId", workflowId),
      )
      .first();
    const instances = await ctx.db
      .query("workflowInstances")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(100);
    return {
      definition: def,
      settings: setting ?? null,
      instances: instances.filter((i) => i.definitionId === workflowId).slice(0, 50),
    };
  },
});

export const listWorkflowInstances = query({
  args: { limit: v.optional(v.number()), status: v.optional(v.string()) },
  handler: async (ctx, { limit, status }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    let rows = await ctx.db
      .query("workflowInstances")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .take(limit ?? 60);
    if (status) rows = rows.filter((r) => r.status === status);
    return rows.map((r) => {
      const def = getWorkflowDefinition(r.definitionId);
      return {
        ...r,
        definitionName: def?.name ?? r.definitionId,
        triggerLabel: def ? def.trigger.eventTypes.join(", ") : null,
        resourceName:
          (r.context as Record<string, unknown> | undefined)
            ?.triggerEvent &&
          typeof (r.context as Record<string, unknown>).triggerEvent === "object"
            ? (((r.context as Record<string, unknown>).triggerEvent as Record<string, unknown>)
                .payload as Record<string, unknown> | undefined)?.name ?? null
            : null,
      };
    });
  },
});

export const getWorkflowInstanceDetail = query({
  args: { instanceId: v.id("workflowInstances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const inst = await ctx.db.get(instanceId);
    if (!inst || inst.tenantId !== tenantId) throw new Error("Workflow instance not found.");
    const def = getWorkflowDefinition(inst.definitionId);
    const steps = await ctx.db
      .query("workflowSteps")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .order("asc")
      .collect();
    const approvals = await ctx.db
      .query("workflowApprovals")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    return { instance: inst, definition: def ?? null, steps, approvals };
  },
});

export const listWorkflowApprovals = query({
  args: { pendingOnly: v.optional(v.boolean()) },
  handler: async (ctx, { pendingOnly }) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const rows = await ctx.db
      .query("workflowApprovals")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId))
      .order("desc")
      .collect();
    const filtered = pendingOnly ? rows.filter((r) => r.status === "pending") : rows;
    return Promise.all(
      filtered.slice(0, 50).map(async (a) => {
        const inst = await ctx.db.get(a.instanceId);
        const def = inst ? getWorkflowDefinition(inst.definitionId) : null;
        return {
          ...a,
          instanceStatus: inst?.status ?? null,
          workflowName: def?.name ?? a.workflowDefinitionId,
        };
      }),
    );
  },
});

export const workflowStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const instances = await ctx.db
      .query("workflowInstances")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
      .collect();
    const byStatus: Record<string, number> = {};
    let pendingApprovals = 0;
    for (const i of instances) {
      byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    }
    const approvals = await ctx.db
      .query("workflowApprovals")
      .withIndex("by_tenant_status", (q) => q.eq("tenantId", tenantId))
      .collect();
    pendingApprovals = approvals.filter((a) => a.status === "pending").length;
    return {
      total: instances.length,
      byStatus,
      active: instances.filter((i) => ACTIVE_STATUSES.includes(i.status)).length,
      completed: instances.filter((i) => i.status === "completed").length,
      failed: instances.filter((i) => i.status === "failed" || i.status === "timed_out").length,
      pendingApprovals,
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const setWorkflowSetting = mutation({
  args: {
    workflowId: v.string(),
    enabled: v.boolean(),
    approvalRoleOverride: v.optional(
      v.union(v.literal("member"), v.literal("manager"), v.literal("owner")),
    ),
    maxActionsOverride: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can configure workflows.");
    }
    if (!getWorkflowDefinition(args.workflowId)) {
      return { ok: false, reason: "Workflow not found." };
    }
    const existing = await ctx.db
      .query("workflowSettings")
      .withIndex("by_tenant_workflow", (q) =>
        q.eq("tenantId", tenantId).eq("workflowId", args.workflowId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: args.enabled,
        approvalRoleOverride: args.approvalRoleOverride ?? existing.approvalRoleOverride,
        maxActionsOverride: args.maxActionsOverride ?? existing.maxActionsOverride,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("workflowSettings", {
        tenantId,
        workflowId: args.workflowId,
        enabled: args.enabled,
        approvalRoleOverride: args.approvalRoleOverride,
        maxActionsOverride: args.maxActionsOverride,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.insert("auditLogs", {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "workflow_setting_changed",
      targetType: "workflow",
      targetId: args.workflowId,
      metadata: {
        workflowId: args.workflowId,
        enabled: args.enabled,
        approvalRoleOverride: args.approvalRoleOverride ?? null,
        maxActionsOverride: args.maxActionsOverride ?? null,
      },
    });
    return { ok: true };
  },
});

export const decideWorkflowApproval = mutation({
  args: {
    approvalId: v.id("workflowApprovals"),
    decision: v.union(v.literal("approve"), v.literal("reject")),
  },
  handler: async (ctx, { approvalId, decision }): Promise<{ ok: boolean; reason?: string }> => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    const approval = await ctx.db.get(approvalId);
    if (!approval || approval.tenantId !== tenantId) throw new Error("Approval not found.");
    if (approval.status !== "pending") {
      return { ok: false, reason: `This request is already ${approval.status}.` };
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", tenantId).eq("userId", userId),
      )
      .first();
    if (!roleSatisfies(membership?.role, approval.requestedRole)) {
      throw new Error(`Only ${approval.requestedRole}s and above can decide this request.`);
    }
    const now = Date.now();
    if (approval.expiresAt && approval.expiresAt < now) {
      await ctx.db.patch(approvalId, { status: "expired" });
      return { ok: false, reason: "This request expired before it was decided." };
    }
    const inst = await ctx.db.get(approval.instanceId);
    if (!inst || inst.tenantId !== tenantId) throw new Error("Workflow instance not found.");

    if (decision === "reject") {
      await ctx.db.patch(approvalId, {
        status: "rejected",
        decidedBy: userId,
        decidedAt: now,
      });
      await ctx.db.patch(approval.instanceId, {
        status: "failed",
        failureReason: "The approval request was rejected.",
        errorClass: "approval_rejected",
        completedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("notifications", {
        tenantId,
        severity: "medium",
        title: `Workflow stopped: ${inst.definitionId}`,
        description: "The approval request was rejected, so the workflow did not continue.",
        sourceEventId: inst.triggerEventId ?? undefined,
        createdAt: now,
        read: false,
      });
      await ctx.db.insert("auditLogs", {
        tenantId,
        actorType: "user",
        actorId: userId,
        actionType: "workflow_approval_rejected",
        targetType: "workflow_approval",
        targetId: String(approvalId),
        metadata: {
          instanceId: String(approval.instanceId),
          workflowId: inst.definitionId,
          approvalId: String(approvalId),
        },
      });
      return { ok: true };
    }

    // Approve — authorize the exact step this request names, then resume.
    await ctx.db.patch(approvalId, {
      status: "approved",
      decidedBy: userId,
      decidedAt: now,
    });
    const context: Record<string, unknown> = {
      ...((inst.context ?? {}) as Record<string, unknown>),
      approvalGranted: { stepId: approval.stepId, approvalId: String(approvalId) },
    };
    await ctx.db.patch(approval.instanceId, {
      status: "running",
      context,
      updatedAt: now,
    });
    await ctx.db.insert("notifications", {
      tenantId,
      severity: "low",
      title: `Approval granted: ${inst.definitionId}`,
      description: "The workflow will continue from where it paused.",
      sourceEventId: inst.triggerEventId ?? undefined,
      createdAt: now,
      read: false,
    });
    await ctx.db.insert("auditLogs", {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "workflow_approval_granted",
      targetType: "workflow_approval",
      targetId: String(approvalId),
      metadata: {
        instanceId: String(approval.instanceId),
        workflowId: inst.definitionId,
        approvalId: String(approvalId),
        stepId: approval.stepId,
      },
    });
    await ctx.scheduler.runAfter(0, internal.workflows.engine.advanceWorkflow, {
      instanceId: approval.instanceId,
    });
    return { ok: true };
  },
});

export const cancelWorkflowInstance = mutation({
  args: { instanceId: v.id("workflowInstances") },
  handler: async (ctx, { instanceId }): Promise<{ ok: boolean; reason?: string }> => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can cancel workflows.");
    }
    const inst = await ctx.db.get(instanceId);
    if (!inst || inst.tenantId !== tenantId) throw new Error("Workflow instance not found.");
    if (
      inst.status === "completed" ||
      inst.status === "failed" ||
      inst.status === "cancelled" ||
      inst.status === "timed_out"
    ) {
      return { ok: false, reason: `This workflow already ended (${inst.status}).` };
    }
    await ctx.db.patch(instanceId, {
      status: "cancelled",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("auditLogs", {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "workflow_cancelled",
      targetType: "workflow_instance",
      targetId: String(instanceId),
      metadata: { workflowId: inst.definitionId },
    });
    return { ok: true };
  },
});

export const retryWorkflowInstance = mutation({
  args: { instanceId: v.id("workflowInstances") },
  handler: async (ctx, { instanceId }): Promise<{ ok: boolean; reason?: string }> => {
    const userId = await requireUser(ctx);
    const tenantId = await requireTenant(ctx, userId);
    if (!(await isManager(ctx, userId, tenantId))) {
      throw new Error("Only managers and above can retry workflows.");
    }
    const inst = await ctx.db.get(instanceId);
    if (!inst || inst.tenantId !== tenantId) throw new Error("Workflow instance not found.");
    if (inst.status !== "failed" && inst.status !== "timed_out") {
      return { ok: false, reason: `Only failed or timed-out workflows can be retried (this one is ${inst.status}).` };
    }
    await ctx.db.patch(instanceId, {
      status: "running",
      failureReason: undefined,
      errorClass: undefined,
      completedAt: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.workflows.engine.advanceWorkflow, { instanceId });
    return { ok: true };
  },
});
