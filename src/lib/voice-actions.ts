/**
 * Voice Action Executor
 *
 * Maps voice intents to existing application mutations and actions.
 * IMPORTANT: This module does NOT create parallel CRUD systems.
 *
 * All voice actions route through:
 * 1. Existing useAction() / useMutation() hooks
 * 2. Same authorization checks as UI buttons
 * 3. Same realtime update paths
 * 4. Same confirmation flows
 *
 * Voice commands are a control surface over existing architecture, not a replacement.
 */

import type { Id } from "@/lib/data-model";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VoiceActionContext {
  /** Current claim ID (if viewing a claim) */
  claimId?: string | Id<"claims">;
  /** Current workflow ID (if viewing a workflow) */
  workflowId?: string | Id<"workflows">;
  /** Current entity ID (generic) */
  entityId?: string;
}

export interface VoiceActionResult {
  /** Whether the action was executed */
  success: boolean;
  /** Human-readable message */
  message: string;
  /** Any artifact data (e.g., new supplement ID) */
  artifact?: Record<string, unknown>;
  /** Whether Atlas should speak the result */
  shouldSpeak?: boolean;
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

/**
 * Create a supplement for the current claim via voice.
 *
 * @param claimId The claim to create the supplement for
 * @param reason Optional reason/description
 * @param createSupplement The mutation function from useAction(api.supplements.create)
 */
export async function executeCreateSupplementVoice(
  claimId: Id<"claims"> | string,
  reason: string | undefined,
  createSupplement: (args: { claimId: string; reason?: string }) => Promise<unknown>
): Promise<VoiceActionResult> {
  if (!claimId) {
    return {
      success: false,
      message: "No claim is currently in focus",
      shouldSpeak: true,
    };
  }

  try {
    const result = await createSupplement({
      claimId: String(claimId),
      reason: reason ?? "Atlas supplement review",
    });

    return {
      success: true,
      message: `Supplement created for claim ${claimId}`,
      artifact: { supplementId: result },
      shouldSpeak: false, // Conversational engine speaks the result
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return {
      success: false,
      message: `Failed to create supplement: ${msg}`,
      shouldSpeak: true,
    };
  }
}

/**
 * Update a recommendation status via voice.
 * Enforces the same state machine as the UI.
 *
 * @param recommendationId The recommendation to update
 * @param action The decision action ("decided_positive", "decided_negative", "dismissed", etc.)
 * @param decideRecommendation The mutation function from useAction(api.recommendations.decide)
 */
export async function executeDecideRecommendationVoice(
  recommendationId: Id<"recommendations"> | string,
  action: string,
  decideRecommendation: (args: { recommendationId: string; action: string }) => Promise<unknown>
): Promise<VoiceActionResult> {
  if (!recommendationId) {
    return {
      success: false,
      message: "No recommendation is currently in focus",
      shouldSpeak: true,
    };
  }

  try {
    const result = await decideRecommendation({
      recommendationId: String(recommendationId),
      action,
    });

    return {
      success: true,
      message: `Recommendation ${action.replace(/_/g, " ")}`,
      artifact: { recommendationId },
      shouldSpeak: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return {
      success: false,
      message: `Failed to update recommendation: ${msg}`,
      shouldSpeak: true,
    };
  }
}

/**
 * Update a supplement status via voice.
 *
 * @param supplementId The supplement to update
 * @param newStatus The new status (e.g., "submitted", "approved", "rejected")
 * @param updateSupplementStatus The mutation function from useAction(api.supplements.updateStatus)
 */
export async function executeUpdateSupplementStatusVoice(
  supplementId: Id<"supplements"> | string,
  newStatus: string,
  updateSupplementStatus: (args: { supplementId: string; status: string }) => Promise<unknown>
): Promise<VoiceActionResult> {
  if (!supplementId) {
    return {
      success: false,
      message: "No supplement is currently in focus",
      shouldSpeak: true,
    };
  }

  try {
    const result = await updateSupplementStatus({
      supplementId: String(supplementId),
      status: newStatus,
    });

    return {
      success: true,
      message: `Supplement status updated to ${newStatus.replace(/_/g, " ")}`,
      artifact: { supplementId, status: newStatus },
      shouldSpeak: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return {
      success: false,
      message: `Failed to update supplement: ${msg}`,
      shouldSpeak: true,
    };
  }
}

/**
 * Execute a workflow action via voice.
 *
 * @param workflowId The workflow to action
 * @param actionType The action type (e.g., "start", "pause", "complete")
 * @param executeWorkflowAction The mutation function from useAction(api.workflows.executeAction)
 */
export async function executeWorkflowActionVoice(
  workflowId: Id<"workflows"> | string,
  actionType: string,
  executeWorkflowAction: (args: { workflowId: string; action: string }) => Promise<unknown>
): Promise<VoiceActionResult> {
  if (!workflowId) {
    return {
      success: false,
      message: "No workflow is currently in focus",
      shouldSpeak: true,
    };
  }

  try {
    const result = await executeWorkflowAction({
      workflowId: String(workflowId),
      action: actionType,
    });

    return {
      success: true,
      message: `Workflow ${actionType.replace(/_/g, " ")}`,
      artifact: { workflowId, action: actionType },
      shouldSpeak: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return {
      success: false,
      message: `Failed to execute workflow action: ${msg}`,
      shouldSpeak: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Common Intent → Action Mapper
//
// This maps common voice intents to actions. The backend's converse()
// endpoint returns the intent classification; we map it here to an
// appropriate action executor.
// ---------------------------------------------------------------------------

export type VoiceActionType =
  | "create_supplement"
  | "decide_recommendation"
  | "update_supplement"
  | "workflow_action";

export interface VoiceActionDispatch {
  type: VoiceActionType;
  parameters: Record<string, unknown>;
}

/**
 * Parse a conversation response's intent and pending state to determine
 * if a voice action should be executed.
 *
 * @example
 * const res = await converse({ transcript: "Create a supplement" });
 * const dispatch = intentToActionDispatch(res.intent, res.pending);
 * // → { type: "create_supplement", parameters: { claimId: "..." } }
 */
export function intentToActionDispatch(
  intent: string | undefined,
  pending?: { kind?: string; message?: string; options?: unknown[] } | null
): VoiceActionDispatch | null {
  if (!intent) return null;

  // Map intents to action types
  if (intent.includes("create_supplement") || intent.includes("supplement")) {
    return {
      type: "create_supplement",
      parameters: {},
    };
  }

  if (
    intent.includes("decide_recommendation") ||
    intent.includes("recommendation") ||
    intent.includes("positive") ||
    intent.includes("negative")
  ) {
    return {
      type: "decide_recommendation",
      parameters: {
        action: intent.includes("negative") ? "decided_negative" : "decided_positive",
      },
    };
  }

  if (intent.includes("workflow") || intent.includes("action")) {
    return {
      type: "workflow_action",
      parameters: {
        actionType: intent.replace(/workflow_/, "").replace(/_/g, " "),
      },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type { VoiceActionContext, VoiceActionResult, VoiceActionDispatch };
