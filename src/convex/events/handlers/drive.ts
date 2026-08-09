"use node";

// ---------------------------------------------------------------------------
// Google Drive event handler — the first real event processor.
//
// An event arriving here is a REAL change observed through the Drive changes
// API (honest polling). The handler updates Atlas knowledge through the SAME
// ingestion pipeline as manual uploads and the sync sweep:
//
//   file created/updated → syncDriveFile (download → parse → chunks → embeddings)
//   file deleted         → keep the document + provenance, flag external removal
//   file moved           → record new parents, no content re-ingest
//   permission changed   → record permission ids, no content re-ingest
//
// It never calls external APIs for ACTIONS — the recommended verification
// tool is handed back to the generic action stage, which routes through the
// Phase 4 tool runtime.
// ---------------------------------------------------------------------------

import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import { syncDriveFile, type DriveFileLike } from "../../connectionsSync";
import { ensureDriveAccessToken, ToolError } from "../../tools/driveClient";
import { recommendDriveTool, buildDriveKnowledgePlan, formatDriveEventTitle } from "../drive";

export interface EventHandlerCtx {
  tenantId: Id<"tenants">;
  eventId: Id<"events">;
  eventType: string;
  sourceResourceId: string;
  payload: Record<string, unknown>;
  occurredAt: number;
  connectionId: Id<"connections"> | null;
  correlationId?: string | null;
}

export interface EventOutcome {
  intelligence: Record<string, unknown>;
  /** Provider-specific recommended verification/action tool (READ by default). */
  recommendation?: { toolId: string; args: Record<string, string | number | boolean> } | null;
}

export type EventHandler = (
  ctx: ActionCtx,
  evt: EventHandlerCtx,
) => Promise<EventOutcome>;

/** Sanitized handler error — never raw provider bodies. */
export class EventError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "EventError";
  }
}

function str(payload: Record<string, unknown>, key: string): string | undefined {
  return typeof payload[key] === "string" ? (payload[key] as string) : undefined;
}

function num(payload: Record<string, unknown>, key: string): number | undefined {
  return typeof payload[key] === "number" ? (payload[key] as number) : undefined;
}

function strArray(payload: Record<string, unknown>, key: string): string[] {
  return Array.isArray(payload[key]) ? (payload[key] as string[]) : [];
}

export const driveEventHandler: EventHandler = async (ctx, evt) => {
  // 1. Connection + tenant isolation — re-verified at processing time, never
  //    trusted from the envelope alone.
  if (!evt.connectionId) {
    throw new EventError("missing_connection", "Drive event has no connection.");
  }
  const conn = await ctx.runQuery(internal.internal.getConnectionById, {
    connectionId: evt.connectionId,
  });
  if (!conn || conn.tenantId !== evt.tenantId) {
    throw new EventError(
      "unauthorized_connection",
      "The event's connection does not belong to this tenant.",
    );
  }
  if (conn.provider !== "google_drive") {
    throw new EventError("provider_mismatch", "Handler is not valid for this provider.");
  }

  // 2. Server-side token access — never leaves the backend.
  const accessToken = await ensureDriveAccessToken(ctx, conn);

  // 3. Resolve Atlas's prior knowledge of the resource.
  const fileId = evt.sourceResourceId;
  const existingDoc = await ctx.runQuery(internal.internal.getDocBySource, {
    tenantId: evt.tenantId,
    sourceId: fileId,
  });

  // 4. Knowledge plan + execution.
  const plan = buildDriveKnowledgePlan(evt.eventType, !!existingDoc);
  const payload = evt.payload;
  let knowledgeNote: string | null = null;

  if (plan.kind === "sync" || plan.kind === "resync") {
    const file: DriveFileLike = {
      id: fileId,
      name: str(payload, "name") ?? `file-${fileId.slice(0, 12)}`,
      mimeType: str(payload, "mimeType") ?? "text/plain",
      modifiedTime: str(payload, "modifiedTime"),
      size: num(payload, "size"),
    };
    const outcome = await syncDriveFile(ctx, {
      tenantId: evt.tenantId,
      connId: conn._id,
      accessToken,
      file,
      existingDoc,
      actorUserId: null,
    });
    if (outcome.ingested) {
      knowledgeNote = plan.kind === "resync"
        ? "Content re-synced — chunks and embeddings regenerated; prior provenance preserved."
        : "Content ingested into the knowledge base.";
    } else {
      knowledgeNote = outcome.reason ?? "Skipped.";
    }
    // Record the latest external state for future change classification.
    const parents = strArray(payload, "parents");
    const permissionIds = strArray(payload, "permissionIds");
    if (existingDoc) {
      await ctx.runMutation(internal.internal.patchDoc, {
        id: existingDoc._id,
        patch: {
          externalDeletedAt: undefined,
          ...(parents.length > 0 ? { externalParents: parents } : {}),
          ...(permissionIds.length > 0 ? { externalPermissionIds: permissionIds } : {}),
        },
      });
    }
  } else if (plan.kind === "remove_marker") {
    if (existingDoc) {
      await ctx.runMutation(internal.internal.patchDoc, {
        id: existingDoc._id,
        patch: { externalDeletedAt: evt.occurredAt },
      });
      knowledgeNote =
        "Source file removed — the document and its provenance are retained, flagged as deleted from the source.";
    } else {
      knowledgeNote = "Source file removed — no matching Atlas document existed.";
    }
  } else if (plan.kind === "metadata") {
    if (existingDoc) {
      const parents = strArray(payload, "parents");
      const permissionIds = strArray(payload, "permissionIds");
      await ctx.runMutation(internal.internal.patchDoc, {
        id: existingDoc._id,
        patch: {
          ...(parents.length > 0 ? { externalParents: parents } : {}),
          ...(permissionIds.length > 0 ? { externalPermissionIds: permissionIds } : {}),
        },
      });
    }
    knowledgeNote = "Metadata recorded — content unchanged, no re-ingest needed.";
  }

  // 5. Structured intelligence — human-readable, evidence-linked, no hidden
  //    reasoning. (Policy/action decision is merged by the processor.)
  const importance =
    evt.eventType === "drive.file_deleted"
      ? "high"
      : evt.eventType === "drive.file_created" || evt.eventType === "drive.file_updated"
        ? "medium"
        : "low";

  const intelligence: Record<string, unknown> = {
    summary: formatDriveEventTitle(evt.eventType, payload),
    whatChanged: plan.description,
    importance,
    knowledgeUpdate: knowledgeNote ?? plan.description,
    affectedEntities: existingDoc
      ? await collectAffectedEntities(ctx, evt.tenantId, existingDoc._id)
      : [],
    evidenceRefs: existingDoc
      ? [{ kind: "document", documentId: existingDoc._id, title: existingDoc.title }]
      : [],
    rationale:
      "Atlas processed this change against the authenticated connection and the event registry, " +
      "updating knowledge through the standard ingestion pipeline. No hidden reasoning.",
  };

  // 6. Recommended verification/action (READ by default — safe to auto-run).
  const recommendation = recommendDriveTool(evt.eventType, payload);

  return { intelligence, recommendation };
};

async function collectAffectedEntities(
  ctx: ActionCtx,
  tenantId: Id<"tenants">,
  documentId: Id<"documents">,
): Promise<Array<{ entityId: string; name: string; entityTypeKey: string }>> {
  const entities = await ctx.runQuery(internal.internal.listEntitiesByTenant, {
    tenantId,
  });
  return entities
    .filter((e) => e.sourceDocumentId === documentId)
    .slice(0, 5)
    .map((e) => ({
      entityId: String(e._id),
      name: e.name,
      entityTypeKey: e.entityTypeKey,
    }));
}

export { ToolError };
