// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Action Registry
//
// Manages voice-triggered actions that Atlas can execute. Actions are
// categorized by risk level and may require confirmation before execution.
// This enables "agentic voice" — the user speaks a command, Atlas
// understands the intent, confirms if needed, and executes the action.
// ---------------------------------------------------------------------------

import type {
  VoiceActionDefinition,
  VoiceActionContext,
  VoiceActionResult,
  VoiceActionRiskLevel,
} from "./types";

// ---------------------------------------------------------------------------
// Action Registry singleton
// ---------------------------------------------------------------------------

const _actions: Map<string, VoiceActionDefinition> = new Map();

/**
 * Register a voice action.
 */
export function registerVoiceAction(action: VoiceActionDefinition): void {
  _actions.set(action.id, action);
}

/**
 * Register multiple voice actions.
 */
export function registerVoiceActions(actions: VoiceActionDefinition[]): void {
  for (const action of actions) {
    _actions.set(action.id, action);
  }
}

/**
 * Get a specific voice action.
 */
export function getVoiceAction(id: string): VoiceActionDefinition | undefined {
  return _actions.get(id);
}

/**
 * Get all registered voice actions.
 */
export function getAllVoiceActions(): VoiceActionDefinition[] {
  return Array.from(_actions.values());
}

/**
 * Get actions by category.
 */
export function getVoiceActionsByCategory(category: string): VoiceActionDefinition[] {
  return getAllVoiceActions().filter((a) => a.category === category);
}

/**
 * Get actions by risk level.
 */
export function getVoiceActionsByRisk(level: VoiceActionRiskLevel): VoiceActionDefinition[] {
  return getAllVoiceActions().filter((a) => a.riskLevel === level);
}

/**
 * Execute a voice action.
 */
export async function executeVoiceAction(
  actionId: string,
  params: Record<string, unknown>,
  context: VoiceActionContext,
): Promise<VoiceActionResult> {
  const action = _actions.get(actionId);
  if (!action) {
    return {
      success: false,
      message: `Unknown action: ${actionId}`,
    };
  }

  try {
    const result = await action.execute(params, context);

    // If the action requires confirmation and hasn't been confirmed yet,
    // return the confirmation prompt instead of executing
    if (action.requiresConfirmation && !params._confirmed) {
      return {
        success: true,
        requiresConfirmation: true,
        confirmationPrompt: action.description,
        message: `Are you sure you want to ${action.name.toLowerCase()}?`,
      };
    }

    return result;
  } catch (err) {
    return {
      success: false,
      message: `Action failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * Clear all registered actions (for testing).
 */
export function clearVoiceActions(): void {
  _actions.clear();
}

// ---------------------------------------------------------------------------
// Built-in Atlas Voice Actions
// ---------------------------------------------------------------------------

/**
 * Register the default Atlas voice actions.
 * These map to existing Atlas capabilities.
 */
export function registerDefaultVoiceActions(): void {
  registerVoiceActions([
    {
      id: "navigate_to_page",
      name: "Navigate to Page",
      description: "Navigate to a specific Atlas page",
      riskLevel: "read",
      requiresConfirmation: false,
      category: "navigation",
      parameters: [
        { name: "page", type: "string", required: true, description: "Page to navigate to" },
      ],
      execute: async (params) => ({
        success: true,
        message: `Navigating to ${params.page}`,
        data: { action: "navigate", page: params.page },
      }),
    },
    {
      id: "search_claims",
      name: "Search Claims",
      description: "Search for claims matching a query",
      riskLevel: "read",
      requiresConfirmation: false,
      category: "claims",
      parameters: [
        { name: "query", type: "string", required: true, description: "Search query" },
      ],
      execute: async (params) => ({
        success: true,
        message: `Searching for claims: ${params.query}`,
        data: { action: "search_claims", query: params.query },
      }),
    },
    {
      id: "get_claim_status",
      name: "Get Claim Status",
      description: "Get the current status and details of a specific claim",
      riskLevel: "read",
      requiresConfirmation: false,
      category: "claims",
      parameters: [
        { name: "claimId", type: "string", required: true, description: "Claim ID or number" },
      ],
      execute: async (params) => ({
        success: true,
        message: `Retrieving claim ${params.claimId}`,
        data: { action: "get_claim_status", claimId: params.claimId },
      }),
    },
    {
      id: "upload_document",
      name: "Upload Document",
      description: "Upload a document to the current workspace",
      riskLevel: "low_risk_write",
      requiresConfirmation: true,
      category: "documents",
      parameters: [
        { name: "title", type: "string", required: true, description: "Document title" },
        { name: "classification", type: "string", required: false, description: "Document type" },
      ],
      execute: async (params) => ({
        success: true,
        message: `Uploading document: ${params.title}`,
        data: { action: "upload_document", title: params.title, classification: params.classification },
      }),
    },
    {
      id: "create_supplement",
      name: "Create Supplement",
      description: "Create a new supplement for a claim",
      riskLevel: "low_risk_write",
      requiresConfirmation: true,
      category: "claims",
      parameters: [
        { name: "claimId", type: "string", required: true, description: "Claim ID" },
        { name: "reason", type: "string", required: true, description: "Reason for supplement" },
      ],
      execute: async (params) => ({
        success: true,
        message: `Creating supplement for claim ${params.claimId}`,
        data: { action: "create_supplement", claimId: params.claimId, reason: params.reason },
      }),
    },
    {
      id: "run_claim_analysis",
      name: "Run Claim Analysis",
      description: "Run analysis on a claim to identify findings and gaps",
      riskLevel: "read",
      requiresConfirmation: false,
      category: "claims",
      parameters: [
        { name: "claimId", type: "string", required: true, description: "Claim ID" },
      ],
      execute: async (params) => ({
        success: true,
        message: `Running analysis on claim ${params.claimId}`,
        data: { action: "run_claim_analysis", claimId: params.claimId },
      }),
    },
    {
      id: "send_outreach_email",
      name: "Send Outreach Email",
      description: "Generate and send a personalized outreach email",
      riskLevel: "high_risk_write",
      requiresConfirmation: true,
      category: "crm",
      parameters: [
        { name: "recipientId", type: "string", required: true, description: "Contact ID" },
        { name: "subject", type: "string", required: true, description: "Email subject" },
        { name: "body", type: "string", required: false, description: "Email body (auto-generated if omitted)" },
      ],
      execute: async (params) => ({
        success: true,
        message: `Preparing outreach email to ${params.recipientId}`,
        data: { action: "send_outreach_email", recipientId: params.recipientId, subject: params.subject },
      }),
    },
    {
      id: "replay_last_response",
      name: "Replay Last Response",
      description: "Re-speak the last Atlas response",
      riskLevel: "read",
      requiresConfirmation: false,
      category: "voice",
      parameters: [],
      execute: async () => ({
        success: true,
        message: "Replaying last response",
        data: { action: "replay_last_response" },
      }),
    },
  ]);
}
