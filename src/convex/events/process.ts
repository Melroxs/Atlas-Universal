"use node";

// ---------------------------------------------------------------------------
// Event processor.
//
//   EventRouter → EventHandler → KnowledgeUpdate → Intelligence → Optional Action
//
// Routing is registry-driven (handlerId → handler map) — never giant
// provider conditionals. Events that trigger an action go through the Phase 4
// tool runtime (policy → confirmation → execution → verification → audit);
// there is no second execution path and no confirmation bypass.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { EVENT_BY_TYPE } from "./registry";
import {
  backoffMs,
  classifyFailure,
  DEFAULT_MAX_ATTEMPTS,
  sanitizeEventError,
  type EventEnvelope,
} from "./contract";
import { validateEventPayload } from "./schema";
import { resolveEventActionPolicy, type TenantEventPolicy } from "./policy";
import { buildConfirmation, evaluateRisk } from "../tools/policy";
import { TOOL_BY_ID } from "../tools/registry";
import { validateToolInput } from "../tools/schema";
import { ToolError } from "../tools/driveClient";
import {
  driveEventHandler,
  EventError,
  type EventHandler,
  type EventHandlerCtx,
} from "./handlers/drive";

type StoredEvent = {
  _id: Id<"events">;
  tenantId: Id<"tenants">;
  eventType: string;
  provider: string;
  sourceResourceId: string;
  payload: Record<string, unknown>;
  occurredAt: number;
  connectionId: Id<"connections"> | null;
  correlationId?: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
};

/** Registry-driven dispatch — add a handler here when a new provider lands. */
const HANDLER_MAP: Record<string, EventHandler> = {
  drive: driveEventHandler,
};

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

async function routeEvent(
  ctx: ActionCtx,
  evt: StoredEvent,
): Promise<{ intelligence: Record<string, unknown>; actionId?: Id<"toolActions"> | null }> {
  const def = EVENT_BY_TYPE[evt.eventType];
  if (!def) {
    await ignore(ctx, evt, "Unknown event type — no definition registered.");
    return {
      intelligence: {
        summary: `Event "${evt.eventType}" was received but no definition is registered — ignored.`,
        whatChanged: "",
        importance: "low",
        rationale: "No event definition in the registry.",
      },
    };
  }
  if (def.implementationStatus !== "implemented") {
    await ignore(ctx, evt, `Event type "${evt.eventType}" is planned but not implemented yet.`);
    return {
      intelligence: {
        summary: `Event "${evt.eventType}" is a roadmap event — not processed.`,
        whatChanged: "",
        importance: "low",
        rationale: "Implementation status is planned.",
      },
    };
  }
  const handler = def.handlerId ? HANDLER_MAP[def.handlerId] : undefined;
  if (!handler) {
    await ignore(ctx, evt, `No handler is registered for event type "${evt.eventType}".`);
    return {
      intelligence: {
        summary: `Event "${evt.eventType}" was received but no handler exists — ignored.`,
        whatChanged: "",
        importance: "low",
        rationale: "The event registry declares the type but no handler is registered.",
      },
    };
  }

  // Payload re-validation at processing time (defense in depth).
  const payloadValidation = validateEventPayload(
    def,
    evt.payload as unknown,
  );
  if (!payloadValidation.ok) {
    await ignore(ctx, evt, `Invalid event payload: ${payloadValidation.errors.join("; ")}`);
    return {
      intelligence: {
        summary: `Event "${evt.eventType}" rejected — payload failed schema validation.`,
        whatChanged: "",
        importance: "low",
        rationale: payloadValidation.errors.join("; "),
      },
    };
  }

  const handlerCtx: EventHandlerCtx = {
    tenantId: evt.tenantId,
    eventId: evt._id,
    eventType: evt.eventType,
    sourceResourceId: evt.sourceResourceId,
    payload: payloadValidation.value,
    occurredAt: evt.occurredAt,
    connectionId: evt.connectionId,
    correlationId: evt.correlationId,
  };

  const outcome = await handler(ctx, handlerCtx);

  // Generic event → action stage (uses the Phase 4 runtime only).
  const plan = outcome.recommendation
    ? await planEventAction(ctx, evt, payloadValidation.value, outcome.recommendation)
    : {
        decision: { mode: "none" as const, reason: "No tool action is warranted for this event." },
        actionId: null as Id<"toolActions"> | null,
      };

  const intelligence: Record<string, unknown> = {
    ...outcome.intelligence,
    policyApplied: {
      eventType: evt.eventType,
      decision: plan.decision.mode,
      reason: plan.decision.reason,
    },
    recommendedAction: outcome.recommendation
      ? {
          toolId: outcome.recommendation.toolId,
          decision: plan.decision.mode,
        }
      : null,
  };

  return { intelligence, actionId: plan.actionId };
}

async function ignore(ctx: ActionCtx, evt: StoredEvent, reason: string): Promise<void> {
  await ctx.runMutation(internal.internal.patchEvent, {
    id: evt._id,
    patch: {
      status: "ignored",
      lastError: reason,
      processedAt: Date.now(),
    },
  });
}

// ---------------------------------------------------------------------------
// Event → Action (through the Phase 4 runtime — never a second path)
// ---------------------------------------------------------------------------

async function planEventAction(
  ctx: ActionCtx,
  evt: StoredEvent,
  payload: Record<string, unknown>,
  recommendation: { toolId: string; args: Record<string, string | number | boolean> },
): Promise<{
  decision: { mode: "auto" | "confirm" | "blocked" | "none"; reason: string };
  actionId: Id<"toolActions"> | null;
}> {
  const tool = TOOL_BY_ID[recommendation.toolId];
  if (!tool || tool.implementationStatus !== "implemented") {
    return {
      decision: { mode: "none", reason: `Recommended tool "${recommendation.toolId}" is not available.` },
      actionId: null,
    };
  }

  const validation = validateToolInput(tool, recommendation.args);
  if (!validation.ok) {
    return {
      decision: { mode: "none", reason: `Recommended action failed validation: ${validation.errors.join("; ")}` },
      actionId: null,
    };
  }

  const policies = await ctx.runQuery(internal.internal.getEventPoliciesByTenant, {
    tenantId: evt.tenantId,
  });
  const policy: TenantEventPolicy | null =
    policies.find((p) => p.eventType === evt.eventType) ?? null;

  const { riskLevel } = evaluateRisk(tool, validation.value);
  const decision = resolveEventActionPolicy({
    riskLevel,
    toolId: tool.id,
    policy,
  });

  if (decision.mode === "blocked") {
    return { decision, actionId: null };
  }

  const conn = evt.connectionId
    ? await ctx.runQuery(internal.internal.getConnectionById, { connectionId: evt.connectionId })
    : null;

  const base = {
    tenantId: evt.tenantId,
    toolId: tool.id,
    connectorId: evt.connectionId ?? undefined,
    input: validation.value,
    trigger: "event" as const,
    sourceEventId: evt._id,
    startedAt: Date.now(),
  };

  if (decision.mode === "auto") {
    // Approved automatically by policy — executed through the shared runtime.
    const recordId = await ctx.runMutation(internal.internal.insertToolAction, {
      ...base,
      status: "approved",
      confirmationRequired: false,
    });
    await ctx.runAction(internal.tools.execute.executeEventAction, {
      actionId: recordId,
      tenantId: evt.tenantId,
    });
    await ctx.runMutation(internal.internal.logAudit, {
      tenantId: evt.tenantId,
      actorType: "system",
      actionType: "event_action_auto_executed",
      targetType: "tool_action",
      targetId: String(recordId),
      metadata: {
        eventId: String(evt._id),
        eventType: evt.eventType,
        toolId: tool.id,
        actionId: String(recordId),
        reason: decision.reason,
      },
    });
    return { decision, actionId: recordId };
  }

  // confirm — high-risk writes and irreversible actions always land here.
  const confirmation = buildConfirmation(tool, validation.value, conn?.accountEmail);
  const recordId = await ctx.runMutation(internal.internal.insertToolAction, {
    ...base,
    status: "awaiting_confirmation",
    confirmationRequired: true,
    confirmationMessage: confirmation.message,
  });
  await ctx.runMutation(internal.internal.insertNotification, {
    tenantId: evt.tenantId,
    severity: "high",
    title: "Event-triggered action awaiting approval",
    description: `${tool.name} requested by an event (${evt.eventType}). ${confirmation.message}`,
    sourceEventId: evt._id,
    actionId: recordId,
    createdAt: Date.now(),
  });
  await ctx.runMutation(internal.internal.logAudit, {
    tenantId: evt.tenantId,
    actorType: "system",
    actionType: "event_action_proposed",
    targetType: "tool_action",
    targetId: String(recordId),
    metadata: {
      eventId: String(evt._id),
      eventType: evt.eventType,
      toolId: tool.id,
      actionId: String(recordId),
      riskLevel,
      reason: decision.reason,
    },
  });
  return { decision, actionId: recordId };
}

// ---------------------------------------------------------------------------
// Entry point — enqueued by the ingest mutation
// ---------------------------------------------------------------------------

export const processEvent = internalAction({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }): Promise<{ status: string }> => {
    const evt = (await ctx.runQuery(internal.internal.getEventById, { eventId })) as
      | StoredEvent
      | null;
    if (!evt) return { status: "missing" };
    if (evt.status === "processed" || evt.status === "ignored") {
      return { status: evt.status };
    }
    if (evt.status === "failed") return { status: "failed" }; // manual retry resets first

    const started = Date.now();
    const attempts = evt.attempts + 1;
    await ctx.runMutation(internal.internal.patchEvent, {
      id: eventId,
      patch: { status: "processing", attempts },
    });

    try {
      const outcome = await routeEvent(ctx, evt);
      await ctx.runMutation(internal.internal.patchEvent, {
        id: eventId,
        patch: {
          status: "processed",
          processedAt: Date.now(),
          processingMs: Date.now() - started,
          intelligence: outcome.intelligence,
          actionId: outcome.actionId ?? undefined,
          lastError: undefined,
        },
      });
      // Phase 6 — workflow dispatch. The orchestrator listens on processed
      // events to start or resume workflows. Best-effort: a dispatch failure
      // never fails the event itself (the event was processed successfully).
      try {
        await ctx.runAction(internal.workflows.engine.dispatchWorkflowsForEvent, {
          eventId,
        });
      } catch (e) {
        await ctx.runMutation(internal.internal.logAudit, {
          tenantId: evt.tenantId,
          actorType: "system",
          actionType: "workflow_dispatch_failed",
          targetType: "event",
          targetId: String(eventId),
          metadata: {
            eventType: evt.eventType,
            error: sanitizeEventError(e),
          },
        });
      }
      return { status: "processed" };
    } catch (e) {
      const message = sanitizeEventError(e);
      const code =
        e instanceof ToolError ? e.code : e instanceof EventError ? e.code : undefined;
      const cls = classifyFailure(e, code);
      if (cls === "retryable" && attempts < evt.maxAttempts) {
        await ctx.runMutation(internal.internal.patchEvent, {
          id: eventId,
          patch: { status: "retrying", lastError: message },
        });
        ctx.scheduler.runAfter(
          backoffMs(attempts),
          internal.events.process.processEvent,
          { eventId },
        );
        return { status: "retrying" };
      }
      await ctx.runMutation(internal.internal.patchEvent, {
        id: eventId,
        patch: {
          status: "failed",
          processedAt: Date.now(),
          processingMs: Date.now() - started,
          lastError: message,
        },
      });
      await ctx.runMutation(internal.internal.insertNotification, {
        tenantId: evt.tenantId,
        severity: "medium",
        title: "Event processing failed",
        description: `${evt.eventType}: ${message}`,
        sourceEventId: eventId,
        createdAt: Date.now(),
      });
      await ctx.runMutation(internal.internal.logAudit, {
        tenantId: evt.tenantId,
        actorType: "system",
        actionType: "event_processing_failed",
        targetType: "event",
        targetId: String(eventId),
        metadata: {
          eventType: evt.eventType,
          attempts,
          error: message,
          retryable: cls === "retryable",
        },
      });
      return { status: "failed" };
    }
  },
});

// re-export for the ingest mutation's envelope type reference
export type { EventEnvelope };
export { DEFAULT_MAX_ATTEMPTS };
