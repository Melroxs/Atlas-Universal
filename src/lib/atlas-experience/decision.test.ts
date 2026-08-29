// ---------------------------------------------------------------------------
// Atlas Decision Model Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  type AtlasDecision,
  DECISION_STATUS_LABELS,
  DECISION_STATUS_STYLES,
  SEVERITY_PRIORITY,
  getConfidenceLabel,
  getConfidenceStyle,
  recommendationStatusToDecisionStatus,
  recommendationToDecision,
  attentionItemToDecision,
  sortDecisionsByImportance,
  filterDecisionsByStatus,
  getDecisionsRequiringApproval,
  getHighImpactDecisions,
  getTotalPotentialImpact,
} from "./decision";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDecision(overrides: Partial<AtlasDecision> = {}): AtlasDecision {
  return {
    id: `dec-${Math.random().toString(36).slice(2, 8)}`,
    entity: { type: "claim", id: "claim-1", label: "Test Claim" },
    observation: { title: "Test observation", summary: "Test summary" },
    importance: { severity: "medium" },
    evidence: [],
    recommendation: { title: "Test recommendation", summary: "Test rec summary", reasoning: "Because" },
    status: "new",
    requiresApproval: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants Tests
// ---------------------------------------------------------------------------

describe("Decision constants", () => {
  it("has a label for every status", () => {
    for (const status of Object.keys(DECISION_STATUS_LABELS)) {
      expect(typeof DECISION_STATUS_LABELS[status as keyof typeof DECISION_STATUS_LABELS]).toBe("string");
    }
  });

  it("has styling for every status", () => {
    for (const status of Object.keys(DECISION_STATUS_STYLES)) {
      expect(typeof DECISION_STATUS_STYLES[status as keyof typeof DECISION_STATUS_STYLES]).toBe("string");
    }
  });

  it("severity priority has correct ordering", () => {
    expect(SEVERITY_PRIORITY.critical).toBeLessThan(SEVERITY_PRIORITY.high);
    expect(SEVERITY_PRIORITY.high).toBeLessThan(SEVERITY_PRIORITY.medium);
    expect(SEVERITY_PRIORITY.medium).toBeLessThan(SEVERITY_PRIORITY.low);
  });
});

// ---------------------------------------------------------------------------
// Confidence Tests
// ---------------------------------------------------------------------------

describe("getConfidenceLabel", () => {
  it("returns correct labels", () => {
    expect(getConfidenceLabel(0.9)).toBe("High confidence");
    expect(getConfidenceLabel(0.6)).toBe("Moderate confidence");
    expect(getConfidenceLabel(0.3)).toBe("Low confidence");
    expect(getConfidenceLabel(undefined)).toBe("Evidence incomplete");
  });
});

describe("getConfidenceStyle", () => {
  it("returns correct styles", () => {
    expect(getConfidenceStyle(0.9)).toContain("emerald");
    expect(getConfidenceStyle(0.6)).toContain("amber");
    expect(getConfidenceStyle(0.3)).toContain("rose");
    expect(getConfidenceStyle(undefined)).toContain("muted");
  });
});

// ---------------------------------------------------------------------------
// Status Mapping Tests
// ---------------------------------------------------------------------------

describe("recommendationStatusToDecisionStatus", () => {
  it("maps all statuses correctly", () => {
    expect(recommendationStatusToDecisionStatus("open")).toBe("new");
    expect(recommendationStatusToDecisionStatus("approved")).toBe("approved");
    expect(recommendationStatusToDecisionStatus("rejected")).toBe("rejected");
    expect(recommendationStatusToDecisionStatus("executed")).toBe("executed");
    expect(recommendationStatusToDecisionStatus("dismissed")).toBe("dismissed");
    expect(recommendationStatusToDecisionStatus("unknown")).toBe("new");
  });
});

// ---------------------------------------------------------------------------
// Factory Tests
// ---------------------------------------------------------------------------

describe("recommendationToDecision", () => {
  it("converts a recommendation to AtlasDecision", () => {
    const decision = recommendationToDecision({
      _id: "rec-1",
      _creationTime: 1000000,
      title: "Supplement opportunity",
      summary: "Additional scope identified",
      reason: "Estimate analysis found gaps",
      priority: "high",
      status: "open",
      confidence: 0.85,
      expectedImpact: "$8,420",
      risk: "Carrier may dispute",
      detectorKey: "supplement_opportunity",
      evidence: [
        { kind: "document", title: "Estimate.pdf", relevance: 0.9, snippet: "Line item X" },
        { kind: "entity", title: "Claim #1042", relevance: 0.7 },
      ],
    });

    expect(decision.id).toBe("rec-1");
    expect(decision.observation.title).toBe("Supplement opportunity");
    expect(decision.importance.severity).toBe("high");
    expect(decision.importance.impact).toBe(8420);
    expect(decision.evidence.length).toBe(2);
    expect(decision.recommendation.confidence).toBe(0.85);
    expect(decision.status).toBe("new");
    expect(decision.requiresApproval).toBe(true);
  });

  it("parses financial impact correctly", () => {
    const decision = recommendationToDecision({
      _id: "rec-2",
      _creationTime: 1000000,
      title: "Test",
      summary: "Test",
      reason: "Test",
      priority: "medium",
      status: "open",
      confidence: 0.5,
      expectedImpact: "Potential recovery of $12,500",
      detectorKey: "revenue_opportunity",
      evidence: [],
    });

    expect(decision.importance.impact).toBe(12500);
  });

  it("handles missing financial impact", () => {
    const decision = recommendationToDecision({
      _id: "rec-3",
      _creationTime: 1000000,
      title: "Test",
      summary: "Test",
      reason: "Test",
      priority: "low",
      status: "open",
      confidence: 0.5,
      detectorKey: "test",
      evidence: [],
    });

    expect(decision.importance.impact).toBeUndefined();
  });
});

describe("attentionItemToDecision", () => {
  it("converts attention item to decision", () => {
    const decision = attentionItemToDecision({
      id: "att-1",
      type: "evidence_gap",
      severity: "high",
      title: "Missing scope documentation",
      summary: "Required docs not on file",
      entityType: "claim",
      entityId: "claim-123",
      confidence: 0.7,
    });

    expect(decision.entity.type).toBe("claim");
    expect(decision.entity.id).toBe("claim-123");
    expect(decision.importance.severity).toBe("high");
    expect(decision.recommendation.confidence).toBe(0.7);
    expect(decision.attentionItemId).toBe("att-1");
  });
});

// ---------------------------------------------------------------------------
// Filtering Tests
// ---------------------------------------------------------------------------

describe("sortDecisionsByImportance", () => {
  it("sorts critical first", () => {
    const decisions = [
      makeDecision({ importance: { severity: "low" } }),
      makeDecision({ importance: { severity: "critical" } }),
      makeDecision({ importance: { severity: "medium" } }),
    ];

    const sorted = sortDecisionsByImportance(decisions);
    expect(sorted[0].importance.severity).toBe("critical");
    expect(sorted[1].importance.severity).toBe("medium");
    expect(sorted[2].importance.severity).toBe("low");
  });
});

describe("filterDecisionsByStatus", () => {
  it("filters by status", () => {
    const decisions = [
      makeDecision({ status: "new" }),
      makeDecision({ status: "approved" }),
      makeDecision({ status: "new" }),
    ];

    expect(filterDecisionsByStatus(decisions, "new").length).toBe(2);
    expect(filterDecisionsByStatus(decisions, "approved").length).toBe(1);
    expect(filterDecisionsByStatus(decisions, "rejected").length).toBe(0);
  });
});

describe("getDecisionsRequiringApproval", () => {
  it("returns only new decisions requiring approval", () => {
    const decisions = [
      makeDecision({ status: "new", requiresApproval: true }),
      makeDecision({ status: "new", requiresApproval: false }),
      makeDecision({ status: "approved", requiresApproval: true }),
    ];

    const pending = getDecisionsRequiringApproval(decisions);
    expect(pending.length).toBe(1);
    expect(pending[0].requiresApproval).toBe(true);
  });
});

describe("getHighImpactDecisions", () => {
  it("returns high-severity and high-impact decisions", () => {
    const decisions = [
      makeDecision({ importance: { severity: "critical" } }),
      makeDecision({ importance: { severity: "low" } }),
      makeDecision({ importance: { severity: "medium", impact: 10000 } }),
    ];

    const highImpact = getHighImpactDecisions(decisions);
    expect(highImpact.length).toBe(2);
  });
});

describe("getTotalPotentialImpact", () => {
  it("sums financial impacts", () => {
    const decisions = [
      makeDecision({ importance: { severity: "high", impact: 8000 } }),
      makeDecision({ importance: { severity: "medium", impact: 3000 } }),
      makeDecision({ importance: { severity: "low" } }),
    ];

    expect(getTotalPotentialImpact(decisions)).toBe(11000);
  });
});
