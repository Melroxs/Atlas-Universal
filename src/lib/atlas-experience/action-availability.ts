// ---------------------------------------------------------------------------
// Atlas Action Availability
//
// Deterministic layer that determines which actions are valid for a given
// entity state, user role, and workspace context. The model must NOT
// determine whether an action is safe — this module does.
//
// Action availability = User Permission + Entity State + Action Capability
// ---------------------------------------------------------------------------

import type { AtlasActionType, AtlasUserRole, ActionRisk, AtlasExecutableAction } from "./execution";
import { checkAuthorization, getActionRisk, createAction, alwaysRequiresConfirmation } from "./execution";
import type { AtlasEntityReference } from "./entity-reference";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionAvailability {
  /** Whether this action is currently available */
  available: boolean;
  /** Action type */
  actionType: AtlasActionType;
  /** Human-readable label */
  label: string;
  /** Description of what this action does */
  description: string;
  /** Risk level */
  risk: ActionRisk;
  /** Whether the user's role permits this action */
  authorized: boolean;
  /** Whether the entity state permits this action */
  entityPermitted: boolean;
  /** Reason if unavailable */
  reason?: string;
  /** Whether confirmation is required */
  requiresConfirmation: boolean;
}

export interface EntityActionContext {
  /** Entity type */
  entityType: AtlasEntityReference["type"];
  /** Entity ID */
  entityId: string;
  /** Entity label */
  entityLabel: string;
  /** Entity state (status, lifecycle position, etc.) */
  entityState: Record<string, unknown>;
  /** Current user role */
  userRole: AtlasUserRole;
  /** User ID */
  userId: string;
}

// ---------------------------------------------------------------------------
// Claim Actions
// ---------------------------------------------------------------------------

function getClaimActions(ctx: EntityActionContext): ActionAvailability[] {
  const state = ctx.entityState;
  const status = String(state.status ?? "opened");
  const hasSupplement = Boolean(state.hasSupplement);
  const supplementStatus = String(state.supplementStatus ?? "");
  const hasOpenFindings = Boolean(state.hasOpenFindings);
  const hasRecommendation = Boolean(state.hasRecommendation);

  const entityRef: AtlasEntityReference = {
    type: "claim",
    id: ctx.entityId,
    label: ctx.entityLabel,
  };

  const actions: ActionAvailability[] = [];

  // Review Evidence — always available if there are documents
  actions.push(makeAction("show_evidence", "Review Evidence", "View and analyze linked evidence documents", entityRef, "low", ctx.userRole, true));

  // Prepare Supplement — available when claim is open and has findings
  if (status === "opened" || status === "under_review") {
    actions.push(makeAction("prepare_supplement", "Prepare Supplement", "Create a supplement draft from claim evidence and findings", entityRef, "medium", ctx.userRole, true));
  }

  // Submit Supplement — available when supplement is ready_for_submission
  if (supplementStatus === "ready_for_submission") {
    actions.push(makeAction("submit_supplement", "Submit Supplement", "Submit the prepared supplement to the carrier", entityRef, "high", ctx.userRole, true));
  }

  // View recommendation — available when recommendation exists
  if (hasRecommendation) {
    actions.push(makeAction("show_decision", "View Recommendation", "Review the recommendation for this claim", entityRef, "low", ctx.userRole, false));
  }

  // Navigate to Ask Atlas about this claim
  actions.push(makeAction("ask_followup", "Ask Atlas", "Ask Atlas about this claim", entityRef, "low", ctx.userRole, false));

  return actions;
}

// ---------------------------------------------------------------------------
// Supplement Actions
// ---------------------------------------------------------------------------

function getSupplementActions(ctx: EntityActionContext): ActionAvailability[] {
  const state = ctx.entityState;
  const status = String(state.status ?? "draft");
  const entityRef: AtlasEntityReference = {
    type: "supplement",
    id: ctx.entityId,
    label: ctx.entityLabel,
  };

  const actions: ActionAvailability[] = [];

  // Review evidence — always available
  actions.push(makeAction("show_evidence", "Review Evidence", "View supporting evidence for this supplement", entityRef, "low", ctx.userRole, true));

  // Prepare/Re-prepare — available when draft or denied
  if (status === "draft" || status === "denied") {
    actions.push(makeAction("prepare_supplement", "Prepare Supplement", "Prepare and finalize the supplement draft", entityRef, "medium", ctx.userRole, true));
  }

  // Submit — available when ready_for_submission
  if (status === "ready_for_submission") {
    actions.push(makeAction("submit_supplement", "Submit Supplement", "Submit this supplement to the carrier", entityRef, "high", ctx.userRole, true));
  }

  // View source decision
  actions.push(makeAction("show_decision", "View Decision", "View the recommendation that prompted this supplement", entityRef, "low", ctx.userRole, false));

  // Ask Atlas
  actions.push(makeAction("ask_followup", "Ask Atlas", "Ask Atlas about this supplement", entityRef, "low", ctx.userRole, false));

  return actions;
}

// ---------------------------------------------------------------------------
// Recommendation Actions
// ---------------------------------------------------------------------------

function getRecommendationActions(ctx: EntityActionContext): ActionAvailability[] {
  const state = ctx.entityState;
  const status = String(state.status ?? "open");
  const entityRef: AtlasEntityReference = {
    type: "recommendation",
    id: ctx.entityId,
    label: ctx.entityLabel,
  };

  const actions: ActionAvailability[] = [];

  // Review evidence — always available
  actions.push(makeAction("show_evidence", "Review Evidence", "View evidence supporting this recommendation", entityRef, "low", ctx.userRole, true));

  // Approve — available when open
  if (status === "open") {
    actions.push(makeAction("approve_recommendation", "Approve", "Approve this recommendation", entityRef, "high", ctx.userRole, true));
  }

  // Reject — available when open
  if (status === "open") {
    actions.push(makeAction("reject_recommendation", "Reject", "Reject this recommendation", entityRef, "medium", ctx.userRole, true));
  }

  // View source entity
  if (state.entityType && state.entityId) {
    actions.push(makeAction("navigate", "View Entity", `Navigate to ${state.entityType}`, entityRef, "low", ctx.userRole, false));
  }

  // Ask Atlas
  actions.push(makeAction("ask_followup", "Ask Atlas", "Ask Atlas why this recommendation exists", entityRef, "low", ctx.userRole, false));

  return actions;
}



// ---------------------------------------------------------------------------
// Document Actions
// ---------------------------------------------------------------------------

function getDocumentActions(ctx: EntityActionContext): ActionAvailability[] {
  const entityRef: AtlasEntityReference = {
    type: "document",
    id: ctx.entityId,
    label: ctx.entityLabel,
  };

  const actions: ActionAvailability[] = [];

  // Review evidence — always available
  actions.push(makeAction("show_evidence", "Review Document", "View document details and extracted information", entityRef, "low", ctx.userRole, true));

  // Ask Atlas
  actions.push(makeAction("ask_followup", "Ask Atlas", "Ask Atlas about this document", entityRef, "low", ctx.userRole, false));

  return actions;
}

// ---------------------------------------------------------------------------
// Helper: create action availability entry
// ---------------------------------------------------------------------------

function makeAction(
  actionType: AtlasActionType,
  label: string,
  description: string,
  entity: AtlasEntityReference,
  risk: ActionRisk,
  userRole: AtlasUserRole,
  _requiresConfirmation: boolean,
): ActionAvailability {
  const auth = checkAuthorization(actionType, userRole);
  return {
    available: auth.allowed,
    actionType,
    label,
    description,
    risk,
    authorized: auth.allowed,
    entityPermitted: true,
    reason: auth.allowed ? undefined : auth.reason,
    requiresConfirmation: alwaysRequiresConfirmation(actionType) || risk === "high" || risk === "medium",
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Get available actions for an entity based on its state, user role,
 * and workspace context. Fully deterministic — no model involved.
 */
export function getAvailableActions(ctx: EntityActionContext): ActionAvailability[] {
  switch (ctx.entityType) {
    case "claim":
      return getClaimActions(ctx);
    case "supplement":
      return getSupplementActions(ctx);
    case "recommendation":
      return getRecommendationActions(ctx);
    case "document":
      return getDocumentActions(ctx);
    default:
      return [];
  }
}

/**
 * Filter available actions to only those the user can actually perform.
 */
export function getExecutableActions(ctx: EntityActionContext): ActionAvailability[] {
  return getAvailableActions(ctx).filter((a) => a.available);
}

/**
 * Create AtlasActionProposals from available actions for use with AtlasActionPanel.
 */
export function createActionProposals(
  ctx: EntityActionContext,
  actionTypes?: AtlasActionType[],
): Array<{
  type: AtlasActionType;
  label: string;
  entity: AtlasEntityReference;
  params?: Record<string, unknown>;
}> {
  const available = getExecutableActions(ctx);
  const filtered = actionTypes
    ? available.filter((a) => actionTypes.includes(a.actionType))
    : available;

  return filtered.map((a) => ({
    type: a.actionType,
    label: a.label,
    entity: {
      type: ctx.entityType,
      id: ctx.entityId,
      label: ctx.entityLabel,
    },
  }));
}
