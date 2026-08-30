// ---------------------------------------------------------------------------
// Atlas Conversational ↔ Execution Bridge
//
// Connects the conversational intelligence layer (Prompt 08) to the
// execution layer (Prompt 09/10). This module:
//
//   1. Takes a conversational intent + context
//   2. Resolves entity references from conversation state
//   3. Creates a proposed AtlasExecutableAction
//   4. Classifies safety and checks authorization
//   5. Prepares the action for confirmation
//   6. Returns a structured result that the UI can render
//
// The model never directly executes. The application is always the
// enforcement layer.
// ---------------------------------------------------------------------------

import {
  type AtlasExecutableAction,
  type AtlasActionType,
  type AtlasUserRole,
  type ActionRisk,
  type AtlasActionResult,
  createAction,
  checkAuthorization,
  prepareForConfirmation,
  validateConfirmation,
  generateSourceFingerprint,
  getActionRisk,
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
} from "./execution";
import {
  type AtlasConversationContext,
  type IntentClassification,
  type AtlasAnswer,
  classifyIntent,
  generateAnswer,
} from "./conversational-intelligence";
import type { AtlasEntityReference } from "./entity-reference";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of bridging a conversational turn to an action proposal */
export interface ConversationActionProposal {
  /** Whether this turn should produce an action */
  hasAction: boolean;

  /** The proposed action, if any */
  action?: AtlasExecutableAction;

  /** The conversational answer to show the user */
  answer: string;

  /** Whether confirmation is required before execution */
  requiresConfirmation: boolean;

  /** Whether the user's role permits this action */
  authorized: boolean;

  /** Authorization denial reason, if applicable */
  authorizationReason?: string;

  /** Suggested follow-up actions */
  suggestedFollowUps?: string[];
}

/** Context for resolving conversation references */
export interface ConversationResolutionContext {
  /** Current user role */
  userRole: AtlasUserRole;

  /** User ID */
  userId: string;

  /** Current entity the user is viewing */
  currentEntity?: AtlasEntityReference;

  /** Conversation context from the intelligence layer */
  conversationContext: AtlasConversationContext;
}

/** A conversation turn with execution context */
export interface ConversationTurn {
  /** User's message */
  message: string;

  /** Timestamp */
  timestamp: string;

  /** Classification of the user's intent */
  intent: IntentClassification;

  /** Proposed action, if any */
  proposal?: ConversationActionProposal;

  /** Atlas's response */
  response: string;
}

// ---------------------------------------------------------------------------
// Entity Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an entity reference from the current conversation state.
 * Uses the current entity, conversation context, and entity references
 * to resolve ambiguous references like "it", "this", "the claim", etc.
 */
export function resolveConversationEntity(
  message: string,
  context: ConversationResolutionContext,
): AtlasEntityReference | undefined {
  const lower = message.toLowerCase();

  // Explicit entity references
  const claimMatch = lower.match(/claim\s*#?\s*(\d{3,6})/i);
  if (claimMatch) {
    return {
      type: "claim",
      id: claimMatch[1],
      label: `Claim #${claimMatch[1]}`,
    };
  }

  const docMatch = lower.match(/document\s*#?\s*(\d+)/i);
  if (docMatch) {
    return {
      type: "document",
      id: docMatch[1],
      label: `Document #${docMatch[1]}`,
    };
  }

  // Pronoun / ambiguous references → use current entity
  const pronounPatterns = /\b(it|this|that|them|the (claim|supplement|document|recommendation|decision))\b/i;
  if (pronounPatterns.test(lower) && context.currentEntity) {
    return context.currentEntity;
  }

  // Use current entity as implicit reference for many queries
  if (context.currentEntity) {
    const contextPatterns = /\b(what's happening|what changed|what should|what do you|why|show me|prepare|open)\b/i;
    if (contextPatterns.test(lower)) {
      return context.currentEntity;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Action Proposal
// ---------------------------------------------------------------------------

/**
 * Bridge a conversational intent to an action proposal.
 *
 * This is the core integration point between conversation and execution.
 * It:
 *   1. Classifies the intent
 *   2. Resolves the entity
 *   3. Maps the intent to an action type
 *   4. Checks authorization
 *   5. Creates and prepares the action
 *   6. Returns the proposal with a conversational answer
 */
export function bridgeIntentToAction(
  message: string,
  context: ConversationResolutionContext,
): ConversationActionProposal {
  const intent = classifyIntent(message);
  const entity = resolveConversationEntity(message, context);

  // Not all intents produce actions
  const intentActionMap: Partial<Record<string, AtlasActionType>> = {
    focus: undefined, // Information only
    status: undefined, // Information only
    changes: undefined, // Information only
    revenue: undefined, // Information only
    attention: undefined, // Information only
    decisions: undefined, // Information only
    approvals: undefined, // Information only
    evidence: undefined, // Information only
    why: undefined, // Explanation only
    help: undefined, // Help only
    search: undefined, // Navigation only
    navigate: "navigate",
    entity: undefined, // Information only
    next: undefined, // Recommendation only
    prepare: undefined, // Handled specially below
  };

  // Handle "prepare" intent
  if (intent.intent === "prepare") {
    return bridgePrepareIntent(message, intent, entity, context);
  }

  // Handle "submit" / "send" / "approve" intents
  if (/(submit|send|approve|execute)/i.test(message)) {
    return bridgeExecuteIntent(message, intent, entity, context);
  }

  // Handle "navigate" intent
  const actionType = intentActionMap[intent.intent];
  if (actionType === "navigate" && entity) {
    const action = createAction(
      "navigate",
      `Navigate to ${entity.label}`,
      `Open ${entity.label}`,
      entity,
      { entityType: entity.type, entityId: entity.id },
      context.userId,
    );

    const auth = checkAuthorization("navigate", context.userRole);
    const prepared = prepareForConfirmation(action, DEFAULT_CONFIRMATION_TIMEOUT_MS);

    return {
      hasAction: true,
      action: prepared,
      answer: `Opening ${entity.label} for you.`,
      requiresConfirmation: false,
      authorized: auth.allowed,
    };
  }

  // For informational intents, generate an answer but no action
  const answerResult: AtlasAnswer = generateAnswer(message, context.conversationContext, intent);

  return {
    hasAction: false,
    answer: answerResult.text,
    requiresConfirmation: false,
    authorized: true,
  };
}

/**
 * Bridge a "prepare" intent to a prepare action.
 */
function bridgePrepareIntent(
  message: string,
  intent: IntentClassification,
  entity: AtlasEntityReference | undefined,
  context: ConversationResolutionContext,
): ConversationActionProposal {
  if (!entity) {
    return {
      hasAction: false,
      answer: "What would you like me to prepare? Please specify a claim or document.",
      requiresConfirmation: false,
      authorized: true,
    };
  }

  // Determine prepare type from entity
  let actionType: AtlasActionType;
  let label: string;

  if (entity.type === "claim") {
    actionType = "prepare_supplement";
    label = `Prepare supplement for ${entity.label}`;
  } else if (entity.type === "organization" && /email/i.test(message)) {
    actionType = "prepare_email";
    label = `Prepare email for ${entity.label}`;
  } else {
    actionType = "update_record";
    label = `Update ${entity.label}`;
  }

  const risk = getActionRisk(actionType);
  const auth = checkAuthorization(actionType, context.userRole);

  if (!auth.allowed) {
    return {
      hasAction: false,
      answer: `I can prepare this, but your current role doesn't have permission for this action. ${auth.reason}`,
      requiresConfirmation: false,
      authorized: false,
      authorizationReason: auth.reason,
    };
  }

  const action = createAction(
    actionType,
    label,
    `Atlas will prepare this for your review before any submission.`,
    entity,
    { entityType: entity.type, entityId: entity.id },
    context.userId,
  );

  // Source fingerprint for staleness detection
  const actionWithFingerprint = {
    ...action,
    sourceFingerprint: generateSourceFingerprint({ entityType: entity.type, entityId: entity.id }),
  };

  const prepared = prepareForConfirmation(actionWithFingerprint, DEFAULT_CONFIRMATION_TIMEOUT_MS);

  const answer = risk === "high"
    ? `I've prepared this for ${entity.label}. This is a high-risk action — nothing will be submitted without your confirmation.`
    : `I've prepared this for ${entity.label}. Please review before I proceed.`;

  return {
    hasAction: true,
    action: prepared,
    answer,
    requiresConfirmation: true,
    authorized: true,
    suggestedFollowUps: [
      `Review the ${entity.type === "claim" ? "supplement" : "draft"}`,
      `Ask why`,
    ],
  };
}

/**
 * Bridge a submit/send/approve intent to an execution action.
 */
function bridgeExecuteIntent(
  message: string,
  intent: IntentClassification,
  entity: AtlasEntityReference | undefined,
  context: ConversationResolutionContext,
): ConversationActionProposal {
  if (!entity) {
    return {
      hasAction: false,
      answer: "What would you like me to submit or approve? Please be specific.",
      requiresConfirmation: false,
      authorized: true,
    };
  }

  // Determine action type from keywords
  let actionType: AtlasActionType;
  let label: string;

  if (/submit.*supplement/i.test(message)) {
    actionType = "submit_supplement";
    label = `Submit supplement for ${entity.label}`;
  } else if (/send.*email|send.*outreach/i.test(message)) {
    actionType = "send_email";
    label = `Send email for ${entity.label}`;
  } else if (/approve.*recommendation/i.test(message)) {
    actionType = "approve_recommendation";
    label = `Approve recommendation for ${entity.label}`;
  } else if (/reject/i.test(message)) {
    actionType = "reject_recommendation";
    label = `Reject recommendation for ${entity.label}`;
  } else {
    // Default to a generic high-risk action warning
    return {
      hasAction: false,
      answer: `I can help with that. Could you be more specific about what you'd like to do with ${entity.label}?`,
      requiresConfirmation: false,
      authorized: true,
    };
  }

  const risk = getActionRisk(actionType);
  const auth = checkAuthorization(actionType, context.userRole);

  if (!auth.allowed) {
    return {
      hasAction: false,
      answer: `You don't have permission to execute this action. ${auth.reason}`,
      requiresConfirmation: false,
      authorized: false,
      authorizationReason: auth.reason,
    };
  }

  const action = createAction(
    actionType,
    label,
    `This action will be executed after your confirmation. Nothing will happen until you confirm.`,
    entity,
    { entityType: entity.type, entityId: entity.id },
    context.userId,
  );

  const prepared = prepareForConfirmation(action, DEFAULT_CONFIRMATION_TIMEOUT_MS);

  return {
    hasAction: true,
    action: prepared,
    answer: `This is a ${risk}-risk action for ${entity.label}. Please confirm before I proceed.`,
    requiresConfirmation: true,
    authorized: true,
    suggestedFollowUps: [
      "Show the evidence",
      "Ask why Atlas recommends this",
    ],
  };
}

// ---------------------------------------------------------------------------
// Voice Parity
// ---------------------------------------------------------------------------

/**
 * Process a voice command and produce the same action proposal as text.
 * This ensures voice and text share the same intelligence and execution path.
 *
 * Voice commands are normalized to text intents, then routed through
 * the same bridge. The only difference is presentation.
 */
export function processVoiceCommand(
  transcript: string,
  context: ConversationResolutionContext,
): ConversationActionProposal {
  // Normalize voice transcript
  const normalized = transcript.trim().replace(/\s+/g, " ");

  // Process through the same bridge as text
  return bridgeIntentToAction(normalized, context);
}

// ---------------------------------------------------------------------------
// Confirmation Response Handling
// ---------------------------------------------------------------------------

/**
 * Handle a user's response to a confirmation prompt.
 *
 * Supports:
 *   - Exact confirmation ("confirm", "yes, do it", "approve")
 *   - Cancellation ("cancel", "no", "never mind")
 *   - Ambiguous responses → clarification
 */
export function handleConfirmationResponse(
  response: string,
  pendingAction: AtlasExecutableAction,
): { confirmed: boolean; response: string } {
  const lower = response.toLowerCase().trim();

  // Confirmation patterns
  const confirmPatterns = /^(confirm|yes|yeah|yep|do it|go ahead|approve|proceed|confirm it)$/i;
  if (confirmPatterns.test(lower)) {
    const validation = validateConfirmation(pendingAction, pendingAction.confirmationToken ?? "");
    if (!validation.valid) {
      return {
        confirmed: false,
        response: `Cannot confirm: ${validation.reason}`,
      };
    }
    return {
      confirmed: true,
      response: "Confirmed. Executing...",
    };
  }

  // Cancellation patterns
  const cancelPatterns = /^(cancel|no|nope|never mind|nevermind|stop|abort|reject)$/i;
  if (cancelPatterns.test(lower)) {
    return {
      confirmed: false,
      response: "Action cancelled.",
    };
  }

  // Ambiguous
  return {
    confirmed: false,
    response: `Would you like to confirm or cancel the action: "${pendingAction.label}"?`,
  };
}

// ---------------------------------------------------------------------------
// Proactive Action Suggestions
// ---------------------------------------------------------------------------

/**
 * Generate proactive action suggestions based on the current context.
 * These are "Atlas noticed" → suggested actions, not automatic executions.
 */
export function generateProactiveActionSuggestions(
  context: AtlasConversationContext,
  userRole: AtlasUserRole,
): Array<{ label: string; actionType: AtlasActionType; entity?: AtlasEntityReference }> {
  const suggestions: Array<{ label: string; actionType: AtlasActionType; entity?: AtlasEntityReference }> = [];

  // Suggest next best action if available
  if (context.nextBestAction) {
    const nba = context.nextBestAction as { entity?: AtlasEntityReference; label?: string };
    if (nba.entity && nba.label) {
      suggestions.push({
        label: `Prepare ${nba.label}`,
        actionType: nba.entity.type === "claim" ? "prepare_supplement" : "update_record",
        entity: nba.entity,
      });
    }
  }

  // Suggest from pending decisions
  if (context.decisions?.pending?.length) {
    const decision = context.decisions.pending[0] as { entity?: AtlasEntityReference };
    if (decision.entity) {
      suggestions.push({
        label: `Review recommendation for ${decision.entity.label ?? "entity"}`,
        actionType: "show_decision",
        entity: decision.entity,
      });
    }
  }

  // Filter to authorized suggestions only
  return suggestions.filter((s) => checkAuthorization(s.actionType, userRole).allowed);
}
