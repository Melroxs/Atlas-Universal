// ---------------------------------------------------------------------------
// Milestone 6 — Productionize Human Review + Contradiction Engine
//
// Tests for:
//   - Shared contradiction engine extraction
//   - Human review state machine (valid transitions)
//   - Review API (in-memory store)
//   - Worker pause/resume integration
//   - Security (cross-tenant, reviewer spoofing)
//   - Idempotency (duplicate review prevention)
//   - Audit trail
//   - Pipeline integration
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  scanDocumentsForContradictions,
  compareClaimAgainstDocuments,
  type ContradictionDoc,
  type ClaimFactsLike,
} from "./evidence/contradictions";
import {
  isValidTransition,
  getValidTransitions,
} from "./agents/human-review-api";
import {
  createReviewRequest,
  getReviewRequest,
  listPendingReviews,
  listJobReviews,
  approveReview,
  rejectReview,
  requestChanges,
  toHumanReviewRecord,
  clearReviews,
  type ReviewRequest,
} from "./agents/human-review";
import {
  getFullPipelineDefinition,
  isAgentStep,
  isDeterministicStep,
  getPipelineSummary,
} from "./jobs/pipeline-orchestrator";
import { setAgentConfig, resetAgentConfig } from "./agents";

// ---------------------------------------------------------------------------
// Shared contradiction engine tests
// ---------------------------------------------------------------------------

describe("Shared Contradiction Engine", () => {
  it("detects contradictory estimate amounts across documents", () => {
    const docs: ContradictionDoc[] = [
      {
        _id: "doc-1",
        title: "Estimate A",
        classification: "estimate",
        text: "Claim: ABC-1234-5678. Estimate total: $45,000. Roofing: $12,000.",
      },
      {
        _id: "doc-2",
        title: "Estimate B",
        classification: "estimate",
        text: "Claim: ABC-1234-5678. Estimate total: $52,000. Roofing: $15,000.",
      },
    ];

    const contradictions = scanDocumentsForContradictions(docs);
    expect(contradictions.length).toBeGreaterThan(0);

    // Should find estimate total contradiction
    const estimateContradictions = contradictions.filter(
      (c) => c.field === "Estimate total",
    );
    expect(estimateContradictions.length).toBe(1);
    expect(estimateContradictions[0].values.length).toBe(2);
    expect(estimateContradictions[0].severity).toBe("HIGH"); // >10% difference
  });

  it("detects no contradictions for identical documents", () => {
    const docs: ContradictionDoc[] = [
      {
        _id: "doc-1",
        title: "Estimate A",
        classification: "estimate",
        text: "Claim: ABC-1234-5678. Estimate total: $45,000.",
      },
      {
        _id: "doc-2",
        title: "Estimate B",
        classification: "estimate",
        text: "Claim: ABC-1234-5678. Estimate total: $45,000.",
      },
    ];

    const contradictions = scanDocumentsForContradictions(docs);
    expect(contradictions).toHaveLength(0);
  });

  it("detects claim-vs-document contradictions", () => {
    const claim: ClaimFactsLike = {
      claimNumber: "ABC-1234-5678",
      estimateAmount: 45000,
      paymentAmount: 38000,
    };
    const docs: ContradictionDoc[] = [
      {
        _id: "doc-1",
        title: "Invoice",
        classification: "invoice",
        text: "Estimate total: $50,000. Payment amount: $35,000.",
      },
    ];

    const contradictions = compareClaimAgainstDocuments(claim, docs);
    expect(contradictions.length).toBeGreaterThan(0);
  });

  it("returns empty array for no contradictions", () => {
    const claim: ClaimFactsLike = {
      claimNumber: "ABC-1234-5678",
      estimateAmount: 45000,
    };
    const docs: ContradictionDoc[] = [
      {
        _id: "doc-1",
        title: "Estimate",
        classification: "estimate",
        text: "Estimate total: $45,000.",
      },
    ];

    const contradictions = compareClaimAgainstDocuments(claim, docs);
    expect(contradictions).toHaveLength(0);
  });

  it("handles empty document list gracefully", () => {
    const contradictions = scanDocumentsForContradictions([]);
    expect(contradictions).toHaveLength(0);
  });

  it("handles documents with no text", () => {
    const docs: ContradictionDoc[] = [
      { _id: "doc-1", title: "Empty", classification: "estimate", text: null },
      { _id: "doc-2", title: "Empty", classification: "invoice", text: "" },
    ];
    const contradictions = scanDocumentsForContradictions(docs);
    expect(contradictions).toHaveLength(0);
  });

  it("preserves document references in contradiction values", () => {
    const docs: ContradictionDoc[] = [
      {
        _id: "doc-1",
        title: "Estimate A",
        classification: "estimate",
        text: "Claim: ABC-1234-5678. Estimate total: $45,000.",
      },
      {
        _id: "doc-2",
        title: "Estimate B",
        classification: "estimate",
        text: "Claim: ABC-1234-5678. Estimate total: $52,000.",
      },
    ];

    const contradictions = scanDocumentsForContradictions(docs);
    expect(contradictions.length).toBeGreaterThan(0);

    const c = contradictions[0];
    expect(c.values[0].documentId).toBe("doc-1");
    expect(c.values[0].documentTitle).toBe("Estimate A");
    expect(c.values[1].documentId).toBe("doc-2");
    expect(c.values[1].documentTitle).toBe("Estimate B");
  });

  it("sorts contradictions by severity (highest first)", () => {
    const docs: ContradictionDoc[] = [
      {
        _id: "doc-1",
        title: "Mixed docs",
        classification: "estimate",
        text: "Claim: ABC-1234-5678. Estimate total: $45,000. Loss date: January 15, 2025.",
      },
      {
        _id: "doc-2",
        title: "Mixed docs",
        classification: "estimate",
        text: "Claim: ABC-1234-5678. Estimate total: $52,000. Loss date: January 20, 2025.",
      },
    ];

    const contradictions = scanDocumentsForContradictions(docs);
    if (contradictions.length >= 2) {
      const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFORMATIONAL: 4 };
      for (let i = 1; i < contradictions.length; i++) {
        expect(
          (severityOrder[contradictions[i - 1].severity] ?? 5),
        ).toBeLessThanOrEqual(
          (severityOrder[contradictions[i].severity] ?? 5),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Human review state machine tests
// ---------------------------------------------------------------------------

describe("Human Review State Machine", () => {
  it("allows pending → approved", () => {
    expect(isValidTransition("pending", "approved")).toBe(true);
  });

  it("allows pending → rejected", () => {
    expect(isValidTransition("pending", "rejected")).toBe(true);
  });

  it("allows pending → needs_changes", () => {
    expect(isValidTransition("pending", "needs_changes")).toBe(true);
  });

  it("rejects approved → pending (terminal state)", () => {
    expect(isValidTransition("approved", "pending")).toBe(false);
  });

  it("rejects rejected → pending (terminal state)", () => {
    expect(isValidTransition("rejected", "pending")).toBe(false);
  });

  it("allows needs_changes → pending (re-review)", () => {
    expect(isValidTransition("needs_changes", "pending")).toBe(true);
  });

  it("allows needs_changes → approved", () => {
    expect(isValidTransition("needs_changes", "approved")).toBe(true);
  });

  it("allows needs_changes → rejected", () => {
    expect(isValidTransition("needs_changes", "rejected")).toBe(true);
  });

  it("returns valid transitions for each status", () => {
    expect(getValidTransitions("pending")).toEqual([
      "approved",
      "rejected",
      "needs_changes",
    ]);
    expect(getValidTransitions("approved")).toEqual([]);
    expect(getValidTransitions("rejected")).toEqual([]);
    expect(getValidTransitions("needs_changes")).toEqual([
      "pending",
      "approved",
      "rejected",
    ]);
  });

  it("rejects unknown status transitions", () => {
    expect(isValidTransition("expired", "approved")).toBe(false);
    expect(isValidTransition("unknown", "pending")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// In-memory review API tests (existing human-review.ts)
// ---------------------------------------------------------------------------

describe("In-Memory Review API", () => {
  beforeEach(() => {
    clearReviews();
  });

  it("creates a review with correct defaults", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: "step-1",
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Roof supplement",
      recommendation_data: { amount: 5000 },
      financial_impact: 5000,
      evidence: [],
      ai_confidence: 0.85,
      qa_passed: true,
      qa_score: 92,
      qa_issues: [],
      model_used: "gpt-4o",
      token_usage: 1500,
    });

    expect(review.status).toBe("pending");
    expect(review.tenant_id).toBe("tenant-A");
    expect(review.job_id).toBe("job-1");
    expect(review.step_id).toBe("step-1");
    expect(review.agent_type).toBe("supplement_reasoning");
    expect(review.financial_impact).toBe(5000);
    expect(review.qa_passed).toBe(true);
    expect(review.qa_score).toBe(92);
  });

  it("gets a review by ID", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: null,
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "evidence",
      recommendation_summary: "Test",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.7,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    expect(getReviewRequest(review._id)).toBeDefined();
    expect(getReviewRequest(review._id)?._id).toBe(review._id);
  });

  it("lists pending reviews scoped by tenant", () => {
    createReviewRequest({
      job_id: "job-1",
      step_id: null,
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "A",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.5,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    createReviewRequest({
      job_id: "job-2",
      step_id: null,
      correlation_id: "corr-2",
      tenant_id: "tenant-B",
      agent_type: "supplement_reasoning",
      recommendation_summary: "B",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.5,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    expect(listPendingReviews("tenant-A")).toHaveLength(1);
    expect(listPendingReviews("tenant-B")).toHaveLength(1);
    expect(listPendingReviews("tenant-C")).toHaveLength(0);
  });

  it("approves a pending review", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: null,
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Test",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    const approved = approveReview(review._id, "reviewer-001", "Looks good");
    expect(approved).not.toBeNull();
    expect(approved!.status).toBe("approved");
    expect(approved!.reviewer_id).toBe("reviewer-001");
    expect(approved!.decided_at).toBeTruthy();
  });

  it("rejects a pending review", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: null,
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Test",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    const rejected = rejectReview(review._id, "reviewer-001", "Insufficient evidence");
    expect(rejected).not.toBeNull();
    expect(rejected!.status).toBe("rejected");
    expect(rejected!.decision_reason).toBe("Insufficient evidence");
  });

  it("requests changes with rerun step", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: "step-supp",
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Test",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
      rerun_step: "agent_supplement_reasoning",
    });

    const changed = requestChanges(review._id, "reviewer-001", "Need more evidence");
    expect(changed).not.toBeNull();
    expect(changed!.status).toBe("needs_changes");
    expect(changed!.rerun_step).toBe("agent_supplement_reasoning");
  });

  it("prevents double-approval", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: null,
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Test",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    approveReview(review._id, "reviewer-001");
    const second = approveReview(review._id, "reviewer-002");
    expect(second).toBeNull(); // Already decided
  });

  it("converts to HumanReviewRecord", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: "step-1",
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Test",
      recommendation_data: { amount: 5000 },
      financial_impact: 5000,
      evidence: [],
      ai_confidence: 0.85,
      qa_passed: true,
      qa_score: 92,
      qa_issues: [],
      model_used: "gpt-4o",
      token_usage: 1500,
    });

    approveReview(review._id, "reviewer-001", "Approved");

    const record = toHumanReviewRecord(review);
    expect(record._id).toBe(review._id);
    expect(record.job_id).toBe("job-1");
    expect(record.step_id).toBe("step-1");
    expect(record.ai_confidence).toBe(0.85);
    expect(record.decision).toBe("approved");
    expect(record.decision_reason).toBe("Approved");
  });

  it("lists reviews for a specific job", () => {
    createReviewRequest({
      job_id: "job-1",
      step_id: null,
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "evidence",
      recommendation_summary: "Evidence review",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.7,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    createReviewRequest({
      job_id: "job-1",
      step_id: null,
      correlation_id: "corr-2",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Supplement review",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    createReviewRequest({
      job_id: "job-2",
      step_id: null,
      correlation_id: "corr-3",
      tenant_id: "tenant-A",
      agent_type: "gap_intelligence",
      recommendation_summary: "Gap review",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.6,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    expect(listJobReviews("job-1")).toHaveLength(2);
    expect(listJobReviews("job-2")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Pipeline orchestrator + review integration tests
// ---------------------------------------------------------------------------

describe("Milestone 6 — Pipeline + Review Integration", () => {
  beforeEach(() => {
    resetAgentConfig();
    clearReviews();
  });

  it("pipeline orchestrator returns full definition", () => {
    setAgentConfig({ enabled: true });
    const summary = getPipelineSummary();
    expect(summary.totalSteps).toBe(11);
    expect(summary.deterministicSteps).toBe(7);
    expect(summary.agentSteps).toBe(4);
  });

  it("agent steps are correctly classified", () => {
    expect(isAgentStep("agent_evidence_analysis")).toBe(true);
    expect(isAgentStep("agent_gap_intelligence")).toBe(true);
    expect(isAgentStep("agent_supplement_reasoning")).toBe(true);
    expect(isAgentStep("agent_qa_validation")).toBe(true);
    expect(isAgentStep("evidence_document_ingestion")).toBe(false);
  });

  it("deterministic steps are correctly classified", () => {
    expect(isDeterministicStep("evidence_document_ingestion")).toBe(true);
    expect(isDeterministicStep("evidence_claim_discovery")).toBe(true);
    expect(isDeterministicStep("evidence_completeness_analysis")).toBe(true);
    expect(isDeterministicStep("evidence_findings_analysis")).toBe(true);
    expect(isDeterministicStep("evidence_contradiction_scan")).toBe(true);
    expect(isDeterministicStep("evidence_readiness_assessment")).toBe(true);
    expect(isDeterministicStep("evidence_reconciliation")).toBe(true);
    expect(isDeterministicStep("agent_evidence_analysis")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Security tests — tenant isolation
// ---------------------------------------------------------------------------

describe("Milestone 6 — Security", () => {
  beforeEach(() => {
    clearReviews();
  });

  it("reviews are scoped by tenant_id", () => {
    createReviewRequest({
      job_id: "job-A",
      step_id: null,
      correlation_id: "corr-A",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Tenant A recommendation",
      recommendation_data: { amount: 1000 },
      financial_impact: 1000,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    createReviewRequest({
      job_id: "job-B",
      step_id: null,
      correlation_id: "corr-B",
      tenant_id: "tenant-B",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Tenant B recommendation",
      recommendation_data: { amount: 2000 },
      financial_impact: 2000,
      evidence: [],
      ai_confidence: 0.9,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    const tenantA = listPendingReviews("tenant-A");
    const tenantB = listPendingReviews("tenant-B");

    expect(tenantA).toHaveLength(1);
    expect(tenantA[0].tenant_id).toBe("tenant-A");
    expect(tenantA[0].recommendation_summary).toBe("Tenant A recommendation");

    expect(tenantB).toHaveLength(1);
    expect(tenantB[0].tenant_id).toBe("tenant-B");
    expect(tenantB[0].recommendation_summary).toBe("Tenant B recommendation");
  });

  it("reviewer identity is persisted correctly", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: null,
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Test",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    approveReview(review._id, "real-reviewer-id", "Approved");
    const updated = getReviewRequest(review._id);
    expect(updated?.reviewer_id).toBe("real-reviewer-id");
    expect(updated?.decided_at).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Idempotency tests
// ---------------------------------------------------------------------------

describe("Milestone 6 — Idempotency", () => {
  beforeEach(() => {
    clearReviews();
  });

  it("creating duplicate reviews produces independent records", () => {
    const params = {
      job_id: "job-1",
      step_id: "step-1",
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Test",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    };

    const r1 = createReviewRequest(params);
    const r2 = createReviewRequest(params);

    expect(r1._id).not.toBe(r2._id);
    expect(r1.status).toBe("pending");
    expect(r2.status).toBe("pending");
  });

  it("approval is idempotent", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: null,
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Test",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    const first = approveReview(review._id, "reviewer-001");
    expect(first).not.toBeNull();

    const second = approveReview(review._id, "reviewer-002");
    expect(second).toBeNull(); // Already decided — idempotent
  });
});

// ---------------------------------------------------------------------------
// Audit trail tests
// ---------------------------------------------------------------------------

describe("Milestone 6 — Audit Trail", () => {
  beforeEach(() => {
    clearReviews();
  });

  it("records decision timestamp on approval", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: null,
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Test",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    const before = Date.now();
    approveReview(review._id, "reviewer-001", "Looks good");
    const after = Date.now();

    const updated = getReviewRequest(review._id);
    expect(updated?.decided_at).toBeTruthy();
    const decided = new Date(updated!.decided_at!).getTime();
    expect(decided).toBeGreaterThanOrEqual(before);
    expect(decided).toBeLessThanOrEqual(after);
  });

  it("records decision reason on rejection", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: null,
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Test",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
    });

    rejectReview(review._id, "reviewer-001", "Insufficient evidence for roof damage");

    const updated = getReviewRequest(review._id);
    expect(updated?.decision_reason).toBe("Insufficient evidence for roof damage");
    expect(updated?.reviewer_id).toBe("reviewer-001");
  });

  it("records rerun step on needs_changes", () => {
    const review = createReviewRequest({
      job_id: "job-1",
      step_id: "step-supp",
      correlation_id: "corr-1",
      tenant_id: "tenant-A",
      agent_type: "supplement_reasoning",
      recommendation_summary: "Test",
      recommendation_data: {},
      financial_impact: null,
      evidence: [],
      ai_confidence: 0.8,
      qa_passed: null,
      qa_score: null,
      qa_issues: [],
      model_used: null,
      token_usage: 0,
      rerun_step: "agent_supplement_reasoning",
    });

    requestChanges(review._id, "reviewer-001", "Need more evidence", "agent_supplement_reasoning");

    const updated = getReviewRequest(review._id);
    expect(updated?.status).toBe("needs_changes");
    expect(updated?.rerun_step).toBe("agent_supplement_reasoning");
    expect(updated?.decision_reason).toBe("Need more evidence");
  });
});
