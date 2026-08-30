// ---------------------------------------------------------------------------
// Atlas Staleness Protection
//
// Prevents execution of actions based on stale source data. Before executing
// any action, the system:
//   1. Fetches current source state
//   2. Computes current fingerprint
//   3. Compares with the fingerprint captured when the action was prepared
//   4. Blocks execution if fingerprints mismatch
//
// Architecture:
//   Action prepared (fingerprint captured)
//       ↓
//   User confirms
//       ↓
//   Before execution: checkStaleness()
//       ↓
//   MATCH → proceed
//   MISMATCH → block, explain, offer re-prepare
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AtlasActionType, AtlasExecutableAction } from "./execution";
import { generateSourceFingerprint } from "./execution";
import { rpcCall } from "@/lib/actions/rpc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StalenessCheckResult {
  /** Whether the action is stale */
  stale: boolean;
  /** Current fingerprint */
  currentFingerprint: string;
  /** Original fingerprint from the action */
  originalFingerprint: string;
  /** Human-readable explanation of what changed */
  explanation?: string;
  /** Source system that was checked */
  sourceSystem: string;
  /** When the check occurred */
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Entity State Fetchers
// ---------------------------------------------------------------------------

/**
 * Fetch current entity state for staleness fingerprinting.
 * Returns a deterministic hash of the entity's material fields.
 */
async function fetchEntityStateHash(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  try {
    switch (entityType) {
      case "claim": {
        const data: any = await rpcCall(supabase, "insurance_get_claim_package", { claimId: entityId });
        if (!data?.claim) return null;
        const c = data.claim;
        return `${c.status ?? ""}:${c.estimateAmount ?? ""}:${c.paymentAmount ?? ""}:${c.updatedAt ?? ""}:${JSON.stringify(c.evidenceSummary ?? [])}`;
      }
      case "supplement": {
        const data: any = await rpcCall(supabase, "insurance_get_supplement", { supplementId: entityId });
        if (!data) return null;
        return `${data.status ?? ""}:${data.amount ?? ""}:${data.approvedAmount ?? ""}:${data.updatedAt ?? ""}`;
      }
      case "recommendation": {
        const data: any = await rpcCall(supabase, "recommendations_list", {});
        if (!data) return null;
        const rec = Array.isArray(data) ? data.find((r: any) => r._id === entityId) : null;
        if (!rec) return null;
        return `${rec.status ?? ""}:${rec.priority ?? ""}:${rec.decidedAt ?? ""}`;
      }
      case "lead": {
        const data: any = await rpcCall(supabase, "crm_get_lead", { leadId: entityId });
        if (!data) return null;
        return `${data.status ?? ""}:${data.stage ?? ""}:${data.updatedAt ?? ""}`;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main staleness check
// ---------------------------------------------------------------------------

/**
 * Check if an action is stale before execution.
 * Returns a StalenessCheckResult indicating whether execution should proceed.
 */
export async function checkStaleness(
  supabase: SupabaseClient,
  action: AtlasExecutableAction,
): Promise<StalenessCheckResult> {
  const entityType = action.entity.type;
  const entityId = action.entity.id;
  const originalFingerprint = action.sourceFingerprint;
  const checkedAt = new Date().toISOString();

  // If no fingerprint was captured, we can't check staleness
  if (!originalFingerprint) {
    return {
      stale: false,
      currentFingerprint: "",
      originalFingerprint: "",
      sourceSystem: entityType,
      checkedAt,
    };
  }

  // Fetch current entity state
  const currentStateHash = await fetchEntityStateHash(supabase, entityType, entityId);

  if (currentStateHash === null) {
    // Cannot fetch current state — treat as potentially stale
    return {
      stale: true,
      currentFingerprint: "unknown",
      originalFingerprint,
      explanation: `Cannot verify current state of ${entityType}. The action may be stale.`,
      sourceSystem: entityType,
      checkedAt,
    };
  }

  // Compute current fingerprint (deterministic from entity state)
  const currentFingerprint = computeFingerprint(entityType, entityId, currentStateHash);

  if (currentFingerprint === originalFingerprint) {
    return {
      stale: false,
      currentFingerprint,
      originalFingerprint,
      sourceSystem: entityType,
      checkedAt,
    };
  }

  // Fingerprints differ — action is stale
  return {
    stale: true,
    currentFingerprint,
    originalFingerprint,
    explanation: `The ${entityType} changed since this action was prepared. The current state no longer matches what was analyzed.`,
    sourceSystem: entityType,
    checkedAt,
  };
}

// ---------------------------------------------------------------------------
// Fingerprint computation
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic fingerprint from entity state.
 * Wraps the execution.ts generateSourceFingerprint with a hash of the state.
 */
function computeFingerprint(entityType: string, entityId: string, stateHash: string): string {
  return generateSourceFingerprint({ entityType, entityId, stateHash });
}

// ---------------------------------------------------------------------------
// Convenience: compute fingerprint for an action before preparation
// ---------------------------------------------------------------------------

/**
 * Capture a source fingerprint for an action before it enters the confirmation queue.
 * This should be called when the action is first proposed/prepared.
 */
export async function captureSourceFingerprint(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  const stateHash = await fetchEntityStateHash(supabase, entityType, entityId);
  if (!stateHash) return null;
  return computeFingerprint(entityType, entityId, stateHash);
}

/**
 * Convenience: create an action with a captured fingerprint in one step.
 */
export async function createActionWithFingerprint(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
  entityLabel: string,
  actionType: AtlasActionType,
  description: string,
  userId: string,
  parameters?: Record<string, unknown>,
): Promise<AtlasExecutableAction & { sourceFingerprint: string }> {
  const fingerprint = await captureSourceFingerprint(supabase, entityType, entityId);

  const { createAction } = await import("./execution");
  const action = createAction(
    actionType,
    description,
    description,
    { type: entityType as any, id: entityId, label: entityLabel },
    parameters ?? {},
    userId,
  );

  return {
    ...action,
    sourceFingerprint: fingerprint ?? (action as any).sourceFingerprint ?? "",
  };
}
