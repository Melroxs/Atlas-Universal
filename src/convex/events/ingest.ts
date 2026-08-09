// ---------------------------------------------------------------------------
// Event ingestion validation — PURE part.
//
// The Convex ingest mutation calls these functions; unit tests exercise the
// same security logic without a database:
//
//  - tenant identity is ALWAYS resolved from the authenticated connection
//  - an external payload can never name its own tenant
//  - provider/connection cross-checks before anything is persisted
// ---------------------------------------------------------------------------

import type { EventEnvelope } from "./contract";

export interface ConnectionLike {
  _id: string;
  tenantId: string;
  provider: string;
  status?: string;
}

export interface SourceValidation {
  ok: true;
  tenantId: string;
  connection: ConnectionLike;
}
export interface SourceRejection {
  ok: false;
  reason: string;
}
export type SourceValidationResult = SourceValidation | SourceRejection;

/**
 * Resolve the event's tenant from the connection — the ONLY trusted source
 * of tenant identity. `externalTenantId` (if an external system ever sends
 * one) is a hint that must match; it is never used on its own.
 */
export function validateSourceEvent(opts: {
  envelope: EventEnvelope;
  connection: ConnectionLike | null;
  externalTenantId?: string | null;
}): SourceValidationResult {
  const { envelope, connection, externalTenantId } = opts;

  if (!connection) {
    return { ok: false, reason: "The event references a connection that no longer exists." };
  }
  if (connection.provider !== envelope.provider) {
    return {
      ok: false,
      reason: `Provider mismatch: event claims "${envelope.provider}" but connection "${connection.provider}" authenticated the source.`,
    };
  }
  if (envelope.connectionId && envelope.connectionId !== connection._id) {
    return {
      ok: false,
      reason: "The event's connection identity does not match the authenticated source.",
    };
  }
  if (externalTenantId && externalTenantId !== connection.tenantId) {
    return {
      ok: false,
      reason: "Cross-tenant event rejected: the claimed tenant does not match the authenticated connection.",
    };
  }
  if (connection.status && connection.status === "disconnected") {
    return { ok: false, reason: "The event's connection is disconnected — events are not accepted from it." };
  }
  return { ok: true, tenantId: connection.tenantId, connection };
}

/**
 * Strict cross-tenant guard: an event for tenant B must never be processed
 * under tenant A's connection, knowledge or tools.
 */
export function assertTenantMatch(
  envelopeTenantId: string,
  connection: ConnectionLike | null,
): boolean {
  if (!connection) return false;
  return envelopeTenantId === connection.tenantId;
}
