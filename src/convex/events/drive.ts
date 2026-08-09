// ---------------------------------------------------------------------------
// Google Drive event mapping — PURE part.
//
// The Drive changes API is polled (honestly labeled polling — not webhooks)
// and each change is classified + normalized into an event envelope. The
// classification compares the change to Atlas's prior knowledge of the file
// (does the document exist? did parents/permissionIds change?) so event types
// reflect what actually happened.
// ---------------------------------------------------------------------------

import type { EventDefinition } from "./contract";
import {
  buildIdempotencyKey,
  type EventEnvelope,
} from "./contract";

export interface DriveChange {
  changeId?: string;
  type?: string;
  fileId?: string;
  time?: string;
  removed?: boolean;
  file?: {
    id?: string;
    name?: string;
    mimeType?: string;
    modifiedTime?: string;
    size?: number;
    trashed?: boolean;
    parents?: string[];
    permissionIds?: string[];
  } | null;
}

export interface DriveFilePriorState {
  exists: boolean;
  parents?: string[];
  permissionIds?: string[];
}

export type DriveChangeKind =
  | "file_created"
  | "file_updated"
  | "file_deleted"
  | "file_moved"
  | "permission_changed"
  | "unknown";

/**
 * Classify a Drive change against Atlas's prior knowledge of the file.
 * Honest rules only:
 *  - removed / trashed            → deleted
 *  - never seen before            → created
 *  - parents differ               → moved
 *  - permissionIds differ         → permission changed
 *  - anything else                → updated
 */
export function classifyDriveChange(
  change: DriveChange,
  prior: DriveFilePriorState,
): DriveChangeKind {
  if (change.removed === true || change.file?.trashed === true) {
    return "file_deleted";
  }
  if (!change.file || !change.file.id) {
    return change.removed ? "file_deleted" : "unknown";
  }
  if (!prior.exists) return "file_created";
  const parentsChanged =
    !!change.file.parents && !!prior.parents &&
    !sameArray(change.file.parents, prior.parents);
  if (parentsChanged) return "file_moved";
  const permsChanged =
    !!change.file.permissionIds && !!prior.permissionIds &&
    !sameArray(change.file.permissionIds, prior.permissionIds);
  if (permsChanged) return "permission_changed";
  return "file_updated";
}

function sameArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((x, i) => x === sortedB[i]);
}

/** Map a classified kind to its registered event type. */
export function driveKindToEventType(kind: DriveChangeKind): string | null {
  switch (kind) {
    case "file_created":
      return "drive.file_created";
    case "file_updated":
      return "drive.file_updated";
    case "file_deleted":
      return "drive.file_deleted";
    case "file_moved":
      return "drive.file_moved";
    case "permission_changed":
      return "drive.permission_changed";
    default:
      return null;
  }
}

/**
 * Build the normalized envelope for a Drive change. The payload is restricted
 * to safe metadata keys — never the raw provider body.
 */
export function driveChangeToEnvelope(opts: {
  connectionId: string;
  tenantId: string;
  change: DriveChange;
  kind: DriveChangeKind;
  prior: DriveFilePriorState;
  def: EventDefinition;
}): EventEnvelope | null {
  const eventType = driveKindToEventType(opts.kind);
  if (!eventType) return null;
  const changeId = opts.change.changeId ?? opts.change.fileId ?? "";
  const fileId = opts.change.file?.id ?? opts.change.fileId ?? "";
  if (!fileId) return null;

  const payload: Record<string, unknown> = { fileId, changeId };
  const file = opts.change.file;
  if (file?.name) payload.name = file.name;
  if (file?.mimeType) payload.mimeType = file.mimeType;
  if (file?.modifiedTime) payload.modifiedTime = file.modifiedTime;
  if (typeof file?.size === "number") payload.size = file.size;
  if (Array.isArray(file?.parents)) payload.parents = file.parents;
  if (opts.prior.parents && Array.isArray(file?.parents)) {
    payload.previousParents = opts.prior.parents;
  }
  if (Array.isArray(file?.permissionIds)) {
    payload.permissionIds = file.permissionIds;
  }
  if (opts.prior.permissionIds && Array.isArray(file?.permissionIds)) {
    payload.previousPermissionIds = opts.prior.permissionIds;
  }

  const occurredAt = opts.change.time ? Date.parse(opts.change.time) : Date.now();
  const receivedAt = Date.now();
  const idempotencyKey = buildIdempotencyKey({
    provider: "google_drive",
    connectionId: opts.connectionId,
    eventType,
    sourceResourceId: fileId,
    occurredAt: Number.isNaN(occurredAt) ? receivedAt : occurredAt,
    providerKey: changeId || null,
  });

  return {
    eventType,
    provider: "google_drive",
    connectorId: opts.connectionId,
    tenantId: opts.tenantId,
    connectionId: opts.connectionId,
    sourceResourceId: fileId,
    occurredAt: Number.isNaN(occurredAt) ? receivedAt : occurredAt,
    receivedAt,
    payload,
    payloadVersion: opts.def.version,
    correlationId: null,
    idempotencyKey,
    sourceMechanism: "polling",
    providerEventId: changeId || null,
  };
}

/**
 * What should happen to Atlas knowledge when this event is processed.
 * Deletion never destroys provenance — the document and its chunks are kept
 * and the source record is flagged.
 */
export function buildDriveKnowledgePlan(
  eventType: string,
  docExists: boolean,
): {
  kind: "sync" | "resync" | "remove_marker" | "metadata" | "none";
  description: string;
} {
  switch (eventType) {
    case "drive.file_created":
      return { kind: "sync", description: "New file — ingest its content into the knowledge base." };
    case "drive.file_updated":
      return docExists
        ? { kind: "resync", description: "Changed file — regenerate chunks and embeddings, preserving provenance." }
        : { kind: "sync", description: "Changed file not yet in Atlas — ingest its content." };
    case "drive.file_deleted":
      return {
        kind: "remove_marker",
        description: "Source file removed — existing knowledge is retained and flagged as deleted from the source.",
      };
    case "drive.file_moved":
      return { kind: "metadata", description: "File moved between folders — metadata updated, content unchanged." };
    case "drive.permission_changed":
      return { kind: "metadata", description: "Sharing changed — metadata recorded, content unchanged." };
    default:
      return { kind: "none", description: "No knowledge update required." };
  }
}

/**
 * The recommended tool for an event, when one exists. For Drive file events
 * the natural action is a read-only verification of the current state —
 * READ, so it may run automatically under the event policy ladder.
 */
export function recommendDriveTool(
  eventType: string,
  payload: Record<string, unknown>,
): { toolId: string; args: Record<string, string | number | boolean> } | null {
  const fileId = typeof payload.fileId === "string" ? payload.fileId : "";
  if (!fileId) return null;
  if (
    eventType === "drive.file_created" ||
    eventType === "drive.file_updated" ||
    eventType === "drive.file_moved"
  ) {
    return { toolId: "drive.get_file_metadata", args: { fileId } };
  }
  return null;
}

export function formatDriveEventTitle(
  eventType: string,
  payload: Record<string, unknown>,
): string {
  const name =
    typeof payload.name === "string" && payload.name ? `“${payload.name}”` : "a Drive file";
  switch (eventType) {
    case "drive.file_created":
      return `New file ${name} appeared`;
    case "drive.file_updated":
      return `File ${name} changed`;
    case "drive.file_deleted":
      return `File ${name} removed from Drive`;
    case "drive.file_moved":
      return `File ${name} moved between folders`;
    case "drive.permission_changed":
      return `Sharing changed on ${name}`;
    default:
      return `Drive event: ${eventType}`;
  }
}
