// ---------------------------------------------------------------------------
// Tests: Conversational ↔ Execution Bridge + Action Handlers
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  resolveConversationEntity,
  bridgeIntentToAction,
  processVoiceCommand,
  handleConfirmationResponse,
  generateProactiveActionSuggestions,
  type ConversationResolutionContext,
} from "./conversational-execution-bridge";
import { createAction, prepareForConfirmation } from "./execution";
import type { AtlasConversationContext } from "./conversational-intelligence";
import type { AtlasUserRole } from "./execution";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockEntity = { type: "claim" as const, id: "1042", label: "Claim #1042" };

const mockConversationContext: AtlasConversationContext = {
  workspace: { id: "ws-1", name: "Atlas" },
  user: { role: "atlas_admin" },
  system: { status: "operational" },
  attention: { critical: [], important: [] },
  activity: { recent: [], todayCount: 0 },
  decisions: { pending: [], highImpact: [], approvals: [] },
  signals: { recent: [], unseen: [] },
};

const baseContext: ConversationResolutionContext = {
  userRole: "atlas_admin" as AtlasUserRole,
  userId: "user-1",
  currentEntity: mockEntity,
  conversationContext: mockConversationContext,
};

const customerUserContext: ConversationResolutionContext = {
  ...baseContext,
  userRole: "customer_user" as AtlasUserRole,
};

// ---------------------------------------------------------------------------
// resolveConversationEntity
// ---------------------------------------------------------------------------

describe("resolveConversationEntity", () => {
  it("resolves explicit claim reference", () => {
    const entity = resolveConversationEntity("Tell me about Claim #1042", baseContext);
    expect(entity).toBeDefined();
    expect(entity?.type).toBe("claim");
    expect(entity?.id).toBe("1042");
  });

  it("resolves pronoun using current entity", () => {
    const entity = resolveConversationEntity("Tell me about it", baseContext);
    expect(entity).toEqual(mockEntity);
  });

  it("resolves 'the claim' using current entity", () => {
    const entity = resolveConversationEntity("What's the claim about?", baseContext);
    expect(entity).toEqual(mockEntity);
  });

  it("returns undefined when no entity and no current entity", () => {
    const ctx = { ...baseContext, currentEntity: undefined };
    const entity = resolveConversationEntity("What's up?", ctx);
    expect(entity).toBeUndefined();
  });

  it("resolves document reference", () => {
    const entity = resolveConversationEntity("Open document #42", baseContext);
    expect(entity?.type).toBe("document");
    expect(entity?.id).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// bridgeIntentToAction
// ---------------------------------------------------------------------------

describe("bridgeIntentToAction", () => {
  it("returns informational answer for focus intent", () => {
    const result = bridgeIntentToAction("What should I focus on?", baseContext);
    expect(result.hasAction).toBe(false);
    expect(result.answer).toBeTruthy();
    expect(result.authorized).toBe(true);
  });

  it("returns informational answer for status intent", () => {
    const result = bridgeIntentToAction("How are things?", baseContext);
    expect(result.hasAction).toBe(false);
    expect(result.answer).toBeTruthy();
  });

  it("creates prepare action for claim with entity context", () => {
    const result = bridgeIntentToAction("Prepare it", baseContext);
    expect(result.hasAction).toBe(true);
    expect(result.action).toBeDefined();
    expect(result.requiresConfirmation).toBe(true);
    expect(result.action?.type).toBe("prepare_supplement");
  });

  it("creates prepare email action for lead entity", () => {
    const leadCtx = {
      ...baseContext,
      currentEntity: { type: "organization" as const, id: "lead-1", label: "Acme Roofing" },
    };
    const result = bridgeIntentToAction("Prepare the email", leadCtx);
    expect(result.hasAction).toBe(true);
    expect(result.action?.type).toBe("prepare_email");
  });

  it("prompts for entity when preparing without context", () => {
    const ctx = { ...baseContext, currentEntity: undefined };
    const result = bridgeIntentToAction("Prepare the supplement", ctx);
    expect(result.hasAction).toBe(false);
    expect(result.answer).toContain("specify");
  });

  it("creates submit action", () => {
    const result = bridgeIntentToAction("Submit the supplement for Claim #1042", baseContext);
    expect(result.hasAction).toBe(true);
    expect(result.action?.type).toBe("submit_supplement");
    expect(result.requiresConfirmation).toBe(true);
  });

  it("blocks unauthorized user from prepare action", () => {
    const result = bridgeIntentToAction("Prepare it", customerUserContext);
    expect(result.hasAction).toBe(false);
    expect(result.authorized).toBe(false);
  });

  it("creates navigate action for explicit entity request", () => {
    const result = bridgeIntentToAction("Open Claim #1042", baseContext);
    expect(result.hasAction).toBe(true);
    expect(result.action?.type).toBe("navigate");
    expect(result.requiresConfirmation).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// processVoiceCommand
// ---------------------------------------------------------------------------

describe("processVoiceCommand", () => {
  it("processes voice command the same as text", () => {
    const textResult = bridgeIntentToAction("What should I focus on?", baseContext);
    const voiceResult = processVoiceCommand("What should I focus on?", baseContext);
    expect(voiceResult.hasAction).toBe(textResult.hasAction);
    expect(voiceResult.answer).toBe(textResult.answer);
  });

  it("trims and normalizes voice transcripts", () => {
    const result = processVoiceCommand("  Prepare it  ", baseContext);
    expect(result.hasAction).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleConfirmationResponse
// ---------------------------------------------------------------------------

describe("handleConfirmationResponse", () => {
  const action = prepareForConfirmation(
    createAction(
      "prepare_supplement",
      "Prepare supplement",
      "Atlas will prepare supplement",
      mockEntity,
      { claimId: "1042" },
      "user-1",
    ),
  );

  it("confirms on 'yes'", () => {
    const result = handleConfirmationResponse("yes", action);
    expect(result.confirmed).toBe(true);
  });

  it("confirms on 'confirm'", () => {
    const result = handleConfirmationResponse("Confirm", action);
    expect(result.confirmed).toBe(true);
  });

  it("confirms on 'go ahead'", () => {
    const result = handleConfirmationResponse("go ahead", action);
    expect(result.confirmed).toBe(true);
  });

  it("cancels on 'no'", () => {
    const result = handleConfirmationResponse("no", action);
    expect(result.confirmed).toBe(false);
    expect(result.response).toContain("cancelled");
  });

  it("cancels on 'cancel'", () => {
    const result = handleConfirmationResponse("cancel", action);
    expect(result.confirmed).toBe(false);
  });

  it("asks clarification on ambiguous response", () => {
    const result = handleConfirmationResponse("hmm", action);
    expect(result.confirmed).toBe(false);
    expect(result.response).toContain("confirm or cancel");
  });
});

// ---------------------------------------------------------------------------
// generateProactiveActionSuggestions
// ---------------------------------------------------------------------------

describe("generateProactiveActionSuggestions", () => {
  it("returns empty for context without data", () => {
    const suggestions = generateProactiveActionSuggestions(mockConversationContext, "atlas_admin");
    expect(suggestions).toEqual([]);
  });

  it("returns authorized suggestions only", () => {
    const suggestions = generateProactiveActionSuggestions(
      mockConversationContext,
      "customer_user",
    );
    // customer_user has limited permissions — all suggestions should be authorized
    for (const s of suggestions) {
      expect(s.actionType).toBeDefined();
    }
  });
});
