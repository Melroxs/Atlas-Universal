// ---------------------------------------------------------------------------
// Honest connector status derivation + connection sanitization.
//
// Pure module (no Convex runtime) so it can be unit-tested deterministically
// and reused by the catalog query. Status is DERIVED — never stored or faked:
// a connector only reads "connected" when a real connection exists, and only
// "healthy" after a live API test.
// ---------------------------------------------------------------------------

import type { Id } from "../_generated/dataModel";
import type { ConnectorDefinition } from "./registry";

export type ConnectorDisplayStatus =
  | "roadmap"
  | "not_configured"
  | "authorization_required"
  | "available"
  | "connected"
  | "healthy"
  | "degraded"
  | "syncing"
  | "error";

export interface ConnectorState {
  status?: string;
  healthStatus?: string;
}

export function deriveConnectorStatus(
  def: ConnectorDefinition,
  conn: ConnectorState | null,
  configured: boolean,
): ConnectorDisplayStatus {
  if (def.implementationStatus === "planned") return "roadmap";
  if (def.authType !== "none" && !configured) return "not_configured";
  if (!conn) return def.authType === "none" ? "available" : "authorization_required";
  if (conn.status === "error") return "error";
  if (conn.status === "syncing") return "syncing";
  if (conn.status === "disconnected") return "authorization_required";
  if (conn.status === "connected") {
    if (conn.healthStatus && conn.healthStatus !== "untested") {
      return conn.healthStatus === "healthy"
        ? "healthy"
        : conn.healthStatus === "degraded"
          ? "degraded"
          : conn.healthStatus === "error"
            ? "error"
            : "connected";
    }
    return "connected";
  }
  return "authorization_required";
}

/**
 * Strip a connection row for the client. `settings` carries OAuth tokens and
 * pending state and must NEVER leave the backend — it is not part of the
 * returned shape.
 */
export function sanitizeConnection(conn: {
  _id: Id<"connections">;
  name: string;
  provider: string;
  category: string;
  status: string;
  lastSyncAt?: number;
  lastError?: string;
  healthStatus?: string;
  lastTestedAt?: number;
  lastTestSuccessAt?: number;
  lastTestFailureAt?: number;
  lastTestLatencyMs?: number;
  accountName?: string;
  accountEmail?: string;
}) {
  return {
    _id: conn._id,
    name: conn.name,
    provider: conn.provider,
    category: conn.category,
    status: conn.status,
    lastSyncAt: conn.lastSyncAt ?? undefined,
    lastError: conn.lastError ?? undefined,
    healthStatus: conn.healthStatus ?? undefined,
    lastTestedAt: conn.lastTestedAt ?? undefined,
    lastTestSuccessAt: conn.lastTestSuccessAt ?? undefined,
    lastTestFailureAt: conn.lastTestFailureAt ?? undefined,
    lastTestLatencyMs: conn.lastTestLatencyMs ?? undefined,
    accountName: conn.accountName ?? undefined,
    accountEmail: conn.accountEmail ?? undefined,
  };
}
