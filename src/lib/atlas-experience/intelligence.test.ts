// ---------------------------------------------------------------------------
// Atlas Intelligence Layer Tests
//
// Tests for the attention model, prioritization engine, intelligence
// collectors, and aggregation logic.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  type AttentionItem,
  type AttentionSeverity,
  type AttentionCategory,
  SEVERITY_ORDER,
  sortAttentionItems,
  filterBySeverity,
  countBySeverity,
  recommendationToAttentionItem,
  claimToAttentionItem,
  pipelineToAttentionItems,
} from "./attention";
import { createAttentionItem } from "./intelligence";
import {
  computePriorityScore,
  prioritizeItems,
  buildIntelligenceSnapshot,
  deduplicateItems,
  filterActiveItems,
  type EnrichedAttentionItem,
} from "./intelligence";
import { collectRevenueIntelligence, type ClaimForIntelligence, type RecommendationForIntelligence } from "./revenue-intelligence";
import { collectEvidenceIntelligence, type DocumentStats, type EntityStats } from "./evidence-intelligence";
import { collectWorkflowIntelligence, type WorkflowForIntelligence } from "./workflow-intelligence";

// ---------------------------------------------------------------------------
// Attention Item Creation
// ---------------------------------------------------------------------------

describe("createAttentionItem", () => {
  it("creates an item with required fields and defaults", () => {
    const item = createAttentionItem({
      id: "test-1",
      severity: "high",
      category: "evidence_gap",
      title: "Missing document",
      explanation: "No inspection report found",
    });

    expect(item.id).toBe("test-1");
    expect(item.severity).toBe("high");
    expect(item.category).toBe("evidence_gap");
    expect(item.status).toBe("open");
    expect(item.timestamp).toBeTypeOf("number");
  });

  it("allows overriding defaults", () => {
    const item = createAttentionItem({
      id: "test-2",
      severity: "critical",
      category: "contradiction",
      title: "Conflict",
      explanation: "Two sources disagree",
      status: "acknowledged",
      navigationTarget: "/some/path",
    });

    expect(item.status).toBe("acknowledged");
    expect(item.navigationTarget).toBe("/some/path");
  });
});

// ---------------------------------------------------------------------------
// Prioritization Engine
// ---------------------------------------------------------------------------

describe("computePriorityScore", () => {
  it("critical items score highest (lowest number)", () => {
    const critical = createAttentionItem({
      id: "c", severity: "critical", category: "recommendation", title: "t", explanation: "e",
    });
    const high = createAttentionItem({
      id: "h", severity: "high", category: "recommendation", title: "t", explanation: "e",
    });
    const medium = createAttentionItem({
      id: "m", severity: "medium", category: "recommendation", title: "t", explanation: "e",
    });

    expect(computePriorityScore(critical)).toBeLessThan(computePriorityScore(high));
    expect(computePriorityScore(high)).toBeLessThan(computePriorityScore(medium));
  });

  it("revenue items score higher than system items", () => {
    const revenue = createAttentionItem({
      id: "r", severity: "medium", category: "recommendation", title: "t", explanation: "e",
      meta: { source: "revenue" },
    });
    const system = createAttentionItem({
      id: "s", severity: "medium", category: "recommendation", title: "t", explanation: "e",
      meta: { source: "system" },
    });

    expect(computePriorityScore(revenue)).toBeLessThan(computePriorityScore(system));
  });

  it("acknowledged items score lower (less urgent)", () => {
    const open = createAttentionItem({
      id: "o", severity: "medium", category: "recommendation", title: "t", explanation: "e",
      status: "open",
    });
    const acked = createAttentionItem({
      id: "a", severity: "medium", category: "recommendation", title: "t", explanation: "e",
      status: "acknowledged",
    });

    expect(computePriorityScore(open)).toBeLessThan(computePriorityScore(acked));
  });

  it("financial impact boosts priority", () => {
    const withMoney = createAttentionItem({
      id: "money", severity: "medium", category: "recommendation", title: "t", explanation: "e",
      meta: { financialImpact: 15000 },
    });
    const withoutMoney = createAttentionItem({
      id: "no-money", severity: "medium", category: "recommendation", title: "t", explanation: "e",
    });

    expect(computePriorityScore(withMoney)).toBeLessThan(computePriorityScore(withoutMoney));
  });
});

describe("prioritizeItems", () => {
  it("sorts by priority score", () => {
    const items: AttentionItem[] = [
      createAttentionItem({ id: "low", severity: "low", category: "recommendation", title: "t", explanation: "e" }),
      createAttentionItem({ id: "critical", severity: "critical", category: "recommendation", title: "t", explanation: "e" }),
      createAttentionItem({ id: "medium", severity: "medium", category: "recommendation", title: "t", explanation: "e" }),
    ];

    const prioritized = prioritizeItems(items);
    expect(prioritized[0].id).toBe("critical");
    expect(prioritized[1].id).toBe("medium");
    expect(prioritized[2].id).toBe("low");
  });

  it("enriches items with priorityScore and ageHours", () => {
    const items = [createAttentionItem({ id: "test", severity: "high", category: "recommendation", title: "t", explanation: "e" })];
    const enriched = prioritizeItems(items);
    expect(enriched[0].priorityScore).toBeTypeOf("number");
    expect(enriched[0].ageHours).toBeTypeOf("number");
  });
});

// ---------------------------------------------------------------------------
// Intelligence Snapshot
// ---------------------------------------------------------------------------

describe("buildIntelligenceSnapshot", () => {
  it("builds a snapshot from items", () => {
    const items = [
      createAttentionItem({ id: "1", severity: "critical", category: "recommendation", title: "t", explanation: "e", meta: { financialImpact: 5000 } }),
      createAttentionItem({ id: "2", severity: "high", category: "evidence_gap", title: "t2", explanation: "e2" }),
    ];

    const snapshot = buildIntelligenceSnapshot(items);
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.counts.critical).toBe(1);
    expect(snapshot.counts.high).toBe(1);
    expect(snapshot.totalFinancialImpact).toBe(5000);
    expect(snapshot.actionRequiredCount).toBe(2);
    expect(snapshot.generatedAt).toBeTypeOf("number");
  });

  it("handles empty items", () => {
    const snapshot = buildIntelligenceSnapshot([]);
    expect(snapshot.items).toHaveLength(0);
    expect(snapshot.totalFinancialImpact).toBe(0);
    expect(snapshot.actionRequiredCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Deduplication & Filtering
// ---------------------------------------------------------------------------

describe("deduplicateItems", () => {
  it("keeps the most recent version of duplicate ids", () => {
    const items = [
      createAttentionItem({ id: "same", severity: "low", category: "recommendation", title: "old", explanation: "e", timestamp: 100 }),
      createAttentionItem({ id: "same", severity: "high", category: "recommendation", title: "new", explanation: "e", timestamp: 200 }),
    ];

    const deduped = deduplicateItems(items);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].title).toBe("new");
  });
});

describe("filterActiveItems", () => {
  it("returns only open and acknowledged items", () => {
    const items = [
      createAttentionItem({ id: "open", severity: "high", category: "recommendation", title: "t", explanation: "e", status: "open" }),
      createAttentionItem({ id: "ack", severity: "high", category: "recommendation", title: "t", explanation: "e", status: "acknowledged" }),
      createAttentionItem({ id: "resolved", severity: "high", category: "recommendation", title: "t", explanation: "e", status: "resolved" }),
    ];

    const active = filterActiveItems(items);
    expect(active).toHaveLength(2);
    expect(active.map((i) => i.id)).toContain("open");
    expect(active.map((i) => i.id)).toContain("ack");
  });
});

// ---------------------------------------------------------------------------
// Revenue Intelligence
// ---------------------------------------------------------------------------

describe("collectRevenueIntelligence", () => {
  it("creates supplement opportunity items for claims with findings", () => {
    const claims: ClaimForIntelligence[] = [
      { _id: "c1", claimNumber: "CLM-1042", customer: "Smith Roofing", openFindings: 3 },
    ];
    const items = collectRevenueIntelligence(claims, []);

    const supplementItems = items.filter((i) => i.category === "supplement_opportunity");
    expect(supplementItems).toHaveLength(1);
    expect(supplementItems[0].severity).toBe("critical"); // 3 findings = critical
  });

  it("creates outstanding amount items", () => {
    const claims: ClaimForIntelligence[] = [
      { _id: "c2", claimNumber: "CLM-1050", outstanding: 8420 },
    ];
    const items = collectRevenueIntelligence(claims, []);

    const outstandingItems = items.filter((i) => i.category === "revenue_opportunity");
    expect(outstandingItems).toHaveLength(1);
    expect(outstandingItems[0].meta?.financialImpact).toBe(8420);
  });

  it("creates incomplete claim items", () => {
    const claims: ClaimForIntelligence[] = [
      { _id: "c3", claimNumber: "CLM-1060", completeness: 2, completenessTotal: 5 },
    ];
    const items = collectRevenueIntelligence(claims, []);

    const incompleteItems = items.filter((i) => i.category === "evidence_gap");
    expect(incompleteItems).toHaveLength(1);
  });

  it("creates discrepancy items", () => {
    const claims: ClaimForIntelligence[] = [
      { _id: "c4", claimNumber: "CLM-1070", hasDiscrepancy: true },
    ];
    const items = collectRevenueIntelligence(claims, []);

    const discrepancyItems = items.filter((i) => i.category === "contradiction");
    expect(discrepancyItems).toHaveLength(1);
  });

  it("creates recommendation items for open recs", () => {
    const recs: RecommendationForIntelligence[] = [
      { _id: "r1", title: "Gap detected", summary: "Evidence missing", priority: "high", status: "open", confidence: 0.85, detectorKey: "gap", _creationTime: Date.now() },
    ];
    const items = collectRevenueIntelligence([], recs);

    const recItems = items.filter((i) => i.category === "recommendation");
    expect(recItems).toHaveLength(1);
  });

  it("does not create items for claims with no issues", () => {
    const claims: ClaimForIntelligence[] = [
      { _id: "c5", claimNumber: "CLM-1080", openFindings: 0, outstanding: 0, completeness: 5, completenessTotal: 5 },
    ];
    const items = collectRevenueIntelligence(claims, []);
    expect(items).toHaveLength(0);
  });

  it("skips closed recommendations", () => {
    const recs: RecommendationForIntelligence[] = [
      { _id: "r2", title: "Done", summary: "Already addressed", priority: "high", status: "approved", confidence: 0.9, detectorKey: "test", _creationTime: Date.now() },
    ];
    const items = collectRevenueIntelligence([], recs);
    expect(items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Evidence Intelligence
// ---------------------------------------------------------------------------

describe("collectEvidenceIntelligence", () => {
  it("creates items for document failures", () => {
    const docStats: DocumentStats = { total: 10, ready: 8, failed: 2 };
    const items = collectEvidenceIntelligence(docStats, {});

    const failureItems = items.filter((i) => i.category === "document_issue");
    expect(failureItems).toHaveLength(1);
  });

  it("creates items for empty knowledge base", () => {
    const items = collectEvidenceIntelligence({}, {});

    const emptyItems = items.filter((i) => i.category === "readiness_warning");
    expect(emptyItems).toHaveLength(1);
  });

  it("does not create empty state when data exists", () => {
    const items = collectEvidenceIntelligence({ total: 5 }, { entities: 10, assertions: 20 });
    expect(items).toHaveLength(0);
  });

  it("creates processing info items", () => {
    const items = collectEvidenceIntelligence({ processing: 3, total: 5 }, { entities: 10 });
    const processingItem = items.find((i) => i.category === "ai_insight");
    expect(processingItem).toBeDefined();
    expect(processingItem!.explanation).toContain("processing");
  });
});

// ---------------------------------------------------------------------------
// Workflow Intelligence
// ---------------------------------------------------------------------------

describe("collectWorkflowIntelligence", () => {
  it("creates items for failed workflows", () => {
    const workflows: WorkflowForIntelligence[] = [
      { _id: "w1", name: "Drive Intelligence", status: "failed", _creationTime: Date.now() },
    ];
    const items = collectWorkflowIntelligence(workflows, {});

    const failedItems = items.filter((i) => i.category === "workflow_failed");
    expect(failedItems).toHaveLength(1);
    expect(failedItems[0].sourceEntityName).toBe("Drive Intelligence");
  });

  it("creates items for pending approvals", () => {
    const workflows: WorkflowForIntelligence[] = [
      { _id: "w2", name: "Document Review", status: "awaiting_approval", _creationTime: Date.now() },
    ];
    const items = collectWorkflowIntelligence(workflows, {});

    const approvalItems = items.filter((i) => i.category === "overdue_task");
    expect(approvalItems).toHaveLength(1);
  });

  it("does not create items for completed workflows", () => {
    const workflows: WorkflowForIntelligence[] = [
      { _id: "w3", name: "Done", status: "completed", _creationTime: Date.now() },
    ];
    const items = collectWorkflowIntelligence(workflows, {});
    expect(items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Severity Ordering
// ---------------------------------------------------------------------------

describe("severity ordering", () => {
  it("critical has the lowest order number (highest priority)", () => {
    expect(SEVERITY_ORDER.critical).toBeLessThan(SEVERITY_ORDER.high);
    expect(SEVERITY_ORDER.high).toBeLessThan(SEVERITY_ORDER.medium);
    expect(SEVERITY_ORDER.medium).toBeLessThan(SEVERITY_ORDER.low);
    expect(SEVERITY_ORDER.low).toBeLessThan(SEVERITY_ORDER.info);
  });
});

describe("sortAttentionItems", () => {
  it("sorts critical first, then by timestamp", () => {
    const items: AttentionItem[] = [
      createAttentionItem({ id: "old-critical", severity: "critical", category: "recommendation", title: "t", explanation: "e", timestamp: 100 }),
      createAttentionItem({ id: "new-low", severity: "low", category: "recommendation", title: "t", explanation: "e", timestamp: 200 }),
      createAttentionItem({ id: "new-critical", severity: "critical", category: "recommendation", title: "t", explanation: "e", timestamp: 300 }),
    ];

    const sorted = sortAttentionItems(items);
    expect(sorted[0].severity).toBe("critical");
    expect(sorted[0].id).toBe("new-critical"); // newer first within same severity
    expect(sorted[1].severity).toBe("critical");
    expect(sorted[1].id).toBe("old-critical");
    expect(sorted[2].severity).toBe("low");
  });
});

describe("filterBySeverity", () => {
  it("filters items at or above the given severity level", () => {
    const items: AttentionItem[] = [
      createAttentionItem({ id: "critical", severity: "critical", category: "recommendation", title: "t", explanation: "e" }),
      createAttentionItem({ id: "medium", severity: "medium", category: "recommendation", title: "t", explanation: "e" }),
      createAttentionItem({ id: "info", severity: "info", category: "recommendation", title: "t", explanation: "e" }),
    ];

    const highAndAbove = filterBySeverity(items, "high");
    expect(highAndAbove).toHaveLength(1);
    expect(highAndAbove[0].id).toBe("critical");
  });
});

describe("countBySeverity", () => {
  it("counts only open items by severity", () => {
    const items: AttentionItem[] = [
      createAttentionItem({ id: "c1", severity: "critical", category: "recommendation", title: "t", explanation: "e", status: "open" }),
      createAttentionItem({ id: "c2", severity: "critical", category: "recommendation", title: "t", explanation: "e", status: "resolved" }),
      createAttentionItem({ id: "h1", severity: "high", category: "recommendation", title: "t", explanation: "e", status: "open" }),
    ];

    const counts = countBySeverity(items);
    expect(counts.critical).toBe(1);
    expect(counts.high).toBe(1);
    expect(counts.medium).toBe(0);
  });
});
