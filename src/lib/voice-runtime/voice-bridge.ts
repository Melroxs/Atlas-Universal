// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Voice-AI Bridge
//
// Connects voice transcripts to Atlas AI Runtime. Handles:
//   - Intent classification
//   - Conversational context management
//   - AI task routing
//   - Safety gate integration
//   - Response generation
//
// Architecture:
//   User speech → STT → Voice Bridge → Atlas AI Runtime → grounded response → TTS
// ---------------------------------------------------------------------------

import type { VoiceIntent, VoiceIntentEntity, VoiceIntentCategory } from "./intent-router";
import { classifyVoiceIntent } from "./intent-router";
import {
  checkConfirmationRequired,
  confirmLatestPending,
  confirmAction,
  rejectAction,
  getPendingConfirmations,
  type PendingConfirmation,
} from "./safety";

// ---------------------------------------------------------------------------
// Bridge types
// ---------------------------------------------------------------------------

export interface VoiceBridgeConfig {
  /** Maximum conversation history to maintain. */
  maxHistoryTurns: number;
  /** Default entity context (current page/entity). */
  defaultEntityContext?: string;
  /** Default page context. */
  defaultPageContext?: string;
}

export const DEFAULT_VOICE_BRIDGE_CONFIG: VoiceBridgeConfig = {
  maxHistoryTurns: 20,
};

export interface VoiceBridgeTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  intent?: VoiceIntent;
  timestamp: number;
  entities: VoiceIntentEntity[];
}

export interface VoiceBridgeResult {
  /** The classified intent. */
  intent: VoiceIntent;
  /** Whether this requires confirmation. */
  requiresConfirmation: boolean;
  /** Confirmation prompt (if requiresConfirmation). */
  confirmationPrompt?: string;
  /** Confirmation ID (if pending). */
  confirmationId?: string;
  /** The AI task to route to. */
  atlasTask?: string;
  /** Action ID (for action intents). */
  actionId?: string;
  /** Entities extracted. */
  entities: VoiceIntentEntity[];
  /** Whether this is a follow-up question (uses conversation context). */
  isFollowUp: boolean;
  /** Conversation history for context. */
  conversationHistory: Array<{ role: "user" | "model"; text: string }>;
}

export interface VoiceBridgeResponse {
  /** The AI-generated answer text. */
  answer: string;
  /** The spoken version (for TTS). */
  spoken: string;
  /** Intent classification. */
  intent: VoiceIntent;
  /** Evidence grounding info. */
  evidence?: Array<Record<string, unknown>>;
  /** Authority answers. */
  authorityAnswers?: Array<Record<string, unknown>>;
  /** Entity references. */
  entityRefs?: Array<{ id: string; name: string; entityTypeKey?: string; status?: string }>;
  /** Suggested follow-up actions. */
  suggestedActions?: string[];
  /** Limitations of the response. */
  limitations?: string;
  /** Whether an action was triggered. */
  actionTriggered?: string;
  /** Action result (if applicable). */
  actionResult?: {
    success: boolean;
    message: string;
    requiresConfirmation?: boolean;
    confirmationPrompt?: string;
    confirmationId?: string;
  };
}

// ---------------------------------------------------------------------------
// Voice Bridge singleton
// ---------------------------------------------------------------------------

let _config: VoiceBridgeConfig = { ...DEFAULT_VOICE_BRIDGE_CONFIG };
let _conversationHistory: VoiceBridgeTurn[] = [];
let _sessionEntityContext: string | undefined;
let _sessionPageContext: string | undefined;

/**
 * Initialize the Voice-AI Bridge.
 */
export function initVoiceBridge(config?: Partial<VoiceBridgeConfig>): void {
  if (config) {
    _config = { ...DEFAULT_VOICE_BRIDGE_CONFIG, ...config };
  }
  _conversationHistory = [];
  _sessionEntityContext = _config.defaultEntityContext;
  _sessionPageContext = _config.defaultPageContext;
}

/**
 * Reset the bridge (for testing or new session).
 */
export function resetVoiceBridge(): void {
  _conversationHistory = [];
  _sessionEntityContext = undefined;
  _sessionPageContext = undefined;
}

/**
 * Set entity context for the current session.
 */
export function setEntityContext(entityId: string | undefined): void {
  _sessionEntityContext = entityId;
}

/**
 * Set page context for the current session.
 */
export function setPageContext(pageContext: string | undefined): void {
  _sessionPageContext = pageContext;
}

// ---------------------------------------------------------------------------
// Intent processing
// ---------------------------------------------------------------------------

/**
 * Process a voice transcript through the intent router and safety gates.
 *
 * Returns a VoiceBridgeResult that the caller uses to:
 * 1. Send to Atlas AI Runtime for generation
 * 2. Handle confirmation if needed
 * 3. Execute actions after confirmation
 */
export function processVoiceTranscript(transcript: string): VoiceBridgeResult {
  const normalized = transcript.trim();
  if (!normalized) {
    return {
      intent: classifyVoiceIntent(""),
      requiresConfirmation: false,
      entities: [],
      isFollowUp: false,
      conversationHistory: [],
    };
  }

  // Classify intent
  const intent = classifyVoiceIntent(normalized);

  // Check if this is a confirmation/rejection of a pending action
  const confirmationResult = handleConfirmationIntent(normalized, intent);
  if (confirmationResult) {
    return confirmationResult;
  }

  // Check if this is a repeat request
  if (intent.actionId === "replay_last_response") {
    return {
      intent,
      requiresConfirmation: false,
      atlasTask: intent.atlasTask,
      actionId: intent.actionId,
      entities: intent.entities,
      isFollowUp: false,
      conversationHistory: buildConversationHistory(),
    };
  }

  // Check if this is an interruption
  if (intent.id === "stop") {
    return {
      intent,
      requiresConfirmation: false,
      entities: [],
      isFollowUp: false,
      conversationHistory: [],
    };
  }

  // Check safety gates for action intents
  if (intent.actionId) {
    const safetyCheck = checkConfirmationRequired(
      intent.actionId,
      intent.name,
      intent.category === "action" ? "high_risk_write" : "low_risk_write",
      buildActionParams(intent),
      {
        tenantId: "current",
        userId: null,
        entityContextId: _sessionEntityContext,
        pageContext: _sessionPageContext,
        sessionId: _sessionEntityContext,
      },
    );

    if (safetyCheck.required) {
      return {
        intent,
        requiresConfirmation: true,
        confirmationPrompt: safetyCheck.prompt,
        confirmationId: safetyCheck.confirmationId,
        atlasTask: intent.atlasTask,
        actionId: intent.actionId,
        entities: intent.entities,
        isFollowUp: checkIsFollowUp(intent),
        conversationHistory: buildConversationHistory(),
      };
    }
  }

  // Determine if this is a follow-up question
  const isFollowUp = checkIsFollowUp(intent);

  // Add to conversation history
  addToHistory({
    id: `vb-${Date.now()}`,
    role: "user",
    text: normalized,
    intent,
    timestamp: Date.now(),
    entities: intent.entities,
  });

  return {
    intent,
    requiresConfirmation: false,
    atlasTask: intent.atlasTask,
    actionId: intent.actionId,
    entities: intent.entities,
    isFollowUp,
    conversationHistory: buildConversationHistory(),
  };
}

/**
 * Handle a response from Atlas AI Runtime and add it to conversation history.
 */
export function handleAiResponse(response: VoiceBridgeResponse): void {
  addToHistory({
    id: `vb-a-${Date.now()}`,
    role: "assistant",
    text: response.answer,
    intent: response.intent,
    timestamp: Date.now(),
    entities: [],
  });
}

// ---------------------------------------------------------------------------
// Confirmation handling
// ---------------------------------------------------------------------------

function handleConfirmationIntent(
  transcript: string,
  intent: VoiceIntent,
): VoiceBridgeResult | null {
  const low = transcript.toLowerCase().trim();

  // Check for confirmation patterns
  const isConfirm = /^(?:yes|yeah|yep|yup|confirm|proceed|go ahead|do it|send it|that's right|correct)\s*[!.]?$/.test(low);
  const isReject = /^(?:no|nope|nah|cancel|never ?mind|stop|don't|don't do it|abort)\s*[!.]?$/.test(low);

  if (!isConfirm && !isReject) return null;

  // Find the most recent pending confirmation
  const pending = getPendingConfirmations(_sessionEntityContext ?? "unknown");
  if (pending.length === 0) return null;

  const latest = pending[pending.length - 1]!;

  if (isConfirm) {
    const confirmed = confirmAction(latest.id);
    if (confirmed) {
      return {
        intent,
        requiresConfirmation: false,
        atlasTask: confirmed.actionId,
        actionId: confirmed.actionId,
        entities: confirmed.params.claimId
          ? [{ type: "claim_id", value: String(confirmed.params.claimId), confidence: 1.0 }]
          : [],
        isFollowUp: false,
        conversationHistory: buildConversationHistory(),
      };
    }
  } else {
    rejectAction(latest.id);
    return {
      intent: classifyVoiceIntent(""),
      requiresConfirmation: false,
      entities: [],
      isFollowUp: false,
      conversationHistory: buildConversationHistory(),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildConversationHistory(): Array<{ role: "user" | "model"; text: string }> {
  return _conversationHistory
    .slice(-_config.maxHistoryTurns)
    .map((turn) => ({
      role: turn.role === "user" ? ("user" as const) : ("model" as const),
      text: turn.text,
    }));
}

function addToHistory(turn: VoiceBridgeTurn): void {
  _conversationHistory.push(turn);
  if (_conversationHistory.length > _config.maxHistoryTurns) {
    _conversationHistory = _conversationHistory.slice(-_config.maxHistoryTurns);
  }
}

function checkIsFollowUp(intent: VoiceIntent): boolean {
  if (_conversationHistory.length === 0) return false;

  // Pronouns and references suggest follow-up
  const followUpPatterns = /\b(it|its|that|those|this|them|they|he|she|the (?:claim|document|evidence|supplement))/i;
  return followUpPatterns.test(intent.transcript);
}

function buildActionParams(intent: VoiceIntent): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  // Extract claim ID from entities
  const claimEntity = intent.entities.find((e) => e.type === "claim_id");
  if (claimEntity) {
    params.claimId = claimEntity.value;
  }

  // Extract reason from transcript (for supplement creation)
  if (intent.id === "create_supplement") {
    const reasonMatch = intent.transcript.match(
      /(?:because|reason|for|due to|since)\s+(.+?)(?:\.|$)/i,
    );
    if (reasonMatch) {
      params.reason = reasonMatch[1]!.trim();
    }
  }

  return params;
}

/**
 * Get current conversation history (for diagnostics).
 */
export function getConversationHistory(): VoiceBridgeTurn[] {
  return [..._conversationHistory];
}

/**
 * Get pending confirmations (for UI).
 */
export function getCurrentPendingConfirmations(): PendingConfirmation[] {
  return getPendingConfirmations(_sessionEntityContext ?? "unknown");
}
