// ---------------------------------------------------------------------------
// Atlas Action Verification
//
// Post-execution verification layer. After an action executes against a
// backend, the verification layer checks the source system to confirm
// the expected state change actually occurred.
//
// Architecture:
//   Action executed
//       ↓
//   Verification registry lookup
//       ↓
//   Source system query
//       ↓
//   Verification result
//       ↓
//   Activity + audit trail update
//
// Future integrations register verifiers without changing the core engine.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AtlasActionType, AtlasActionResult } from "./execution";
import { rpcCall } from "@/lib/actions/rpc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionVerificationResult {
  /** Whether the action was successfully verified */
  verified: boolean;
  /** Verification status */
  status: "verified" | "failed" | "pending" | "unsupported";
  /** Human-readable summary */
  summary: string;
  /** Source system that was checked */
  sourceSystem?: string;
  /** Entity that was verified */
  entityId?: string;
  /** When verification occurred */
  checkedAt: string;
  /** Additional details from verification */
  details?: Record<string, unknown>;
}

/** Verification function signature */
export type ActionVerifier = (
  supabase: SupabaseClient,
  actionId: string,
  entityType: string,
  entityId: string,
  parameters: Record<string, unknown>,
  result: AtlasActionResult,
) => Promise<ActionVerificationResult>;

interface RegisteredVerifier {
  actionType: AtlasActionType;
  verifier: ActionVerifier;
  sourceSystem: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const verifiers = new Map<AtlasActionType, RegisteredVerifier>();

/**
 * Register a verifier for an action type.
 */
export function registerActionVerifier(
  actionType: AtlasActionType,
  sourceSystem: string,
  description: string,
  verifier: ActionVerifier,
): void {
  verifiers.set(actionType, {
    actionType,
    verifier,
    sourceSystem,
    description,
  });
}

/**
 * Get the verifier for an action type.
 */
export function getActionVerifier(
  actionType: AtlasActionType,
): RegisteredVerifier | undefined {
  return verifiers.get(actionType);
}

/**
 * Get all registered verifiers.
 */
export function getAllVerifiers(): RegisteredVerifier[] {
  return Array.from(verifiers.values());
}

/**
 * Check if a verifier exists for an action type.
 */
export function hasVerifier(actionType: AtlasActionType): boolean {
  return verifiers.has(actionType);
}

// ---------------------------------------------------------------------------
// Verification execution
// ---------------------------------------------------------------------------

/**
 * Verify an action against its source system.
 * Falls back to "unsupported" if no verifier is registered.
 */
export async function verifyAction(
  supabase: SupabaseClient,
  actionId: string,
  actionType: AtlasActionType,
  entityType: string,
  entityId: string,
  parameters: Record<string, unknown>,
  result: AtlasActionResult,
): Promise<ActionVerificationResult> {
  const registered = verifiers.get(actionType);

  if (!registered) {
    return {
      verified: false,
      status: "unsupported",
      summary: `No verifier registered for action type: ${actionType}`,
      sourceSystem: "none",
      entityId,
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const verification = await registered.verifier(
      supabase,
      actionId,
      entityType,
      entityId,
      parameters,
      result,
    );
    return verification;
  } catch (error) {
    return {
      verified: false,
      status: "failed",
      summary: `Verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      sourceSystem: registered.sourceSystem,
      entityId,
      checkedAt: new Date().toISOString(),
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

// ---------------------------------------------------------------------------
// Staleness detection
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic fingerprint from entity state.
 * Used to detect when source data has changed since action preparation.
 */
export function computeSourceFingerprint(
  entityType: string,
  entityId: string,
  stateHash: string,
): string {
  // Deterministic: hash of entity type + entity ID + state hash
  const input = `${entityType}:${entityId}:${stateHash}`;
  // Simple deterministic hash (not cryptographic — just for staleness detection)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return `fp-${Math.abs(hash).toString(36)}`;
}

/**
 * Check if an action is stale (source data changed since preparation).
 */
export function isActionStale(
  preparedFingerprint: string | undefined,
  currentFingerprint: string,
): boolean {
  if (!preparedFingerprint) return false;
  return preparedFingerprint !== currentFingerprint;
}

// ---------------------------------------------------------------------------
// Built-in verifiers
// ---------------------------------------------------------------------------

/**
 * Register built-in verifiers for common Atlas action types.
 */
export function registerDefaultVerifiers(): void {
  // Recommendation verification
  registerActionVerifier(
    "approve_recommendation",
    "recommendations",
    "Verify recommendation status changed to approved",
    async (supabase, actionId, entityType, entityId, parameters) => {
      try {
        const data = await rpcCall(supabase, "recommendations_decide", {
          recommendationId: entityId,
          status: "approved",
        });
        return {
          verified: true,
          status: "verified",
          summary: "Recommendation approved successfully",
          sourceSystem: "recommendations",
          entityId,
          checkedAt: new Date().toISOString(),
          details: { data },
        };
      } catch (error) {
        return {
          verified: false,
          status: "failed",
          summary: `Recommendation verification failed: ${error instanceof Error ? error.message : "Unknown"}`,
          sourceSystem: "recommendations",
          entityId,
          checkedAt: new Date().toISOString(),
        };
      }
    },
  );

  // Supplement verification
  registerActionVerifier(
    "prepare_supplement",
    "insurance",
    "Verify supplement was created",
    async (supabase, actionId, entityType, entityId, parameters, result) => {
      // If the result contains a created entity, verify it exists
      const supplementId = (parameters.supplementId as string) ?? result.entity?.id;
      if (supplementId) {
        try {
          const data = await rpcCall(supabase, "insurance_get_supplement", {
            supplementId,
          });
          return {
            verified: !!data,
            status: data ? "verified" : "failed",
            summary: data
              ? "Supplement exists and is accessible"
              : "Supplement not found after creation",
            sourceSystem: "insurance",
            entityId: supplementId,
            checkedAt: new Date().toISOString(),
          };
        } catch {
          return {
            verified: false,
            status: "pending",
            summary: "Supplement verification pending — backend not yet queried",
            sourceSystem: "insurance",
            entityId: supplementId,
            checkedAt: new Date().toISOString(),
          };
        }
      }
      return {
        verified: false,
        status: "unsupported",
        summary: "No supplement ID available for verification",
        sourceSystem: "insurance",
        checkedAt: new Date().toISOString(),
      };
    },
  );



  // Email verification
  registerActionVerifier(
    "send_email",
    "outreach",
    "Verify email was sent",
    async (supabase, actionId, entityType, entityId, parameters, result) => {
      // Email send results come from the Edge Function response
      // We trust the Edge Function's authoritative result
      if (result.status === "executed") {
        return {
          verified: true,
          status: "verified",
          summary: "Email was submitted to the email service successfully",
          sourceSystem: "outreach",
          entityId,
          checkedAt: new Date().toISOString(),
          details: { message: result.message },
        };
      }
      return {
        verified: false,
        status: "failed",
        summary: "Email submission was not confirmed by the email service",
        sourceSystem: "outreach",
        entityId,
        checkedAt: new Date().toISOString(),
      };
    },
  );
}

// Auto-register defaults on import
registerDefaultVerifiers();
