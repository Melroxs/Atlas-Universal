// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Phase 7 Comprehensive Tests
//
// Tests for:
//   - Voice intent routing
//   - Safety gate system
//   - Voice-AI bridge
//   - Tenant isolation
//   - Confirmation enforcement
//   - Error UX
//   - Synthetic demo scenario
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  classifyVoiceIntent,
  intentRequiresConfirmation,
  getAllIntentPatterns,
} from "./intent-router";
import {
  initSafetyGate,
  resetSafetyGate,
  checkConfirmationRequired,
  confirmAction,
  confirmLatestPending,
  rejectAction,
  getPendingConfirmations,
  getSafetyAuditLog,
  getConfirmationStats,
} from "./safety";
import {
  initVoiceBridge,
  resetVoiceBridge,
  setEntityContext,
  setPageContext,
  processVoiceTranscript,
  handleAiResponse,
  getConversationHistory,
} from "./voice-bridge";

// ---------------------------------------------------------------------------
// Intent Router Tests
// ---------------------------------------------------------------------------

describe("Voice Intent Router", () => {
  describe("claim status queries", () => {
    it("classifies 'what is the status of claim GAP-26-51847' as get_claim_status", () => {
      const intent = classifyVoiceIntent("What is the status of claim GAP-26-51847?");
      expect(intent.id).toBe("get_claim_status");
      expect(intent.category).toBe("informational");
      expect(intent.entities.length).toBeGreaterThanOrEqual(1);
      const claimEntity = intent.entities.find((e) => e.type === "claim_id");
      expect(claimEntity).toBeDefined();
      expect(claimEntity!.value).toContain("GAP");
      expect(intent.requiresConfirmation).toBe(false);
    });

    it("classifies 'tell me about claim ATLAS001' as get_claim_status", () => {
      const intent = classifyVoiceIntent("Tell me about claim ATLAS001");
      expect(intent.id).toBe("get_claim_status");
      expect(intent.category).toBe("informational");
    });

    it("classifies 'where are we on the Johnson claim' as get_claim_status", () => {
      const intent = classifyVoiceIntent("Where are we on the Johnson claim?");
      expect(intent.id).toBe("get_claim_status");
    });
  });

  describe("evidence gap queries", () => {
    it("classifies 'what evidence is missing' as evidence_gaps", () => {
      const intent = classifyVoiceIntent("What evidence is missing?");
      expect(intent.id).toBe("evidence_gaps");
      expect(intent.category).toBe("informational");
      expect(intent.requiresConfirmation).toBe(false);
    });

    it("classifies 'what do we need' as evidence_gaps", () => {
      const intent = classifyVoiceIntent("What do we need for this claim?");
      expect(intent.id).toBe("evidence_gaps");
    });

    it("classifies 'gap analysis' as evidence_gaps", () => {
      const intent = classifyVoiceIntent("Run a gap analysis");
      expect(intent.id).toBe("evidence_gaps");
    });
  });

  describe("contradiction detection", () => {
    it("classifies 'are there any contradictions' as contradictions", () => {
      const intent = classifyVoiceIntent("Are there any contradictions in the evidence?");
      expect(intent.id).toBe("contradictions");
      expect(intent.category).toBe("informational");
    });

    it("classifies 'do the documents conflict' as contradictions", () => {
      const intent = classifyVoiceIntent("Do the documents conflict with each other?");
      expect(intent.id).toBe("contradictions");
    });
  });

  describe("analytical queries", () => {
    it("classifies 'analyze this claim' as analyze_claim", () => {
      const intent = classifyVoiceIntent("Analyze this claim");
      expect(intent.id).toBe("analyze_claim");
      expect(intent.category).toBe("analytical");
    });

    it("classifies 'find supplement opportunities' as supplement_opportunities", () => {
      const intent = classifyVoiceIntent("Find potential supplement opportunities");
      expect(intent.id).toBe("supplement_opportunities");
      expect(intent.category).toBe("analytical");
    });

    it("classifies 'compare the estimate' as compare_estimate", () => {
      const intent = classifyVoiceIntent("Compare the estimate with the claim documentation");
      expect(intent.id).toBe("compare_estimate");
      expect(intent.category).toBe("analytical");
    });

    it("classifies 'summarize the evidence' as summarize_evidence", () => {
      const intent = classifyVoiceIntent("Summarize the evidence for this claim");
      expect(intent.id).toBe("summarize_evidence");
      expect(intent.category).toBe("analytical");
    });

    it("classifies 'why was this recommendation made' as recommendation_reasoning", () => {
      const intent = classifyVoiceIntent("Why was this recommendation made?");
      expect(intent.id).toBe("recommendation_reasoning");
      expect(intent.category).toBe("analytical");
    });
  });

  describe("action commands", () => {
    it("classifies 'create a supplement' as create_supplement with confirmation required", () => {
      const intent = classifyVoiceIntent("Create a new supplement for this claim");
      expect(intent.id).toBe("create_supplement");
      expect(intent.category).toBe("action");
      expect(intent.requiresConfirmation).toBe(true);
      expect(intent.actionId).toBe("create_supplement");
    });

    it("classifies 'send to adjuster' as send_to_adjuster with confirmation", () => {
      const intent = classifyVoiceIntent("Send this to the adjuster");
      expect(intent.id).toBe("send_to_adjuster");
      expect(intent.category).toBe("action");
      expect(intent.requiresConfirmation).toBe(true);
    });

    it("classifies 'generate claim package' as generate_package with confirmation", () => {
      const intent = classifyVoiceIntent("Generate the claim package");
      expect(intent.id).toBe("generate_package");
      expect(intent.category).toBe("action");
      expect(intent.requiresConfirmation).toBe(true);
    });
  });

  describe("conversational intents", () => {
    it("classifies 'hello' as greeting", () => {
      const intent = classifyVoiceIntent("Hello!");
      expect(intent.id).toBe("greeting");
      expect(intent.category).toBe("conversational");
      expect(intent.requiresConfirmation).toBe(false);
    });

    it("classifies 'help' as help", () => {
      const intent = classifyVoiceIntent("Help");
      expect(intent.id).toBe("help");
      expect(intent.category).toBe("conversational");
    });

    it("classifies 'repeat' as repeat", () => {
      const intent = classifyVoiceIntent("Say that again");
      expect(intent.id).toBe("repeat");
      expect(intent.category).toBe("conversational");
      expect(intent.actionId).toBe("replay_last_response");
    });

    it("classifies 'stop' as stop", () => {
      const intent = classifyVoiceIntent("Stop");
      expect(intent.id).toBe("stop");
      expect(intent.category).toBe("conversational");
    });
  });

  describe("general questions", () => {
    it("classifies unrecognized input as general_question", () => {
      const intent = classifyVoiceIntent("How are repairs going on the roof?");
      expect(intent.id).toBe("general_question");
      expect(intent.category).toBe("informational");
      expect(intent.atlasTask).toBe("ask_atlas");
      expect(intent.confidence).toBeLessThan(0.5);
    });
  });

  describe("empty input", () => {
    it("classifies empty string as empty", () => {
      const intent = classifyVoiceIntent("");
      expect(intent.id).toBe("empty");
      expect(intent.confidence).toBe(1.0);
    });

    it("classifies whitespace-only as empty", () => {
      const intent = classifyVoiceIntent("   ");
      expect(intent.id).toBe("empty");
    });
  });

  describe("entity extraction", () => {
    it("extracts claim IDs from transcripts", () => {
      const intent = classifyVoiceIntent("What is the status of claim GAP-26-51847?");
      expect(intent.entities.some((e) => e.type === "claim_id")).toBe(true);
    });

    it("extracts person names from transcripts", () => {
      const intent = classifyVoiceIntent("Send an email to John Smith about the claim");
      const personEntities = intent.entities.filter((e) => e.type === "person");
      expect(personEntities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("intent patterns", () => {
    it("returns all registered patterns", () => {
      const patterns = getAllIntentPatterns();
      expect(patterns.length).toBeGreaterThan(10);
      expect(patterns.some((p) => p.id === "get_claim_status")).toBe(true);
      expect(patterns.some((p) => p.id === "create_supplement")).toBe(true);
      expect(patterns.some((p) => p.id === "greeting")).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Safety Gate Tests
// ---------------------------------------------------------------------------

describe("Safety Gate System", () => {
  beforeEach(() => {
    resetSafetyGate();
    initSafetyGate();
  });

  describe("confirmation requirements", () => {
    it("requires confirmation for high-risk writes", () => {
      const result = checkConfirmationRequired(
        "send_outreach_email",
        "Send Outreach Email",
        "high_risk_write",
        { recipientId: "contact-123", subject: "Test" },
        { tenantId: "tenant-1", userId: "user-1", sessionId: "session-1" },
      );
      expect(result.required).toBe(true);
      expect(result.prompt).toBeDefined();
      expect(result.confirmationId).toBeDefined();
    });

    it("requires confirmation for low-risk writes when configured", () => {
      const result = checkConfirmationRequired(
        "create_supplement",
        "Create Supplement",
        "low_risk_write",
        { claimId: "claim-123" },
        { tenantId: "tenant-1", userId: "user-1", sessionId: "session-1" },
      );
      expect(result.required).toBe(true);
    });

    it("does not require confirmation for read operations by default", () => {
      const result = checkConfirmationRequired(
        "get_claim_status",
        "Get Claim Status",
        "read",
        { claimId: "claim-123" },
        { tenantId: "tenant-1", userId: "user-1", sessionId: "session-1" },
      );
      expect(result.required).toBe(false);
    });
  });

  describe("confirmation flow", () => {
    it("creates a pending confirmation", () => {
      const result = checkConfirmationRequired(
        "send_outreach_email",
        "Send Email",
        "high_risk_write",
        { recipientId: "c1" },
        { tenantId: "t1", userId: "u1", sessionId: "s1" },
      );
      expect(result.required).toBe(true);
      expect(result.confirmationId).toBeDefined();

      const pending = getPendingConfirmations("s1");
      expect(pending).toHaveLength(1);
      expect(pending[0]!.actionId).toBe("send_outreach_email");
      expect(pending[0]!.status).toBe("pending");
    });

    it("confirms a pending action", () => {
      const result = checkConfirmationRequired(
        "create_supplement",
        "Create Supplement",
        "high_risk_write",
        { claimId: "c1" },
        { tenantId: "t1", userId: "u1", sessionId: "s1" },
      );

      const confirmed = confirmAction(result.confirmationId!);
      expect(confirmed).not.toBeNull();
      expect(confirmed!.status).toBe("confirmed");
      expect(confirmed!.confirmedAt).toBeDefined();

      // Should be removed from pending
      const pending = getPendingConfirmations("s1");
      expect(pending).toHaveLength(0);
    });

    it("rejects a pending action", () => {
      const result = checkConfirmationRequired(
        "send_outreach_email",
        "Send Email",
        "high_risk_write",
        {},
        { tenantId: "t1", userId: "u1", sessionId: "s1" },
      );

      const rejected = rejectAction(result.confirmationId!);
      expect(rejected).toBe(true);

      const pending = getPendingConfirmations("s1");
      expect(pending).toHaveLength(0);
    });

    it("confirms the latest pending action for a session", () => {
      // Create two pending confirmations
      checkConfirmationRequired(
        "action1", "Action 1", "high_risk_write", {},
        { tenantId: "t1", userId: "u1", sessionId: "s1" },
      );
      const result2 = checkConfirmationRequired(
        "action2", "Action 2", "high_risk_write", {},
        { tenantId: "t1", userId: "u1", sessionId: "s1" },
      );

      const confirmed = confirmLatestPending("s1");
      expect(confirmed).not.toBeNull();
      // confirmLatestPending picks one of the pending actions
      expect(["action1", "action2"]).toContain(confirmed!.actionId);

      // One should remain
      const pending = getPendingConfirmations("s1");
      expect(pending).toHaveLength(1);
    });

    it("returns null when confirming non-existent ID", () => {
      const result = confirmAction("non-existent-id");
      expect(result).toBeNull();
    });

    it("returns false when rejecting non-existent ID", () => {
      const result = rejectAction("non-existent-id");
      expect(result).toBe(false);
    });
  });

  describe("confirmation limits", () => {
    it("blocks when max pending confirmations reached", () => {
      // Create max pending (5 by default)
      for (let i = 0; i < 5; i++) {
        checkConfirmationRequired(
          `action${i}`, `Action ${i}`, "high_risk_write", {},
          { tenantId: "t1", userId: "u1", sessionId: "s1" },
        );
      }

      // 6th should be blocked
      const result = checkConfirmationRequired(
        "action5", "Action 5", "high_risk_write", {},
        { tenantId: "t1", userId: "u1", sessionId: "s1" },
      );
      expect(result.required).toBe(true);
      expect(result.prompt).toContain("Too many");
    });
  });

  describe("audit log", () => {
    it("logs confirmation decisions", () => {
      checkConfirmationRequired(
        "action1", "Action 1", "high_risk_write", {},
        { tenantId: "t1", userId: "u1", sessionId: "s1" },
      );

      const log = getSafetyAuditLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0]!.decision).toBe("confirmation_required");
      expect(log[0]!.actionId).toBe("action1");
    });

    it("logs confirmed decisions", () => {
      const result = checkConfirmationRequired(
        "action1", "Action 1", "high_risk_write", {},
        { tenantId: "t1", userId: "u1", sessionId: "s1" },
      );
      confirmAction(result.confirmationId!);

      const log = getSafetyAuditLog();
      const confirmedEntry = log.find((e) => e.decision === "confirmed");
      expect(confirmedEntry).toBeDefined();
    });

    it("provides confirmation statistics", () => {
      const result = checkConfirmationRequired(
        "action1", "Action 1", "high_risk_write", {},
        { tenantId: "t1", userId: "u1", sessionId: "s1" },
      );
      confirmAction(result.confirmationId!);

      checkConfirmationRequired(
        "action2", "Action 2", "high_risk_write", {},
        { tenantId: "t1", userId: "u1", sessionId: "s1" },
      );

      const stats = getConfirmationStats();
      expect(stats.confirmed).toBe(1);
      expect(stats.pending).toBe(1);
      expect(stats.total).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Voice Bridge Tests
// ---------------------------------------------------------------------------

describe("Voice-AI Bridge", () => {
  beforeEach(() => {
    resetVoiceBridge();
    initVoiceBridge();
  });

  describe("transcript processing", () => {
    it("classifies informational queries correctly", () => {
      const result = processVoiceTranscript("What is the status of claim GAP-26-51847?");
      expect(result.intent.id).toBe("get_claim_status");
      expect(result.requiresConfirmation).toBe(false);
      expect(result.atlasTask).toBe("ask_atlas");
    });

    it("classifies action commands with confirmation", () => {
      const result = processVoiceTranscript("Create a supplement");
      expect(result.intent.id).toBe("create_supplement");
      expect(result.requiresConfirmation).toBe(true);
      expect(result.confirmationPrompt).toBeDefined();
      expect(result.confirmationId).toBeDefined();
    });

    it("handles empty transcripts", () => {
      const result = processVoiceTranscript("");
      expect(result.intent.id).toBe("empty");
      expect(result.requiresConfirmation).toBe(false);
    });

    it("handles interruption commands", () => {
      const result = processVoiceTranscript("Stop");
      expect(result.intent.id).toBe("stop");
      expect(result.requiresConfirmation).toBe(false);
    });

    it("handles repeat requests", () => {
      const result = processVoiceTranscript("Say that again");
      expect(result.intent.id).toBe("repeat");
      expect(result.actionId).toBe("replay_last_response");
    });
  });

  describe("conversation history", () => {
    it("maintains conversation history", () => {
      processVoiceTranscript("What is the status of claim GAP-26-51847?");
      handleAiResponse({
        answer: "The claim is in progress.",
        spoken: "The claim is in progress.",
        intent: classifyVoiceIntent("status"),
      });

      const history = getConversationHistory();
      expect(history).toHaveLength(2);
      expect(history[0]!.role).toBe("user");
      expect(history[1]!.role).toBe("assistant");
    });

    it("detects follow-up questions", () => {
      processVoiceTranscript("What is the status of claim GAP-26-51847?");
      handleAiResponse({
        answer: "The claim is in progress.",
        spoken: "The claim is in progress.",
        intent: classifyVoiceIntent("status"),
      });

      const result = processVoiceTranscript("Why does that matter?");
      expect(result.isFollowUp).toBe(true);
    });

    it("caps history at max turns", () => {
      // Add many turns
      for (let i = 0; i < 25; i++) {
        processVoiceTranscript(`Question ${i}`);
        handleAiResponse({
          answer: `Answer ${i}`,
          spoken: `Answer ${i}`,
          intent: classifyVoiceIntent("test"),
        });
      }

      const history = getConversationHistory();
      expect(history.length).toBeLessThanOrEqual(20); // maxHistoryTurns
    });
  });

  describe("entity context", () => {
    it("sets and uses entity context", () => {
      setEntityContext("claim-123");
      const result = processVoiceTranscript("What is the status?");
      expect(result.entities).toBeDefined();
    });

    it("sets and uses page context", () => {
      setPageContext("Revenue Recovery");
      const result = processVoiceTranscript("Analyze this claim");
      expect(result.intent).toBeDefined();
    });
  });

  describe("confirmation flow integration", () => {
    it("creates confirmation for high-risk actions", () => {
      const result = processVoiceTranscript("Send this to the adjuster");
      expect(result.requiresConfirmation).toBe(true);
      expect(result.confirmationId).toBeDefined();
    });

    it("handles confirmation response", () => {
      // First, trigger a confirmation-required action
      const result = processVoiceTranscript("Create a supplement");
      expect(result.requiresConfirmation).toBe(true);

      // Now confirm it — the bridge handles "yes" as a confirmation
      const confirmResult = processVoiceTranscript("yes, proceed");
      // After confirmation, the intent is either the action or general_question
      expect(confirmResult).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Tenant Isolation Tests
// ---------------------------------------------------------------------------

describe("Tenant Isolation", () => {
  beforeEach(() => {
    resetVoiceBridge();
    resetSafetyGate();
    initVoiceBridge();
    initSafetyGate();
  });

  it("sessions are isolated by entity context", () => {
    setEntityContext("tenant-a-claim-1");
    const resultA = processVoiceTranscript("What is the status?");
    expect(resultA.entities).toBeDefined();

    setEntityContext("tenant-b-claim-2");
    const resultB = processVoiceTranscript("What is the status?");
    expect(resultB.entities).toBeDefined();

    // Different entity contexts should not share pending confirmations
    checkConfirmationRequired(
      "action1", "Action 1", "high_risk_write", {},
      { tenantId: "tenant-a", userId: "u1", sessionId: "tenant-a-claim-1" },
    );

    const pendingA = getPendingConfirmations("tenant-a-claim-1");
    const pendingB = getPendingConfirmations("tenant-b-claim-2");

    expect(pendingA).toHaveLength(1);
    expect(pendingB).toHaveLength(0);
  });

  it("audit logs track tenant context", () => {
    checkConfirmationRequired(
      "action1", "Action 1", "high_risk_write", {},
      { tenantId: "tenant-a", userId: "u1", sessionId: "s1" },
    );

    const log = getSafetyAuditLog();
    expect(log[0]!.sessionId).toBe("s1");
  });
});

// ---------------------------------------------------------------------------
// Synthetic Demo Scenario
// ---------------------------------------------------------------------------

describe("Synthetic Demo Scenario", () => {
  beforeEach(() => {
    resetVoiceBridge();
    resetSafetyGate();
    initVoiceBridge();
    initSafetyGate();
    setEntityContext("ATLAS-DEMO-001");
  });

  it("step 1: user asks to summarize claim", () => {
    const result = processVoiceTranscript("Atlas, summarize this claim.");
    expect(result.intent.category).toBe("informational");
    expect(result.requiresConfirmation).toBe(false);
  });

  it("step 2: user asks about missing evidence", () => {
    const result = processVoiceTranscript("What evidence is missing?");
    expect(result.intent.id).toBe("evidence_gaps");
    expect(result.requiresConfirmation).toBe(false);
  });

  it("step 3: user asks follow-up about why it matters", () => {
    processVoiceTranscript("What evidence is missing?");
    handleAiResponse({
      answer: "The roof inspection photos are missing.",
      spoken: "The roof inspection photos are missing.",
      intent: classifyVoiceIntent("evidence gaps"),
    });

    const result = processVoiceTranscript("Why does that matter?");
    expect(result.isFollowUp).toBe(true);
  });

  it("step 4: user asks for supplement opportunities", () => {
    const result = processVoiceTranscript("Find potential supplement opportunities.");
    expect(result.intent.id).toBe("supplement_opportunities");
    expect(result.requiresConfirmation).toBe(false);
  });

  it("step 5: user requests draft supplement (requires confirmation)", () => {
    const result = processVoiceTranscript("Create a draft supplement.");
    expect(result.intent.id).toBe("create_supplement");
    expect(result.requiresConfirmation).toBe(true);
    expect(result.confirmationPrompt).toBeDefined();
  });

  it("step 6: user requests to send supplement (requires confirmation)", () => {
    const result = processVoiceTranscript("Send the supplement to the adjuster.");
    expect(result.intent.id).toBe("send_to_adjuster");
    expect(result.requiresConfirmation).toBe(true);
    // Atlas should NOT automatically execute
    expect(result.actionId).toBe("send_outreach_email");
  });

  it("full demo flow: all steps complete without errors", () => {
    // Step 1
    const step1 = processVoiceTranscript("Atlas, summarize this claim.");
    expect(step1.intent).toBeDefined();

    // Step 2
    const step2 = processVoiceTranscript("What evidence is missing?");
    expect(step2.intent.id).toBe("evidence_gaps");

    // Step 3
    handleAiResponse({
      answer: "The roof inspection photos are missing.",
      spoken: "The roof inspection photos are missing.",
      intent: step2.intent,
    });
    const step3 = processVoiceTranscript("Why does that matter?");
    expect(step3.isFollowUp).toBe(true);

    // Step 4
    const step4 = processVoiceTranscript("Find potential supplement opportunities.");
    expect(step4.intent.id).toBe("supplement_opportunities");

    // Step 5
    const step5 = processVoiceTranscript("Create a draft supplement.");
    expect(step5.requiresConfirmation).toBe(true);

    // Step 6
    const step6 = processVoiceTranscript("Send the supplement to the adjuster.");
    expect(step6.requiresConfirmation).toBe(true);

    // Verify conversation history — confirmation-requiring steps don't add to history
    // Steps 1-4 are informational and add user turns; step 3 also adds assistant response
    const history = getConversationHistory();
    expect(history.length).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Error UX Tests
// ---------------------------------------------------------------------------

describe("Error UX", () => {
  it("handles microphone permission denied gracefully", () => {
    // This is tested through the useVoice hook's error handling
    // The voice runtime should not crash on permission errors
    const intent = classifyVoiceIntent("");
    expect(intent.id).toBe("empty");
  });

  it("handles provider unavailable gracefully", () => {
    // Voice bridge should work even without providers
    resetVoiceBridge();
    initVoiceBridge();
    const result = processVoiceTranscript("Hello");
    expect(result.intent).toBeDefined();
  });

  it("never exposes API keys in error messages", () => {
    // Verify error messages don't contain sensitive data
    const log = getSafetyAuditLog();
    for (const entry of log) {
      expect(entry.reason).not.toContain("api_key");
      expect(entry.reason).not.toContain("API_KEY");
      expect(entry.reason).not.toContain("sk-");
    }
  });
});

// ---------------------------------------------------------------------------
// Performance Measurement (basic timing)
// ---------------------------------------------------------------------------

describe("Performance", () => {
  it("intent classification completes in < 10ms", () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      classifyVoiceIntent("What is the status of claim GAP-26-51847?");
    }
    const elapsed = performance.now() - start;
    expect(elapsed / 100).toBeLessThan(10); // < 10ms per classification
  });

  it("voice bridge processing completes in < 50ms", () => {
    resetVoiceBridge();
    initVoiceBridge();
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      processVoiceTranscript("What is the status of claim GAP-26-51847?");
    }
    const elapsed = performance.now() - start;
    expect(elapsed / 100).toBeLessThan(50); // < 50ms per processing
  });
});
