"use node";

// ---------------------------------------------------------------------------
// Tool execution service.
//
// The SINGLE authorized path for running tools. UI, Ask Atlas and the future
// voice interface all pass through this pipeline — there is no privileged
// shortcut:
//
//   authenticate → tenant isolation → resolve tool → role gate →
//   connector status + scope gate → schema validation → risk evaluation →
//   confirmation (when required) → real handler → verification of resulting
//   state → audit → structured result.
//
// Handlers never see raw client payloads (only schema-validated input) and
// results are sanitized before they are returned or persisted.
// ---------------------------------------------------------------------------

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action, type ActionCtx } from "../_generated/server";
import { TOOL_BY_ID, type ToolDefinition } from "./registry";
import { buildConfirmation, evaluateRisk, type ConfirmationDetails } from "./policy";
import { validateToolInput, type ValidatedInput } from "./schema";
import { TOOL_HANDLERS, type HandlerDeps } from "./driveTools";
import { ensureDriveAccessToken, ToolError } from "./driveClient";

const MANAGER_ROLES = ["owner", "admin", "manager"] as const;

type ConnLike = {
  _id: Id<"connections">;
  provider: string;
  status: string;
  scopes?: string[];
  settings?: Record<string, unknown> | null;
  accountEmail?: string;
};

type Session =
  | { ok: true; userId: Id<"users">; tenantId: Id<"tenants">; role: string }
  | { ok: false; error: string };

/**
 * Structured result of a tool execution. Annotated explicitly so the action's
 * return type never depends on the generated API types (avoids the TS7022
 * circular-inference degradation with `v.any()` args).
 */
type ExecutionResult =
  | {
      outcome: "completed";
      actionId: Id<"toolActions">;
      status: string;
      verificationStatus: string;
      result: Record<string, unknown>;
      explanation: Record<string, unknown>;
    }
  | { outcome: "failed"; actionId: Id<"toolActions">; error: string; code?: string }
  | {
      outcome: "awaiting_confirmation";
      actionId: Id<"toolActions">;
      toolId: string;
      riskLevel: string;
      confirmation: ConfirmationDetails;
    }
  | { outcome: "denied"; reason: string }
  | { outcome: "unsupported"; reason: string }
  | { outcome: "invalid_input"; errors: string[] }
  | { outcome: "invalid_state"; reason: string }
  | { outcome: "cancelled"; actionId: Id<"toolActions"> };

async function resolveSession(ctx: ActionCtx): Promise<Session> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return { ok: false, error: "You must be signed in." };
  const membership = await ctx.runQuery(internal.internal.getMembershipByUser, { userId });
  if (!membership) return { ok: false, error: "You don't belong to a workspace yet." };
  const member = await ctx.runQuery(internal.internal.getMembershipByUserTenant, {
    userId,
    tenantId: membership.tenantId,
  });
  if (!member) return { ok: false, error: "Membership not found." };
  return { ok: true, userId, tenantId: membership.tenantId, role: member.role };
}

async function resolveConnector(
  ctx: ActionCtx,
  tenantId: Id<"tenants">,
  tool: ToolDefinition,
): Promise<ConnLike | null> {
  if (!tool.authRequirements.provider) return null;
  const conns = await ctx.runQuery(internal.internal.listConnectionsByTenant, { tenantId });
  return (conns.find((c) => c.provider === tool.authRequirements.provider) ?? null) as
    | ConnLike
    | null;
}

const SENSITIVE_KEY = /token|secret|authorization|api[_-]?key|password/i;

function sanitizeOutput(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.map((x) => sanitizeOutput(x, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : sanitizeOutput(val, depth + 1);
    }
    return out;
  }
  return value;
}

function summarizeInput(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (k === "content") {
        out[k] = `[${typeof v === "string" ? v.length : 0} chars]`;
        continue;
      }
      out[k] = typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v;
    }
  }
  return out;
}

function matchesExpected(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(([k, exp]) => {
    const act = actual[k];
    if (Array.isArray(exp)) {
      return Array.isArray(act) && exp.every((item) => (act as unknown[]).includes(item));
    }
    return String(act) === String(exp);
  });
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n).trimEnd()}…`;
}

function buildExplanation(
  requestText: string | undefined,
  tool: ToolDefinition,
  result: unknown,
  verificationStatus: string,
  evidence: unknown,
): Record<string, unknown> {
  return {
    summary: requestText
      ? `You asked: “${truncate(requestText, 200)}” — Atlas used ${tool.name}.`
      : `${tool.name} executed.`,
    tool: tool.name,
    result,
    verification: verificationStatus,
    evidence: evidence ?? [],
    note: "Concise decision summary (not internal reasoning): Atlas acted only on schema-validated inputs through the authorized execution runtime.",
  };
}

/** The single execution path — used for auto tools and confirmed tools alike. */
async function runExecution(
  ctx: ActionCtx,
  recordId: Id<"toolActions">,
  userId: Id<"users">,
  tenantId: Id<"tenants">,
): Promise<ExecutionResult> {
  const record = await ctx.runQuery(internal.internal.getToolActionById, { actionId: recordId });
  if (!record) throw new Error("Action record not found.");
  const tool = TOOL_BY_ID[record.toolId];
  if (!tool || tool.implementationStatus !== "implemented") {
    await ctx.runMutation(internal.internal.patchToolAction, {
      id: recordId,
      patch: { status: "failed", error: "Tool not implemented.", completedAt: Date.now() },
    });
    return { outcome: "failed", actionId: recordId, error: "Tool not implemented." };
  }
  const input = (record.input ?? {}) as ValidatedInput;

  // Connector + scope gate — re-verified at execution time, never trusted
  // from the proposal alone.
  let connection: ConnLike | null = null;
  if (tool.authRequirements.provider) {
    connection = await resolveConnector(ctx, tenantId, tool);
    if (!connection || connection.status !== "connected") {
      await ctx.runMutation(internal.internal.patchToolAction, {
        id: recordId,
        patch: {
          status: "failed",
          error: `Needs a connected ${tool.authRequirements.provider} source.`,
          completedAt: Date.now(),
        },
      });
      return {
        outcome: "failed",
        actionId: recordId,
        error: `Needs a connected ${tool.authRequirements.provider} source.`,
      };
    }
    const granted = connection.scopes ?? [];
    const missing = tool.requiredScopes.filter((s) => !granted.includes(s));
    if (missing.length > 0) {
      await ctx.runMutation(internal.internal.patchToolAction, {
        id: recordId,
        patch: {
          status: "failed",
          error: "Missing OAuth scopes — reconnect the source.",
          completedAt: Date.now(),
        },
      });
      return { outcome: "failed", actionId: recordId, error: "Missing OAuth scopes — reconnect the source." };
    }
  }

  await ctx.runMutation(internal.internal.patchToolAction, {
    id: recordId,
    patch: { status: "executing", connectorId: connection?._id },
  });

  try {
    let accessToken = "";
    if (tool.authRequirements.provider === "google_drive" && connection) {
      accessToken = await ensureDriveAccessToken(ctx, connection);
    }
    const deps: HandlerDeps = {
      tenantId,
      actorId: userId,
      connection: connection ?? { _id: "" as Id<"connections">, settings: {}, scopes: [] },
      accessToken,
      input,
    };
    const handler = TOOL_HANDLERS[tool.id];
    if (!handler) throw new ToolError("tool_not_implemented", "This tool has no handler yet.");
    const { result, verification } = await handler(deps);
    const safeResult = sanitizeOutput(result) as Record<string, unknown>;

    let verificationStatus: "pending" | "verified" | "verification_failed" | "skipped" =
      "skipped";
    let verificationResult: Record<string, unknown> | undefined;
    if (verification) {
      verificationStatus = "pending";
      try {
        const metaHandler = TOOL_HANDLERS["drive.get_file_metadata"];
        if (metaHandler) {
          const meta = await metaHandler({
            ...deps,
            input: { fileId: verification.fileId },
          });
          const actual = meta.result as Record<string, unknown>;
          const ok = matchesExpected(actual, verification.expected);
          verificationResult = { expected: verification.expected, actual, ok };
          verificationStatus = ok ? "verified" : "verification_failed";
        }
      } catch {
        verificationStatus = "verification_failed";
      }
    }

    const finalStatus =
      verificationStatus === "verified"
        ? "verified"
        : verificationStatus === "verification_failed"
          ? "verification_failed"
          : "succeeded";
    const explanation = buildExplanation(
      record.requestText,
      tool,
      safeResult,
      verificationStatus,
      record.evidence,
    );
    await ctx.runMutation(internal.internal.patchToolAction, {
      id: recordId,
      patch: {
        status: finalStatus,
        result: safeResult,
        verificationStatus,
        verificationResult,
        explanation,
        completedAt: Date.now(),
      },
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "tool_executed",
      targetType: "tool_action",
      targetId: String(recordId),
      metadata: {
        toolId: tool.id,
        connectorId: connection ? String(connection._id) : undefined,
        status: finalStatus,
        verificationStatus,
        actionId: String(recordId),
        summary: summarizeInput(record.input),
      },
    });
    return {
      outcome: "completed",
      actionId: recordId,
      status: finalStatus,
      verificationStatus,
      result: safeResult,
      explanation,
    };
  } catch (e) {
    // ToolError messages are sanitized by construction; anything else is
    // mapped to a generic message so raw provider details never leak.
    const message =
      e instanceof ToolError ? e.message : "The tool failed unexpectedly.";
    const code = e instanceof ToolError ? e.code : "tool_failed";
    await ctx.runMutation(internal.internal.patchToolAction, {
      id: recordId,
      patch: { status: "failed", error: message, completedAt: Date.now() },
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "tool_execution_failed",
      targetType: "tool_action",
      targetId: String(recordId),
      metadata: { toolId: tool.id, error: message, actionId: String(recordId) },
    });
    return { outcome: "failed", actionId: recordId, error: message, code };
  }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export const executeTool = action({
  args: { toolId: v.string(), input: v.any(), context: v.optional(v.any()) },
  handler: async (ctx, { toolId, input, context }): Promise<ExecutionResult> => {
    const session = await resolveSession(ctx);
    if (!session.ok) throw new Error(session.error);
    const { userId, tenantId, role } = session;
    const ctxArgs =
      context && typeof context === "object" && !Array.isArray(context)
        ? (context as Record<string, unknown>)
        : {};

    const tool = TOOL_BY_ID[toolId];
    if (!tool) {
      return { outcome: "unsupported", reason: `No tool “${toolId}” is registered.` };
    }
    if (tool.implementationStatus !== "implemented") {
      return { outcome: "unsupported", reason: `${tool.name} is documented but not implemented yet.` };
    }
    if (tool.authRequirements.minRole === "manager" && !MANAGER_ROLES.includes(role as never)) {
      return { outcome: "denied", reason: "Only managers and above can run this tool." };
    }

    // Connector gate before even proposing.
    const connection = await resolveConnector(ctx, tenantId, tool);
    if (tool.authRequirements.provider && (!connection || connection.status !== "connected")) {
      return {
        outcome: "denied",
        reason: `${tool.name} needs a connected ${tool.authRequirements.provider} source. Connect it first.`,
      };
    }
    if (tool.authRequirements.provider && connection) {
      const granted = connection.scopes ?? [];
      const missing = tool.requiredScopes.filter((s) => !granted.includes(s));
      if (missing.length > 0) {
        return {
          outcome: "denied",
          reason: "The connection is missing required OAuth scopes — reconnect the source.",
        };
      }
    }

    const validation = validateToolInput(tool, input);
    if (!validation.ok) {
      return { outcome: "invalid_input", errors: validation.errors };
    }
    const sanitizedInput = validation.value;
    const { riskLevel, confirmationRequired } = evaluateRisk(tool, sanitizedInput);

    const evidence = Array.isArray(ctxArgs.evidence) ? ctxArgs.evidence : undefined;
    const requestText =
      typeof ctxArgs.requestText === "string" ? ctxArgs.requestText : undefined;

    if (confirmationRequired) {
      const confirmation = buildConfirmation(
        tool,
        sanitizedInput,
        connection?.accountEmail,
      );
      const recordId = await ctx.runMutation(internal.internal.insertToolAction, {
        tenantId,
        actorId: userId,
        toolId,
        connectorId: connection?._id,
        status: "awaiting_confirmation",
        input: sanitizedInput,
        confirmationRequired: true,
        confirmationMessage: confirmation.message,
        evidence,
        requestText,
        startedAt: Date.now(),
      });
      await ctx.runMutation(internal.internal.logAudit, {
        tenantId,
        actorType: "user",
        actorId: userId,
        actionType: "tool_action_proposed",
        targetType: "tool_action",
        targetId: String(recordId),
        metadata: {
          toolId,
          riskLevel,
          actionId: String(recordId),
          summary: summarizeInput(sanitizedInput),
        },
      });
      return {
        outcome: "awaiting_confirmation",
        actionId: recordId,
        toolId,
        riskLevel,
        confirmation,
      };
    }

    const recordId = await ctx.runMutation(internal.internal.insertToolAction, {
      tenantId,
      actorId: userId,
      toolId,
      connectorId: connection?._id,
      status: "proposed",
      input: sanitizedInput,
      confirmationRequired: false,
      evidence,
      requestText,
      startedAt: Date.now(),
    });
    return await runExecution(ctx, recordId, userId, tenantId);
  },
});

export const confirmToolAction = action({
  args: { actionId: v.id("toolActions") },
  handler: async (ctx, { actionId }): Promise<ExecutionResult> => {
    const session = await resolveSession(ctx);
    if (!session.ok) throw new Error(session.error);
    const { userId, tenantId, role } = session;
    const record = await ctx.runQuery(internal.internal.getToolActionById, { actionId });
    if (!record || record.tenantId !== tenantId) throw new Error("Action not found.");
    if (record.status !== "awaiting_confirmation") {
      return {
        outcome: "invalid_state",
        reason: `This action is ${record.status} — nothing to confirm.`,
      };
    }
    const canConfirm =
      record.actorId === userId || MANAGER_ROLES.includes(role as never);
    if (!canConfirm) {
      return { outcome: "denied", reason: "Only the requester or a manager can confirm this action." };
    }
    await ctx.runMutation(internal.internal.patchToolAction, {
      id: actionId,
      patch: { status: "approved", confirmedAt: Date.now(), confirmedBy: userId },
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "tool_action_confirmed",
      targetType: "tool_action",
      targetId: String(actionId),
      metadata: { actionId: String(actionId) },
    });
    return await runExecution(ctx, actionId, userId, tenantId);
  },
});

export const cancelToolAction = action({
  args: { actionId: v.id("toolActions") },
  handler: async (ctx, { actionId }): Promise<ExecutionResult> => {
    const session = await resolveSession(ctx);
    if (!session.ok) throw new Error(session.error);
    const { userId, tenantId } = session;
    const record = await ctx.runQuery(internal.internal.getToolActionById, { actionId });
    if (!record || record.tenantId !== tenantId) throw new Error("Action not found.");
    if (record.status !== "awaiting_confirmation") {
      return { outcome: "invalid_state", reason: "Only pending actions can be cancelled." };
    }
    await ctx.runMutation(internal.internal.patchToolAction, {
      id: actionId,
      patch: { status: "cancelled", completedAt: Date.now() },
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId,
      actorType: "user",
      actorId: userId,
      actionType: "tool_action_cancelled",
      targetType: "tool_action",
      targetId: String(actionId),
      metadata: { actionId: String(actionId) },
    });
    return { outcome: "cancelled", actionId };
  },
});
