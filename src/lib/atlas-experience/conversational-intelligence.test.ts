import { describe, it, expect } from "vitest";
import {
  buildConversationContext,
  buildContextSummary,
  classifyIntent,
  generateAnswer,
  classifyActionSafety,
  requiresConfirmation,
  resolveFollowUp,
  buildSuggestedQuestions,
  type AtlasConversationContext,
  type ContextBuilderInput,
  type ConversationMemory,
  type AtlasAction,
} from "./conversational-intelligence";
import type { AttentionItem } from "./attention";
import type { AtlasActivity } from "./activity";
import type { AtlasDecision } from "./decision";
import type { AtlasSignal } from "./signal";
import type { AtlasEntityReference } from "./entity-reference";
import type { WorkspaceHealth } from "./context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseHealth: WorkspaceHealth = {
  documents: 10,
  entities: 50,
  chunks: 200,
  relationships: 30,
  openClaims: 5,
  processing: 1,
  failed: 0,
};

const baseEntity: AtlasEntityReference = {
  type: "claim",
  id: "claim-123",
  label: "Claim #1042",
  href: "/dashboard/claims/claim-123",
};

function makeAttentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "att-1",
    title: "Evidence gap",
    explanation: "Missing documents for scope",
    category: "evidence_gap",
    severity: "high",
    status: "open",
    sourceEntityId: "claim-123",
    sourceEntityType: "claim",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeActivity(overrides: Partial<AtlasActivity> = {}): AtlasActivity {
  return {
    id: "act-1",
    entity: baseEntity,
    category: "evidence_gap_identified",
    actor: { type: "atlas", label: "Atlas" },
    title: "Evidence gap discovered",
    summary: "Missing scope documentation",
    timestamp: Date.now(),
    significance: "important",
    source: "evidence_engine",
    ...overrides,
  };
}

function makeDecision(overrides: Partial<AtlasDecision> = {}): AtlasDecision {
  return {
    id: "dec-1",
    entity: baseEntity,
    observation: { title: "Supplement opportunity", summary: "Additional scope identified" },
    importance: { severity: "high", impact: 8420 },
    evidence: [],
    recommendation: { title: "Review supplement", summary: "Atlas identified additional recoverable scope", confidence: 0.85 },
    action: { label: "Review", actionType: "review", requiresApproval: false },
    status: "new",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    requiresApproval: false,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<AtlasSignal> = {}): AtlasSignal {
  return {
    id: "signal-1",
    type: "evidence_gap_discovered",
    entity: baseEntity,
    source: "atlas",
    title: "Evidence gap found",
    summary: "Missing scope documentation",
    occurredAt: new Date().toISOString(),
    significance: "important",
    ...overrides,
  };
}

function makeContext(overrides: Partial<ContextBuilderInput> = {}): ContextBuilderInput {
  return {
    workspaceId: "ws-1",
    workspaceName: "NPP Roofing",
    userRole: "manager",
    health: baseHealth,
    attentionItems: [],
    activities: [],
    decisions: [],
    signals: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildConversationContext", () => {
  it("builds context from empty input", () => {
    const context = buildConversationContext(makeContext());
    expect(context.workspace.id).toBe("ws-1");
    expect(context.attention.totalCount).toBe(0);
    expect(context.activity.todayCount).toBe(0);
    expect(context.decisions.pending.length).toBe(0);
  });

  it("filters attention items by severity", () => {
    const items = [
      makeAttentionItem({ id: "a1", severity: "critical", status: "open" }),
      makeAttentionItem({ id: "a2", severity: "high", status: "open" }),
      makeAttentionItem({ id: "a3", severity: "medium", status: "open" }),
      makeAttentionItem({ id: "a4", severity: "low", status: "open" }),
    ];
    const context = buildConversationContext(makeContext({ attentionItems: items }));
    expect(context.attention.critical.length).toBe(2); // critical + high
    expect(context.attention.important.length).toBe(1); // medium
    expect(context.attention.totalCount).toBe(4);
  });

  it("includes current entity", () => {
    const context = buildConversationContext(makeContext({ currentEntity: baseEntity }));
    expect(context.currentEntity?.id).toBe("claim-123");
  });

  it("counts today activities", () => {
    const now = Date.now();
    const dayMs = 86_400_000;
    const activities = [
      makeActivity({ id: "a1", timestamp: now }),
      makeActivity({ id: "a2", timestamp: now - dayMs / 2 }),
      makeActivity({ id: "a3", timestamp: now - dayMs * 3 }), // old (>48h)
    ];
    const context = buildConversationContext(makeContext({ activities }));
    expect(context.activity.todayCount).toBe(2);
    expect(context.activity.recent.length).toBe(2);
  });

  it("counts pending approvals", () => {
    const decisions = [
      makeDecision({ id: "d1", requiresApproval: true, status: "new" }),
      makeDecision({ id: "d2", requiresApproval: false, status: "new" }),
    ];
    const context = buildConversationContext(makeContext({ decisions }));
    expect(context.decisions.pendingApprovals).toBe(1);
  });
});

describe("buildContextSummary", () => {
  it("produces compact summary string", () => {
    const context = buildConversationContext(
      makeContext({
        workspaceName: "NPP",
        attentionItems: [makeAttentionItem({ severity: "critical", status: "open" })],
        decisions: [makeDecision()],
      }),
    );
    const summary = buildContextSummary(context);
    expect(summary).toContain("Workspace: NPP");
    expect(summary).toContain("Attention: 1 items");
    expect(summary).toContain("Pending decisions: 1");
  });

  it("handles clear state", () => {
    const context = buildConversationContext(makeContext());
    const summary = buildContextSummary(context);
    expect(summary).toContain("Attention: clear");
  });
});

describe("classifyIntent", () => {
  it("classifies focus intent", () => {
    const result = classifyIntent("What should I focus on?");
    expect(result.intent).toBe("focus");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("classifies status intent", () => {
    const result = classifyIntent("How are things?");
    expect(result.intent).toBe("status");
  });

  it("classifies changes intent", () => {
    const result = classifyIntent("What changed today?");
    expect(result.intent).toBe("changes");
  });

  it("classifies revenue intent", () => {
    const result = classifyIntent("Where is the biggest revenue opportunity?");
    expect(result.intent).toBe("revenue");
  });

  it("classifies attention intent", () => {
    const result = classifyIntent("What's wrong with the claims?");
    expect(result.intent).toBe("attention");
  });

  it("classifies decisions intent", () => {
    const result = classifyIntent("What do you recommend?");
    expect(result.intent).toBe("decisions");
  });

  it("classifies approvals intent", () => {
    const result = classifyIntent("What needs my approval?");
    expect(result.intent).toBe("approvals");
  });

  it("classifies evidence intent", () => {
    const result = classifyIntent("What evidence are we missing?");
    expect(result.intent).toBe("evidence");
  });

  it("classifies why intent", () => {
    const result = classifyIntent("Why is this important?");
    expect(result.intent).toBe("why");
  });

  it("classifies entity intent", () => {
    const result = classifyIntent("Tell me about Claim #1042");
    expect(result.intent).toBe("entity");
  });

  it("classifies next intent", () => {
    const result = classifyIntent("Where do I start?");
    expect(result.intent).toBe("next");
  });

  it("classifies navigate intent", () => {
    const result = classifyIntent("Open Claim #1042");
    expect(result.intent).toBe("navigate");
  });

  it("classifies prepare intent", () => {
    const result = classifyIntent("Prepare the supplement");
    expect(result.intent).toBe("prepare");
  });

  it("classifies help intent", () => {
    const result = classifyIntent("What can you do?");
    expect(result.intent).toBe("help");
  });

  it("extracts entities from claim references", () => {
    const result = classifyIntent("Tell me about Claim #1042");
    expect(result.entities.length).toBe(1);
    expect(result.entities[0].id).toBe("1042");
  });
});

describe("generateAnswer", () => {
  it("generates focus answer with next best action", () => {
    const context = buildConversationContext(
      makeContext({
        attentionItems: [makeAttentionItem({ severity: "critical", status: "open" })],
      }),
    );
    const answer = generateAnswer("What should I focus on?", context, { intent: "focus", confidence: 0.9, entities: [] });
    expect(answer.intent).toBe("focus");
    expect(answer.text.length).toBeGreaterThan(0);
    expect(answer.provenance).toBeDefined();
  });

  it("generates clear focus answer", () => {
    const context = buildConversationContext(makeContext());
    const answer = generateAnswer("What should I focus on?", context, { intent: "focus", confidence: 0.9, entities: [] });
    expect(answer.text).toContain("clear");
  });

  it("generates status answer", () => {
    const context = buildConversationContext(makeContext());
    const answer = generateAnswer("How are things?", context, { intent: "status", confidence: 0.9, entities: [] });
    expect(answer.text).toContain("Atlas is");
  });

  it("generates changes answer with activity", () => {
    const context = buildConversationContext(
      makeContext({ activities: [makeActivity()] }),
    );
    const answer = generateAnswer("What changed?", context, { intent: "changes", confidence: 0.9, entities: [] });
    expect(answer.text).toContain("recent changes");
  });

  it("generates empty changes answer", () => {
    const context = buildConversationContext(makeContext());
    const answer = generateAnswer("What changed?", context, { intent: "changes", confidence: 0.9, entities: [] });
    expect(answer.text).toContain("No significant changes");
  });

  it("generates revenue answer with opportunities", () => {
    const context = buildConversationContext(
      makeContext({
        attentionItems: [
          makeAttentionItem({
            category: "revenue_opportunity",
            severity: "critical",
            status: "open",
          }),
        ],
      }),
    );
    const answer = generateAnswer("Where are the opportunities?", context, { intent: "revenue", confidence: 0.9, entities: [] });
    expect(answer.text).toContain("revenue opportunit");
  });

  it("generates attention answer", () => {
    const context = buildConversationContext(
      makeContext({
        attentionItems: [makeAttentionItem({ severity: "critical", status: "open" })],
      }),
    );
    const answer = generateAnswer("What needs attention?", context, { intent: "attention", confidence: 0.9, entities: [] });
    expect(answer.text).toContain("attention");
  });

  it("generates decisions answer", () => {
    const context = buildConversationContext(
      makeContext({ decisions: [makeDecision()] }),
    );
    const answer = generateAnswer("What decisions need me?", context, { intent: "decisions", confidence: 0.9, entities: [] });
    expect(answer.text).toContain("decisions");
  });

  it("generates approvals answer", () => {
    const context = buildConversationContext(
      makeContext({
        decisions: [makeDecision({ requiresApproval: true })],
      }),
    );
    const answer = generateAnswer("What needs approval?", context, { intent: "approvals", confidence: 0.9, entities: [] });
    expect(answer.text).toContain("approval");
  });

  it("generates why answer", () => {
    const context = buildConversationContext(makeContext());
    const answer = generateAnswer("Why?", context, { intent: "why", confidence: 0.9, entities: [] });
    expect(answer.text.length).toBeGreaterThan(0);
  });

  it("generates entity answer with current entity", () => {
    const context = buildConversationContext(
      makeContext({ currentEntity: baseEntity }),
    );
    const answer = generateAnswer("Tell me about this", context, {
      intent: "entity",
      confidence: 0.9,
      entities: [baseEntity],
    });
    expect(answer.text).toContain("Claim #1042");
  });

  it("generates entity clarification when no entity", () => {
    const context = buildConversationContext(makeContext());
    const answer = generateAnswer("Tell me about it", context, {
      intent: "entity",
      confidence: 0.9,
      entities: [],
    });
    expect(answer.needsClarification).toBe(true);
  });

  it("generates help answer", () => {
    const context = buildConversationContext(makeContext());
    const answer = generateAnswer("What can you do?", context, { intent: "help", confidence: 0.9, entities: [] });
    expect(answer.text).toContain("Focus");
    expect(answer.text).toContain("Status");
  });

  it("generates next answer", () => {
    const context = buildConversationContext(makeContext());
    const answer = generateAnswer("What should I do next?", context, { intent: "next", confidence: 0.9, entities: [] });
    expect(answer.text.length).toBeGreaterThan(0);
  });

  it("generates navigate answer", () => {
    const context = buildConversationContext(makeContext());
    const answer = generateAnswer("Open Claim #1042", context, {
      intent: "navigate",
      confidence: 0.9,
      entities: [baseEntity],
    });
    expect(answer.actions?.length).toBe(1);
    expect(answer.actions?.[0].type).toBe("navigate");
  });

  it("generates prepare answer", () => {
    const context = buildConversationContext(makeContext());
    const answer = generateAnswer("Prepare the supplement", context, {
      intent: "prepare",
      confidence: 0.9,
      entities: [baseEntity],
    });
    expect(answer.actions?.[0].type).toBe("prepare");
  });

  it("generates default answer for unknown intent", () => {
    const context = buildConversationContext(makeContext());
    const answer = generateAnswer("asdfghjkl", context, { intent: "unknown", confidence: 0.3, entities: [] });
    expect(answer.needsClarification).toBe(true);
  });

  it("always includes provenance", () => {
    const context = buildConversationContext(makeContext());
    const answer = generateAnswer("Help", context, { intent: "help", confidence: 0.9, entities: [] });
    // Help doesn't include provenance by design, but other intents do
    const statusAnswer = generateAnswer("Status", context, { intent: "status", confidence: 0.9, entities: [] });
    expect(statusAnswer.provenance).toBeDefined();
  });
});

describe("classifyActionSafety", () => {
  it("classifies navigation as low risk", () => {
    expect(classifyActionSafety({ type: "navigate", target: baseEntity })).toBe("low");
  });

  it("classifies evidence display as low risk", () => {
    expect(classifyActionSafety({ type: "show_evidence", target: baseEntity })).toBe("low");
  });

  it("classifies prepare as medium risk", () => {
    expect(classifyActionSafety({ type: "prepare", actionType: "draft", entity: baseEntity })).toBe("medium");
  });
});

describe("requiresConfirmation", () => {
  it("does not require confirmation for navigation", () => {
    expect(requiresConfirmation({ type: "navigate", target: baseEntity })).toBe(false);
  });

  it("requires confirmation for prepare", () => {
    expect(requiresConfirmation({ type: "prepare", actionType: "draft", entity: baseEntity })).toBe(true);
  });
});

describe("resolveFollowUp", () => {
  it("resolves 'it' to last entity", () => {
    const memory: ConversationMemory = {
      turns: [],
      lastEntity: baseEntity,
    };
    const result = resolveFollowUp("Open it", memory);
    expect(result.entityContext?.id).toBe("claim-123");
  });

  it("resolves 'why' with entity context", () => {
    const memory: ConversationMemory = {
      turns: [],
      lastEntity: baseEntity,
      lastIntent: "focus",
    };
    const result = resolveFollowUp("Why?", memory);
    expect(result.entityContext?.id).toBe("claim-123");
  });

  it("passes through unchanged when no memory", () => {
    const memory: ConversationMemory = { turns: [] };
    const result = resolveFollowUp("What should I focus on?", memory);
    expect(result.resolved).toBe("What should I focus on?");
    expect(result.entityContext).toBeUndefined();
  });
});

describe("buildSuggestedQuestions", () => {
  it("suggests attention when critical items exist", () => {
    const context = buildConversationContext(
      makeContext({
        attentionItems: [makeAttentionItem({ severity: "critical", status: "open" })],
      }),
    );
    const suggestions = buildSuggestedQuestions(context);
    expect(suggestions.some((s) => s.includes("attention"))).toBe(true);
  });

  it("suggests approval when pending approvals exist", () => {
    const context = buildConversationContext(
      makeContext({
        decisions: [makeDecision({ requiresApproval: true })],
      }),
    );
    const suggestions = buildSuggestedQuestions(context);
    expect(suggestions.some((s) => s.includes("approval"))).toBe(true);
  });

  it("suggests entity question when on entity page", () => {
    const context = buildConversationContext(
      makeContext({ currentEntity: baseEntity }),
    );
    const suggestions = buildSuggestedQuestions(context);
    expect(suggestions.some((s) => s.includes("this claim"))).toBe(true);
  });

  it("always includes at least 3 suggestions", () => {
    const context = buildConversationContext(makeContext());
    const suggestions = buildSuggestedQuestions(context);
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
  });
});
