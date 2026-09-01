// ---------------------------------------------------------------------------
// Atlas Server-Native Execution
//
// The single entry point for ALL consequential action execution.
//
// This module calls the server's `atlas_action_execute` RPC which:
//   1. Authenticates the user (JWT)
//   2. Resolves tenant from JWT
//   3. Fetches action from server (not client cache)
//   4. Validates action state
//   5. Validates actor authorization
//   6. Validates confirmation
//   7. Validates freshness (fingerprint)
//   8. Validates idempotency
//   9. Executes (server-side)
//  10. Records outcome + audit trail
//  11. Returns authoritative receipt
//
// The client NEVER assumes execution succeeded unless the server confirms it.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { rpcCall } from "@/lib/actions/rpc";
import type {
  AtlasExecutableAction,
  AtlasActionResult,
  AtlasActionStatus,
} from "./execution";
import { serverRecordToAction } from "./action-rpc";
import type { PersistedAction } from "./action-persistence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Authoritative receipt returned by the server after execution */
export interface ServerExecutionReceipt {
  actionId: string;
  tenantId?: string;
  entityType?: string;
  entityId?: string;
  actionType?: string;
  status: AtlasActionStatus;
  risk?: string;
  actorId?: string;
  outcome: "executing" | "executed" | "verified" | "failed" | "blocked" | "stale";
  executedAt?: string;
  verifiedAt?: string;
  result?: Record<string, unknown>;
  error?: { message: string; code?: string };
  message: string;
  idempotent: boolean;
  auditReference?: string;
}

/** Reconciliation result for a single action */
export interface ReconciledAction {
  id: string;
  status: AtlasActionStatus;
  entityType: string;
  entityId: string;
  actionType: string;
  risk: string;
  sourceFingerprint: string | null;
  confirmationToken: string | null;
  confirmationExpiresAt: string | null;
  result: Record<string, unknown> | null;
  error: { message: string; code?: string } | null;
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
  verifiedAt: string | null;
  auditTrail: Array<{
    timestamp: string;
    from: string | null;
    to: string;
    actor: string;
    reason: string;
  }>;
}

// ---------------------------------------------------------------------------
// Server-Native Execution
// ---------------------------------------------------------------------------

/**
 * Execute an action through the server-authoritative execution boundary.
 *
 * This is the ONLY way to execute consequential actions.
 * All other execution paths (UI, voice, conversation) must converge here.
 *
 * The server:
 * - Validates everything independently
 * - Does not trust any client-provided state
 * - Returns an authoritative receipt
 *
 * If the server is unreachable or returns an error, execution is BLOCKED.
 * Execution never proceeds on trust.
 */
export async function serverNativeExecute(
  supabase: SupabaseClient,
  action: AtlasExecutableAction,
  options?: {
    confirmationToken?: string;
    currentFingerprint?: string;
  },
): Promise<{
  receipt: ServerExecutionReceipt;
  persistedAction?: PersistedAction;
}> {
  // Call the server-authoritative execute RPC
  const rawReceipt = await rpcCall(supabase, "atlas_action_execute", {
    actionId: action.id,
    actorId: action.createdBy,
    token: options?.confirmationToken ?? action.confirmationToken ?? null,
    fingerprint: options?.currentFingerprint ?? action.sourceFingerprint ?? null,
  }) as ServerExecutionReceipt;

  const receipt = rawReceipt as ServerExecutionReceipt;

  // Server returned a stale/blocked outcome — return without further processing
  if (receipt.outcome === "blocked" || receipt.outcome === "stale") {
    return { receipt };
  }

  // If the action is still in 'executing' state, we need to complete it
  // through the actual handler, then call complete_execution
  return { receipt };
}

/**
 * Complete a server execution — called after the actual operation finishes.
 * Records the final outcome server-side.
 */
export async function serverCompleteExecution(
  supabase: SupabaseClient,
  actionId: string,
  actorId: string,
  outcome: "executed" | "verified" | "failed",
  options?: {
    result?: Record<string, unknown>;
    error?: { message: string; code?: string };
    reason?: string;
  },
): Promise<ServerExecutionReceipt> {
  const receipt = await rpcCall(supabase, "atlas_action_complete_execution", {
    actionId,
    actorId,
    outcome,
    result: options?.result ?? null,
    error: options?.error ?? null,
    reason: options?.reason ?? "",
  }) as ServerExecutionReceipt;

  return receipt;
}

/**
 * Reconcile local action state with server truth.
 * Returns the authoritative server state for the given action IDs.
 *
 * This prevents the client from acting on stale cached state.
 */
export async function serverReconcileActions(
  supabase: SupabaseClient,
  actionIds: string[],
): Promise<ReconciledAction[]> {
  if (actionIds.length === 0) return [];

  const result = await rpcCall(supabase, "atlas_action_reconcile", {
    actionIds,
  }) as ReconciledAction[];

  return Array.isArray(result) ? result : [];
}

// ---------------------------------------------------------------------------
// Full Server-Executed Action Pipeline
// ---------------------------------------------------------------------------

/**
 * The complete server-authoritative execution pipeline.
 *
 * This is the recommended entry point for all consequential actions.
 * It:
 *   1. Calls atlas_action_execute (server authority check + state transition)
 *   2. If server accepts, executes through the action handler
 *   3. Calls atlas_action_complete_execution (server records outcome)
 *   4. Returns the authoritative result
 *
 * If ANY step fails, execution is blocked and the error is honest.
 */
export async function executeWithServerAuthority(
  supabase: SupabaseClient,
  action: AtlasExecutableAction,
  handler: (action: AtlasExecutableAction) => Promise<AtlasActionResult>,
  options?: {
    confirmationToken?: string;
    currentFingerprint?: string;
  },
): Promise<{
  result: AtlasActionResult;
  receipt: ServerExecutionReceipt;
}> {
  // Step 1: Server-authoritative execution request
  let receipt: ServerExecutionReceipt;
  try {
    const execResult = await serverNativeExecute(supabase, action, options);
    receipt = execResult.receipt;
  } catch (err) {
    // Server authority is unavailable — fail closed
    return {
      result: {
        actionId: action.id,
        status: "failed",
        message: "Atlas could not verify the server state. Nothing was submitted.",
        error: {
          code: "server_unavailable",
          message: err instanceof Error ? err.message : "Server authority unavailable",
          retryable: false,
        },
      },
      receipt: {
        actionId: action.id,
        status: "failed",
        outcome: "failed",
        message: "Server authority unavailable",
        idempotent: false,
      },
    };
  }

  // Step 2: If server blocked execution, return the block
  if (receipt.outcome === "blocked" || receipt.outcome === "stale") {
    return {
      result: {
        actionId: action.id,
        status: receipt.outcome === "stale" ? "stale" : "blocked",
        message: receipt.message,
      },
      receipt,
    };
  }

  // Step 3: If already executed (idempotent), return success
  if (receipt.idempotent && (receipt.outcome === "executed" || receipt.outcome === "verified")) {
    return {
      result: {
        actionId: action.id,
        status: "executed",
        message: receipt.message,
        idempotent: true,
      },
      receipt,
    };
  }

  // Step 4: Execute through the actual handler
  let handlerResult: AtlasActionResult;
  try {
    handlerResult = await handler(action);
  } catch (err) {
    // Handler failed — record failure on server
    try {
      receipt = await serverCompleteExecution(
        supabase,
        action.id,
        action.createdBy,
        "failed",
        {
          error: {
            message: err instanceof Error ? err.message : "Handler execution failed",
            code: "handler_error",
          },
          reason: "Handler execution threw an error",
        },
      );
    } catch {
      // If we can't even record the failure, still return honest failure
    }

    return {
      result: {
        actionId: action.id,
        status: "failed",
        message: err instanceof Error ? err.message : "Execution failed",
        error: {
          code: "handler_error",
          message: err instanceof Error ? err.message : "Unknown error",
          retryable: false,
        },
      },
      receipt,
    };
  }

  // Step 5: Record outcome on server
  const outcome = handlerResult.status === "executed" ? "executed" : "failed";
  try {
    receipt = await serverCompleteExecution(
      supabase,
      action.id,
      action.createdBy,
      outcome,
      {
        result: handlerResult.status === "executed"
          ? { status: "executed", message: handlerResult.message }
          : undefined,
        error: handlerResult.error
          ? { message: handlerResult.error.message, code: handlerResult.error.code }
          : undefined,
        reason: handlerResult.message,
      },
    );
  } catch {
    // Server recording failed — but handler succeeded
    // Mark as verification_pending
    handlerResult.verificationRequired = true;
  }

  return {
    result: handlerResult,
    receipt,
  };
}
