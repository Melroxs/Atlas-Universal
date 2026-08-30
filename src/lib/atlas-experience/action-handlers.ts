// ---------------------------------------------------------------------------
// Atlas Action Handlers — Real System Integration
//
// Connects the execution layer (execution.ts) to actual Supabase RPCs.
// Every handler:
//   1. Validates authorization
//   2. Validates the transition (using existing decide.ts state machine)
//   3. Calls the real RPC
//   4. Returns a structured result
//
// NO fabrication. NO pretending. Only real backend calls.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";
import { rpcCall } from "@/lib/actions/rpc";
import {
  type RecommendationAction,
  type RecommendationStatus,
  decisionStatusFor,
  transitionError,
} from "@/lib/recommendations/decide";
import {
  type AtlasExecutableAction,
  type AtlasActionResult,
  type AtlasUserRole,
  type AtlasActionType,
  transitionAction,
  checkAuthorization,
  createSuccessResult,
  createFailureResult,
  createAction,
  generateSourceFingerprint,
  isActionStale,
  isActionExpired,
} from "./execution";
import type { AtlasEntityReference } from "./entity-reference";

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type ActionErrorCode =
  | "unauthorized"
  | "validation_error"
  | "stale_action"
  | "expired_action"
  | "duplicate_action"
  | "backend_error"
  | "integration_unavailable"
  | "verification_failed"
  | "unsupported_action"
  | "transition_error";

// ---------------------------------------------------------------------------
// Handler context
// ---------------------------------------------------------------------------

export interface ActionHandlerContext {
  /** Current user role for authorization checks */
  userRole: AtlasUserRole;
  /** User ID for audit trail */
  userId: string;
  /** Current user's display name */
  userName?: string;
  /** Workspace/tenant ID for tenant isolation */
  tenantId?: string;
  /** Company/account ID for entity context */
  companyId?: string;
}

// ---------------------------------------------------------------------------
// Recommendation Action Handlers
// ---------------------------------------------------------------------------

/**
 * Execute a recommendation action (approve/reject/dismiss/execute).
 * Uses the existing `recommendations_decide` RPC and `decide.ts` state machine.
 */
export async function handleRecommendationAction(
  action: AtlasExecutableAction,
  context: ActionHandlerContext,
): Promise<AtlasActionResult> {
  // Map our action type to the recommendation action
  const recActionMap: Partial<Record<AtlasActionType, RecommendationAction>> = {
    approve_recommendation: "approve",
    reject_recommendation: "reject",
  };

  const recAction = recActionMap[action.type];
  if (!recAction) {
    return createFailureResult(
      action.id,
      `Unsupported recommendation action: ${action.type}`,
      "unsupported_action",
    );
  }

  const recommendationId = action.parameters.recommendationId as string;
  if (!recommendationId) {
    return createFailureResult(
      action.id,
      "Missing recommendation ID",
      "validation_error",
    );
  }

  // Fetch current recommendation to check transition validity
  const supabase = getSupabaseClient();
  if (!supabase) {
    return createFailureResult(
      action.id,
      "Supabase is not configured",
      "integration_unavailable",
    );
  }

  try {
    // Get current recommendation status
    const recs = (await rpcCall(supabase, "recommendations_list")) as Array<{
      _id: string;
      status: string;
      title?: string;
    }>;

    const rec = recs.find((r) => r._id === recommendationId);
    if (!rec) {
      return createFailureResult(
        action.id,
        "Recommendation not found",
        "validation_error",
      );
    }

    // Validate the state machine transition (reuse decide.ts logic)
    const error = transitionError(recAction, rec.status as RecommendationStatus);
    if (error) {
      return createFailureResult(action.id, error, "transition_error");
    }

    // Check for stale action
    if (action.sourceFingerprint) {
      const currentFingerprint = generateSourceFingerprint({
        status: rec.status,
        title: rec.title,
      });
      if (isActionStale(action, currentFingerprint)) {
        return createFailureResult(
          action.id,
          "This recommendation has changed since the action was proposed. Please review again.",
          "stale_action",
        );
      }
    }

    // Execute the real RPC
    const targetStatus = decisionStatusFor(recAction);
    const result = await rpcCall(supabase, "recommendations_decide", {
      p_recommendationid: recommendationId,
      p_status: targetStatus,
    });

    if (result && typeof result === "object" && "error" in result) {
      return createFailureResult(
        action.id,
        String((result as Record<string, unknown>).error),
        "backend_error",
      );
    }

    return createSuccessResult(
      action.id,
      action.entity,
      `Recommendation ${recAction}d successfully`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return createFailureResult(action.id, msg, "backend_error");
  }
}

// ---------------------------------------------------------------------------
// Supplement Action Handlers
// ---------------------------------------------------------------------------

/**
 * Create a supplement for a claim.
 * Uses the existing `insurance_create_supplement` RPC.
 */
export async function handleCreateSupplement(
  action: AtlasExecutableAction,
  context: ActionHandlerContext,
): Promise<AtlasActionResult> {
  const claimId = action.parameters.claimId as string;
  if (!claimId) {
    return createFailureResult(
      action.id,
      "Missing claim ID",
      "validation_error",
    );
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return createFailureResult(
      action.id,
      "Supabase is not configured",
      "integration_unavailable",
    );
  }

  try {
    const result = await rpcCall(supabase, "insurance_create_supplement", {
      claimId,
      reason: (action.parameters.reason as string) ?? "Atlas supplement review",
      scope: action.parameters.scope ?? null,
    });

    const resultObj = result as Record<string, unknown>;
    const supplementId = (resultObj?.supplementId ?? resultObj?._id) as string | undefined;

    return createSuccessResult(
      action.id,
      action.entity,
      `Supplement created for claim ${claimId}`,
      {
        artifact: {
          supplementId,
          claimId,
          reason: action.parameters.reason,
        },
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return createFailureResult(action.id, msg, "backend_error");
  }
}

/**
 * Update supplement status.
 * Uses the existing `insurance_update_supplement_status` RPC.
 */
export async function handleUpdateSupplementStatus(
  action: AtlasExecutableAction,
  context: ActionHandlerContext,
): Promise<AtlasActionResult> {
  const supplementId = action.parameters.supplementId as string;
  const newStatus = action.parameters.status as string;

  if (!supplementId || !newStatus) {
    return createFailureResult(
      action.id,
      "Missing supplement ID or status",
      "validation_error",
    );
  }

  const validStatuses = ["draft", "review", "submitted", "approved", "rejected"];
  if (!validStatuses.includes(newStatus)) {
    return createFailureResult(
      action.id,
      `Invalid supplement status: ${newStatus}. Valid: ${validStatuses.join(", ")}`,
      "validation_error",
    );
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return createFailureResult(
      action.id,
      "Supabase is not configured",
      "integration_unavailable",
    );
  }

  try {
    await rpcCall(supabase, "insurance_update_supplement_status", {
      supplementId,
      status: newStatus,
    });

    return createSuccessResult(
      action.id,
      action.entity,
      `Supplement status updated to ${newStatus}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return createFailureResult(action.id, msg, "backend_error");
  }
}

// ---------------------------------------------------------------------------
// Email Action Handlers
// ---------------------------------------------------------------------------

/**
 * Prepare an email draft.
 * @deprecated CRM-based email prepare removed. Future Atlas email integration TBD.
 */
export async function handlePrepareEmail(
  action: AtlasExecutableAction,
  _context: ActionHandlerContext,
): Promise<AtlasActionResult> {
  return createFailureResult(
    action.id,
    "Email preparation is not available. This capability will be added through a future Atlas email integration.",
    "unsupported_action",
  );
}

/**
 * Send an email.
 * @deprecated CRM outreach-api removed. Future Atlas email integration TBD.
 */
export async function handleSendEmail(
  action: AtlasExecutableAction,
  _context: ActionHandlerContext,
): Promise<AtlasActionResult> {
  const to = action.parameters.to as string;
  if (!to) {
    return createFailureResult(
      action.id,
      "Missing required email parameters",
      "validation_error",
    );
  }
  return createFailureResult(
    action.id,
    "Email sending is not available. This capability will be added through a future Atlas email integration.",
    "unsupported_action",
  );
}

// ---------------------------------------------------------------------------
// CRM Action Handlers
// ---------------------------------------------------------------------------

/**
 * Create a CRM task for a lead.
 * Uses the existing `crm_create_task` RPC.
 */
/**
 * @deprecated CRM handlers removed. Kept as generic record handler placeholder.
 */
export async function handleGenericUpdate(
  action: AtlasExecutableAction,
  _context: ActionHandlerContext,
): Promise<AtlasActionResult> {
  return createFailureResult(
    action.id,
    "This action type is no longer supported. Please specify a claim or document action.",
    "unsupported_action",
  );
}

// ---------------------------------------------------------------------------
// Action Handler Registry
// ---------------------------------------------------------------------------

export type ActionHandler = (
  action: AtlasExecutableAction,
  context: ActionHandlerContext,
) => Promise<AtlasActionResult>;

/**
 * The canonical action handler registry.
 * Maps action types to their real implementation.
 */
const HANDLER_REGISTRY: Partial<Record<AtlasActionType, ActionHandler>> = {
  // Recommendation actions
  approve_recommendation: handleRecommendationAction,
  reject_recommendation: handleRecommendationAction,

  // Supplement actions
  prepare_supplement: handleCreateSupplement,
  submit_supplement: handleUpdateSupplementStatus,

  // Email actions
  prepare_email: handlePrepareEmail,
  send_email: handleSendEmail,

  // Generic record actions
  create_record: handleGenericUpdate,
  update_record: handleGenericUpdate,
};

/**
 * Get the handler for an action type.
 */
export function getActionHandler(actionType: AtlasActionType): ActionHandler | null {
  return HANDLER_REGISTRY[actionType] ?? null;
}

/**
 * Register a custom action handler.
 * Useful for future integrations.
 */
export function registerActionHandler(actionType: AtlasActionType, handler: ActionHandler): void {
  HANDLER_REGISTRY[actionType] = handler;
}

// ---------------------------------------------------------------------------
// Unified Action Executor
// ---------------------------------------------------------------------------

/**
 * Execute a confirmed action through the real system.
 *
 * This is the single entry point that:
 *   1. Validates the action is ready for execution
 *   2. Checks authorization
 *   3. Dispatches to the appropriate handler
 *   4. Records audit telemetry
 *   5. Returns the result
 *
 * The LLM NEVER calls this directly — only confirmed actions from the UI.
 */
export async function executeAction(
  action: AtlasExecutableAction,
  context: ActionHandlerContext,
): Promise<AtlasActionResult> {
  // 1. Validate the action is in a state ready for execution
  if (action.status !== "confirmed") {
    return createFailureResult(
      action.id,
      `Action cannot be executed in status: ${action.status}. Must be confirmed.`,
      "validation_error",
    );
  }

  // 2. Check for expiration
  if (isActionExpired(action)) {
    return createFailureResult(
      action.id,
      "This action has expired. Please propose it again.",
      "expired_action",
    );
  }

  // 3. Authorization check (defense in depth — UI should have already checked)
  const auth = checkAuthorization(action.type, context.userRole);
  if (!auth.allowed) {
    return createFailureResult(action.id, auth.reason, "unauthorized");
  }

  // 4. Get the handler
  const handler = getActionHandler(action.type);
  if (!handler) {
    return createFailureResult(
      action.id,
      `No handler registered for action type: ${action.type}`,
      "unsupported_action",
    );
  }

  // 5. Transition to executing
  let executingAction: AtlasExecutableAction;
  try {
    executingAction = transitionAction(action, "executing", context.userId, "Execution started");
  } catch (e) {
    return createFailureResult(
      action.id,
      e instanceof Error ? e.message : "Invalid state transition",
      "validation_error",
    );
  }

  // 6. Execute through the handler
  const startTime = Date.now();
  const result = await handler(action, context);
  const durationMs = Date.now() - startTime;

  // 7. Record telemetry
  try {
    const { logActionTelemetry } = await import("./execution");
    logActionTelemetry({
      event: result.status === "executed" ? "action_executed" : "action_failed",
      timestamp: new Date().toISOString(),
      actionId: action.id,
      actionType: action.type,
      entityType: action.entity.type,
      risk: action.risk,
      outcome: result.status,
      durationMs,
      errorCategory: result.error?.code,
      actor: context.userId,
    });
  } catch {
    // Telemetry failure should not block execution
  }

  return result;
}

// ---------------------------------------------------------------------------
// Preparation Handlers
// ---------------------------------------------------------------------------

/**
 * Prepare a supplement draft for a claim.
 * Returns the prepared draft without submitting it.
 */
export async function prepareSupplement(
  claimId: string,
  userRole: AtlasUserRole,
  userId: string,
  options?: {
    reason?: string;
    scope?: Record<string, unknown>;
  },
): Promise<{ action: AtlasExecutableAction; draft?: Record<string, unknown> }> {
  const action = createAction(
    "prepare_supplement",
    `Prepare supplement for claim ${claimId}`,
    `Atlas is preparing a supplement draft for this claim`,
    {
      type: "claim",
      id: claimId,
      label: `Claim #${claimId}`,
    },
    { claimId, reason: options?.reason, ...options?.scope },
    userId,
  );

  // Fetch claim data for the draft
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { action };
  }

  try {
    const pkg = (await rpcCall(supabase, "insurance_get_claim_package", {
      claimId,
    })) as Record<string, unknown> | null;

    if (!pkg) {
      return { action };
    }

    // Build a draft summary from real claim data
    const claim = pkg.claim as Record<string, unknown> | undefined;
    const supplements = (pkg.supplements ?? []) as Record<string, unknown>[];
    const findings = (pkg.findings ?? []) as Record<string, unknown>[];

    const draft = {
      claimId,
      claimNumber: claim?.claimNumber,
      status: claim?.status,
      estimateAmount: claim?.estimateAmount,
      openBalance: claim?.openBalance,
      existingSupplements: supplements.length,
      findingsCount: findings.length,
      evidenceCount: (claim?.evidenceDocumentIds as unknown[])?.length ?? 0,
      reason: options?.reason ?? "Supplement review recommended by Atlas",
    };

    // Generate source fingerprint for staleness detection
    const actionWithFingerprint = {
      ...action,
      sourceFingerprint: generateSourceFingerprint({
        status: claim?.status,
        estimateAmount: claim?.estimateAmount,
        findingsCount: findings.length,
        supplementsCount: supplements.length,
      }),
    };

    return { action: actionWithFingerprint, draft };
  } catch {
    return { action };
  }
}

/**
 * @deprecated CRM removed. Email preparation will be added through a future Atlas email integration.
 */
export async function prepareEmail(
  _leadId: string,
  _userRole: AtlasUserRole,
  _userId: string,
  _options?: {
    instruction?: string;
    tone?: "professional" | "friendly" | "direct" | "concise";
  },
): Promise<{ action: AtlasExecutableAction; draft?: Record<string, unknown> }> {
  const action = createAction(
    "prepare_email",
    `Prepare email`,
    `Atlas email preparation is not available yet`,
    {
      type: "organization",
      id: _leadId,
      label: `Email`,
    },
    {},
    _userId,
  );

  return { action };
}

/**
 * @deprecated CRM removed. This function no longer exists.
 */

// ---------------------------------------------------------------------------
// Unsupported action handler
// ---------------------------------------------------------------------------

/**
 * For action types that don't have a real backend integration yet.
 * Returns a clear "not supported" result rather than pretending it worked.
 */
export async function handleUnsupportedAction(
  action: AtlasExecutableAction,
  _context: ActionHandlerContext,
): Promise<AtlasActionResult> {
  return {
    actionId: action.id,
    status: "failed",
    message: `This action type (${action.type}) does not have a real backend integration yet. The action has been prepared but cannot be executed.`,
    error: {
      code: "unsupported_action",
      message: `No backend handler for ${action.type}`,
      retryable: false,
    },
  };
}
