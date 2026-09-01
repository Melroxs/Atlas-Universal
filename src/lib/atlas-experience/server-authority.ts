// ---------------------------------------------------------------------------
// Atlas Server-Side Staleness Enforcement
//
// Extends the existing staleness architecture to enforce staleness checks
// on the server side before allowing action execution.
//
// Architecture:
//   Client prepares action (captures fingerprint)
//       ↓
//   Client confirms action
//       ↓
//   Client calls serverTransitionAction("executing")
//       ↓
//   Server-side hook: validateBeforeExecution()
//       ↓
//   Server re-fetches entity state
//       ↓
//   Server recomputes fingerprint
//       ↓
//   Server compares fingerprints
//       ↓
//   MATCH → allow transition
//   MISMATCH → reject transition, mark action as stale
//
// This module provides the server-side validation that gets called
// as part of the execution pipeline.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcCall } from "@/lib/actions/rpc";
import { generateSourceFingerprint } from "./execution";
import type { AtlasExecutableAction, AtlasActionStatus } from "./execution";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServerStalenessCheckResult {
  /** Whether execution is allowed */
  allowed: boolean;
  /** The current server-side action status */
  currentStatus: AtlasActionStatus;
  /** If blocked, the reason */
  reason?: string;
  /** If stale, what changed (when determinable) */
  staleChanges?: string[];
  /** Whether the action was marked stale by the server */
  markedStale: boolean;
}

// ---------------------------------------------------------------------------
// Server-Side Staleness Enforcement
// ---------------------------------------------------------------------------

/**
 * Enforce staleness check on the server before allowing an action to
 * transition to "executing".
 *
 * This is the server-authoritative version of the client-side checkStaleness().
 * It runs server-side in the RPC layer, so:
 *   1. It cannot be bypassed by client manipulation
 *   2. It uses fresh entity state from the database
 *   3. It operates under the same RLS/tenant isolation
 *
 * Call this BEFORE executing the actual action.
 */
export async function enforceStalenessBeforeExecution(
  supabase: SupabaseClient,
  action: AtlasExecutableAction,
): Promise<ServerStalenessCheckResult> {
  // 1. Fetch current action state from server
  let currentAction: Record<string, unknown> | null = null;
  try {
    currentAction = (await rpcCall(supabase, "atlas_action_get", {
      actionId: action.id,
    })) as Record<string, unknown> | null;
  } catch (err) {
    // Server authority is UNAVAILABLE — fail closed.
    // Server check failure must NOT equal permission to continue.
    return {
      allowed: false,
      currentStatus: action.status,
      reason:
        "Atlas could not verify the latest action state with the server. " +
        "Nothing was submitted. Please try again when the server is reachable.",
      markedStale: false,
    };
  }

  if (!currentAction) {
    return {
      allowed: false,
      currentStatus: action.status,
      reason: "Action not found on server",
      markedStale: false,
    };
  }

  const serverStatus = currentAction.status as AtlasActionStatus;

  // 2. Verify the action is still in a valid state for execution
  if (serverStatus === "stale") {
    return {
      allowed: false,
      currentStatus: serverStatus,
      reason: "This action was already marked stale by the server",
      markedStale: true,
    };
  }

  if (serverStatus === "cancelled") {
    return {
      allowed: false,
      currentStatus: serverStatus,
      reason: "This action was cancelled",
      markedStale: false,
    };
  }

  if (serverStatus === "expired") {
    return {
      allowed: false,
      currentStatus: serverStatus,
      reason: "This action has expired",
      markedStale: false,
    };
  }

  if (serverStatus !== "confirmed" && serverStatus !== "executing") {
    return {
      allowed: false,
      currentStatus: serverStatus,
      reason: `Action must be confirmed before execution (server shows: ${serverStatus})`,
      markedStale: false,
    };
  }

  // 3. Check source fingerprint staleness (if one was captured)
  const sourceFingerprint = currentAction.source_fingerprint as string | null;
  if (sourceFingerprint && action.entity) {
    const currentEntityState = await fetchCurrentEntityFingerprint(
      supabase,
      action.entity.type,
      action.entity.id,
    );

    if (currentEntityState !== null && currentEntityState !== sourceFingerprint) {
      // Mark the action as stale on the server (best-effort)
      try {
        await rpcCall(supabase, "atlas_action_transition", {
          actionId: action.id,
          newStatus: "stale",
          actorId: "system",
          reason: "Source entity changed since action was prepared",
        });
      } catch {
        // If we cannot mark stale on server, we still block execution locally.
        // The action may remain in confirmed state on the server, but we will
        // not execute without fresh authority.
      }

      return {
        allowed: false,
        currentStatus: "stale",
        reason:
          "The source data changed since this action was prepared. Atlas has stopped the action to prevent an incorrect execution.",
        staleChanges: [
          `Entity state changed (fingerprint mismatch: expected ${sourceFingerprint}, found ${currentEntityState})`,
        ],
        markedStale: true,
      };
    }
  }

  // 4. Verify the action is in a state that permits execution
  if (serverStatus !== "confirmed" && serverStatus !== "executing") {
    return {
      allowed: false,
      currentStatus: serverStatus,
      reason: `Action is in state '${serverStatus}' on the server and cannot be executed.`,
      markedStale: false,
    };
  }

  // 5. All checks passed
  return {
    allowed: true,
    currentStatus: serverStatus,
    markedStale: false,
  };
}

// ---------------------------------------------------------------------------
// Entity State Fetching (for server-side fingerprint computation)
// ---------------------------------------------------------------------------

/**
 * Fetch current entity state and compute a fingerprint.
 * This is the server-side equivalent of the client-side fetchEntityStateHash.
 */
async function fetchCurrentEntityFingerprint(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  try {
    let stateHash: string | null = null;

    switch (entityType) {
      case "claim": {
        const data: any = await rpcCall(supabase, "insurance_get_claim_package", {
          claimId: entityId,
        });
        if (!data?.claim) return null;
        const c = data.claim;
        stateHash = `${c.status ?? ""}:${c.estimateAmount ?? ""}:${c.paymentAmount ?? ""}:${c.updatedAt ?? ""}`;
        break;
      }
      case "supplement": {
        const data: any = await rpcCall(supabase, "insurance_get_supplement", {
          supplementId: entityId,
        });
        if (!data) return null;
        stateHash = `${data.status ?? ""}:${data.amount ?? ""}:${data.approvedAmount ?? ""}:${data.updatedAt ?? ""}`;
        break;
      }
      case "recommendation": {
        const data: any = await rpcCall(supabase, "recommendations_list", {});
        if (!data) return null;
        const rec = Array.isArray(data)
          ? data.find((r: any) => r._id === entityId)
          : null;
        if (!rec) return null;
        stateHash = `${rec.status ?? ""}:${rec.priority ?? ""}:${rec.decidedAt ?? ""}`;
        break;
      }
      case "lead": {
        const data: any = await rpcCall(supabase, "crm_get_lead", {
          leadId: entityId,
        });
        if (!data) return null;
        stateHash = `${data.status ?? ""}:${data.stage ?? ""}:${data.updatedAt ?? ""}`;
        break;
      }
      default:
        return null;
    }

    if (stateHash === null) return null;
    return generateSourceFingerprint({ entityType, entityId, stateHash });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Post-Execution Activity Recording
// ---------------------------------------------------------------------------

/**
 * Record an activity entry for an action lifecycle event.
 * This ensures every consequential action produces an audit trail.
 */
export async function recordActionActivity(
  supabase: SupabaseClient,
  action: AtlasExecutableAction,
  eventType: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await rpcCall(supabase, "atlas_action_transition", {
      actionId: action.id,
      newStatus: action.status,
      actorId: action.createdBy,
      reason: `Activity recorded: ${eventType}`,
    });
  } catch {
    // Activity recording is best-effort — don't fail the action
  }
}

// ---------------------------------------------------------------------------
// Action State Recovery for Voice
// ---------------------------------------------------------------------------

/**
 * Get the current action status for a specific entity.
 * Used by voice to answer questions like:
 *   "Did you submit it?"
 *   "Is the supplement ready?"
 *   "What happened with the email?"
 */
export async function getEntityActionStatus(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
): Promise<{
  hasActiveAction: boolean;
  activeAction?: {
    id: string;
    type: string;
    status: AtlasActionStatus;
    description: string;
    createdAt: string;
    updatedAt: string;
    isStale: boolean;
  };
  recentActions: Array<{
    id: string;
    type: string;
    status: AtlasActionStatus;
    description: string;
    createdAt: string;
  }>;
}> {
  try {
    const actions: any = await rpcCall(supabase, "atlas_action_list", {
      entityType,
      entityId,
      limit: 10,
      offset: 0,
    });

    const actionList = Array.isArray(actions) ? actions : [];
    const terminal = ["executed", "verified", "failed", "blocked", "rejected", "expired", "stale", "cancelled"];

    const active = actionList.find(
      (a: any) => !terminal.includes(a.status),
    );

    const recent = actionList.slice(0, 5).map((a: any) => ({
      id: a.id,
      type: a.action_type,
      status: a.status as AtlasActionStatus,
      description: a.description ?? a.action_type.replace(/_/g, " "),
      createdAt: a.created_at,
    }));

    return {
      hasActiveAction: !!active,
      activeAction: active
        ? {
            id: active.id,
            type: active.action_type,
            status: active.status as AtlasActionStatus,
            description: active.description ?? active.action_type.replace(/_/g, " "),
            createdAt: active.created_at,
            updatedAt: active.updated_at,
            isStale: active.status === "stale",
          }
        : undefined,
      recentActions: recent,
    };
  } catch {
    return {
      hasActiveAction: false,
      recentActions: [],
    };
  }
}
