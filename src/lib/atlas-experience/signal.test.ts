import { describe, it, expect } from "vitest";
import {
  SIGNAL_SIGNIFICANCE,
  SIGNIFICANCE_ORDER,
  shouldSurfaceSignal,
  filterSurfaceSignals,
  detectNewSignals,
  detectUnseenSignals,
  deduplicateSignals,
  attentionToSignal,
  decisionToSignal,
  activityToSignal,
  buildSinceLastVisit,
  buildProactiveContext,
  type AtlasSignal,
  type AtlasEntityReference,
  type SeenSignalState,
} from "./signal";
import type { AttentionItem } from "./attention";
import type { AtlasDecision } from "./decision";
import type { AtlasActivity } from "./activity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseEntity: AtlasEntityReference = {
  type: "claim",
  id: "claim-123",
  label: "Claim #1042",
  href: "/dashboard/claims/claim-123",
};

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

function makeAttentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "att-1",
    title: "Evidence gap",
    explanation: "Missing documents",
    category: "evidence_gap",
    severity: "high",
    status: "open",
    sourceEntityId: "claim-123",
    sourceEntityType: "claim",
    navigationTarget: "/dashboard/claims/claim-123",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeDecision(overrides: Partial<AtlasDecision> = {}): AtlasDecision {
  return {
    id: "dec-1",
    entity: baseEntity,
    observation: {
      title: "Supplement opportunity",
      summary: "Additional scope identified",
    },
    importance: {
      severity: "high",
      impact: 8420,
    },
    evidence: [],
    recommendation: {
      title: "Review supplement",
      summary: "Atlas identified additional recoverable scope",
      confidence: 0.85,
    },
    action: {
      label: "Review",
      actionType: "review",
      requiresApproval: false,
    },
    status: "new",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    requiresApproval: false,
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
    summary: "Missing scope documentation for Claim #1042",
    timestamp: Date.now(),
    significance: "important",
    source: "evidence_engine",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Signal Significance Map", () => {
  it("has entries for all signal types", () => {
    expect(Object.keys(SIGNAL_SIGNIFICANCE).length).toBeGreaterThanOrEqual(20);
  });

  it("maps critical types correctly", () => {
    expect(SIGNAL_SIGNIFICANCE.workflow_failed).toBe("critical");
    expect(SIGNAL_SIGNIFICANCE.contradiction_discovered).toBe("critical");
    expect(SIGNAL_SIGNIFICANCE.evidence_gap_discovered).toBe("critical");
  });

  it("maps important types correctly", () => {
    expect(SIGNAL_SIGNIFICANCE.claim_status_changed).toBe("important");
    expect(SIGNAL_SIGNIFICANCE.recommendation_created).toBe("important");
    expect(SIGNAL_SIGNIFICANCE.revenue_opportunity_identified).toBe("important");
  });
});

describe("SIGNIFICANCE_ORDER", () => {
  it("orders from most to least significant", () => {
    expect(SIGNIFICANCE_ORDER.critical).toBeLessThan(SIGNIFICANCE_ORDER.important);
    expect(SIGNIFICANCE_ORDER.important).toBeLessThan(SIGNIFICANCE_ORDER.notable);
    expect(SIGNIFICANCE_ORDER.notable).toBeLessThan(SIGNIFICANCE_ORDER.routine);
  });
});

describe("shouldSurfaceSignal", () => {
  it("surfaces critical signals", () => {
    expect(shouldSurfaceSignal(makeSignal({ significance: "critical" }))).toBe(true);
  });

  it("surfaces important signals", () => {
    expect(shouldSurfaceSignal(makeSignal({ significance: "important" }))).toBe(true);
  });

  it("surfaces notable signals", () => {
    expect(shouldSurfaceSignal(makeSignal({ significance: "notable" }))).toBe(true);
  });

  it("does not surface routine signals", () => {
    expect(shouldSurfaceSignal(makeSignal({ significance: "routine" }))).toBe(false);
  });
});

describe("filterSurfaceSignals", () => {
  it("filters out routine signals", () => {
    const signals = [
      makeSignal({ id: "s1", significance: "critical" }),
      makeSignal({ id: "s2", significance: "routine" }),
      makeSignal({ id: "s3", significance: "important" }),
    ];
    const result = filterSurfaceSignals(signals);
    expect(result.length).toBe(2);
    expect(result.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  it("sorts by significance", () => {
    const signals = [
      makeSignal({ id: "s1", significance: "notable" }),
      makeSignal({ id: "s2", significance: "critical" }),
      makeSignal({ id: "s3", significance: "important" }),
    ];
    const result = filterSurfaceSignals(signals);
    expect(result.map((s) => s.id)).toEqual(["s2", "s3", "s1"]);
  });
});

describe("detectNewSignals", () => {
  it("returns all surface signals when no lastVisit", () => {
    const signals = [
      makeSignal({ id: "s1", significance: "critical" }),
      makeSignal({ id: "s2", significance: "routine" }),
    ];
    const result = detectNewSignals(signals, null);
    expect(result.length).toBe(1); // routine filtered out
  });

  it("filters signals by timestamp", () => {
    const now = new Date();
    const old = new Date(now.getTime() - 120_000).toISOString();
    const recent = new Date(now.getTime() - 30_000).toISOString();

    const signals = [
      makeSignal({ id: "s1", significance: "critical", occurredAt: old }),
      makeSignal({ id: "s2", significance: "important", occurredAt: recent }),
    ];
    const result = detectNewSignals(signals, old);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("s2");
  });
});

describe("detectUnseenSignals", () => {
  it("returns signals not in seen state", () => {
    const signals = [
      makeSignal({ id: "s1", significance: "critical" }),
      makeSignal({ id: "s2", significance: "important" }),
    ];
    const seen = new Map<string, SeenSignalState>();
    seen.set("s1", { signalId: "s1", firstSeenAt: new Date().toISOString(), seenCount: 1, lastSeenAt: new Date().toISOString() });

    const result = detectUnseenSignals(signals, seen);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("s2");
  });
});

describe("deduplicateSignals", () => {
  it("removes duplicates within time window", () => {
    const now = new Date().toISOString();
    const signals = [
      makeSignal({ id: "s1", type: "evidence_gap_discovered", entity: { ...baseEntity, id: "c1" }, occurredAt: now }),
      makeSignal({ id: "s2", type: "evidence_gap_discovered", entity: { ...baseEntity, id: "c1" }, occurredAt: now }),
    ];
    const result = deduplicateSignals(signals, 60_000);
    expect(result.length).toBe(1);
  });

  it("keeps signals outside time window", () => {
    const now = Date.now();
    const signals = [
      makeSignal({ id: "s1", type: "evidence_gap_discovered", entity: { ...baseEntity, id: "c1" }, occurredAt: new Date(now - 120_000).toISOString() }),
      makeSignal({ id: "s2", type: "evidence_gap_discovered", entity: { ...baseEntity, id: "c1" }, occurredAt: new Date(now).toISOString() }),
    ];
    const result = deduplicateSignals(signals, 60_000);
    expect(result.length).toBe(2);
  });

  it("keeps different entity types separate", () => {
    const now = new Date().toISOString();
    const signals = [
      makeSignal({ id: "s1", type: "evidence_gap_discovered", entity: { ...baseEntity, id: "c1" }, occurredAt: now }),
      makeSignal({ id: "s2", type: "evidence_gap_discovered", entity: { ...baseEntity, id: "c2" }, occurredAt: now }),
    ];
    const result = deduplicateSignals(signals, 60_000);
    expect(result.length).toBe(2);
  });
});

describe("attentionToSignal", () => {
  it("converts attention item to signal", () => {
    const item = makeAttentionItem({ severity: "critical" });
    const signal = attentionToSignal(item);

    expect(signal.source).toBe("atlas");
    expect(signal.attentionItemId).toBe("att-1");
    expect(signal.significance).toBe("critical");
    expect(signal.entity.id).toBe("claim-123");
    expect(signal.recommendedAction?.label).toBe("Review");
  });

  it("maps severity correctly", () => {
    expect(attentionToSignal(makeAttentionItem({ severity: "critical" })).significance).toBe("critical");
    expect(attentionToSignal(makeAttentionItem({ severity: "high" })).significance).toBe("important");
    expect(attentionToSignal(makeAttentionItem({ severity: "medium" })).significance).toBe("notable");
    expect(attentionToSignal(makeAttentionItem({ severity: "low" })).significance).toBe("routine");
  });
});

describe("decisionToSignal", () => {
  it("converts decision to signal", () => {
    const decision = makeDecision();
    const signal = decisionToSignal(decision);

    expect(signal.source).toBe("atlas");
    expect(signal.decisionId).toBe("dec-1");
    expect(signal.significance).toBe("important"); // high severity → important
    expect(signal.recommendedAction?.label).toBe("Review");
  });
});

describe("activityToSignal", () => {
  it("converts significant activity to signal", () => {
    const activity = makeActivity({ category: "evidence_gap_identified" });
    const signal = activityToSignal(activity);

    expect(signal).not.toBeNull();
    expect(signal!.activityId).toBe("act-1");
    expect(signal!.source).toBe("atlas");
  });

  it("returns null for insignificant activities", () => {
    const activity = makeActivity({ category: "document_viewed" });
    const signal = activityToSignal(activity);

    expect(signal).toBeNull();
  });
});

describe("buildSinceLastVisit", () => {
  it("groups signals by entity", () => {
    const signals = [
      makeSignal({ id: "s1", entity: { ...baseEntity, id: "c1" } }),
      makeSignal({ id: "s2", entity: { ...baseEntity, id: "c1" } }),
      makeSignal({ id: "s3", entity: { ...baseEntity, id: "c2" } }),
    ];
    const result = buildSinceLastVisit(signals);

    expect(result.totalNew).toBe(3);
    expect(result.byEntity.size).toBe(2);
  });

  it("counts by significance", () => {
    const signals = [
      makeSignal({ id: "s1", significance: "critical" }),
      makeSignal({ id: "s2", significance: "critical" }),
      makeSignal({ id: "s3", significance: "important" }),
    ];
    const result = buildSinceLastVisit(signals);

    expect(result.criticalCount).toBe(2);
    expect(result.importantCount).toBe(1);
  });
});

describe("buildProactiveContext", () => {
  it("builds context from signals", () => {
    const signals = [
      makeSignal({ id: "s1", significance: "critical", entity: { ...baseEntity, id: "c1" } }),
      makeSignal({ id: "s2", significance: "important", entity: { ...baseEntity, id: "c2" } }),
    ];
    const context = buildProactiveContext(signals);

    expect(context.newSignalsCount).toBe(2);
    expect(context.criticalSignals.length).toBe(1);
    expect(context.entityIds.length).toBe(2);
  });

  it("returns no significant changes when empty", () => {
    const context = buildProactiveContext([]);

    expect(context.newSignalsCount).toBe(0);
    expect(context.summary).toBe("No significant changes");
  });
});
