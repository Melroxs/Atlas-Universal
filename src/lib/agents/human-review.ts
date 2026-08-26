// ---------------------------------------------------------------------------
// Atlas Human Review — Durable Approval Boundary
//
// Implements the human review gate that pauses agent workflows when
// requires_human_review is true. Reviews are persisted and decisions
// resume or terminate the workflow.
//
// Statuses:
//   pending → approved / rejected / needs_changes
//
// When approved: workflow resumes downstream steps.
// When rejected: workflow terminates with rejection record.
// When needs_changes: specific agent can be re-executed.
// ---------------------------------------------------------------------------

import type {
  ReviewDecision,
  HumanReviewRecord,
  ProvenanceRecord,
} from "../jobs/types";

// ---------------------------------------------------------------------------
// Review Request — what gets stored for the reviewer
// ---------------------------------------------------------------------------

export interface ReviewRequest {
  /** Unique review ID. */
  _id: string;
  /** Job ID this review belongs to. */
  job_id: string;
  /** Step ID that triggered the review. */
  step_id: string | null;
  /** Correlation ID for tracing. */
  correlation_id: string;
  /** Tenant ID — enforced for RLS. */
  tenant_id: string;

  // What to review
  /** Agent type that produced the recommendation. */
  agent_type: string;
  /** The recommendation summary. */
  recommendation_summary: string;
  /** Detailed recommendation data. */
  recommendation_data: Record<string, unknown>;
  /** Financial impact if applicable. */
  financial_impact: number | null;
  /** Supporting evidence/provenance. */
  evidence: ProvenanceRecord[];
  /** Agent confidence score. */
  ai_confidence: number;

  // QA results
  /** QA validation result. */
  qa_passed: boolean | null;
  /** QA score (0-100). */
  qa_score: number | null;
  /** QA issues found. */
  qa_issues: Array<{ severity: string; description: string }>;

  // Agent metadata
  /** Which model produced this. */
  model_used: string | null;
  /** Token usage. */
  token_usage: number;

  // Review state
  status: ReviewDecision;
  reviewer_id: string | null;
  decision_reason: string | null;
  requested_at: string;
  decided_at: string | null;

  // Resume control
  /** Which step should be re-executed on needs_changes. */
  rerun_step: string | null;
}

// ---------------------------------------------------------------------------
// In-memory review store (will be backed by database in production)
// ---------------------------------------------------------------------------

const _reviews = new Map<string, ReviewRequest>();

// ---------------------------------------------------------------------------
// Create a review request
// ---------------------------------------------------------------------------

export function createReviewRequest(params: {
  job_id: string;
  step_id: string | null;
  correlation_id: string;
  tenant_id: string;
  agent_type: string;
  recommendation_summary: string;
  recommendation_data: Record<string, unknown>;
  financial_impact: number | null;
  evidence: ProvenanceRecord[];
  ai_confidence: number;
  qa_passed: boolean | null;
  qa_score: number | null;
  qa_issues: Array<{ severity: string; description: string }>;
  model_used: string | null;
  token_usage: number;
  rerun_step?: string | null;
}): ReviewRequest {
  const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const review: ReviewRequest = {
    _id: reviewId,
    job_id: params.job_id,
    step_id: params.step_id,
    correlation_id: params.correlation_id,
    tenant_id: params.tenant_id,
    agent_type: params.agent_type,
    recommendation_summary: params.recommendation_summary,
    recommendation_data: params.recommendation_data,
    financial_impact: params.financial_impact,
    evidence: params.evidence,
    ai_confidence: params.ai_confidence,
    qa_passed: params.qa_passed,
    qa_score: params.qa_score,
    qa_issues: params.qa_issues,
    model_used: params.model_used,
    token_usage: params.token_usage,
    status: "pending",
    reviewer_id: null,
    decision_reason: null,
    requested_at: new Date().toISOString(),
    decided_at: null,
    rerun_step: params.rerun_step ?? null,
  };

  _reviews.set(reviewId, review);
  return review;
}

// ---------------------------------------------------------------------------
// Get a review request
// ---------------------------------------------------------------------------

export function getReviewRequest(reviewId: string): ReviewRequest | undefined {
  return _reviews.get(reviewId);
}

// ---------------------------------------------------------------------------
// List pending reviews for a tenant
// ---------------------------------------------------------------------------

export function listPendingReviews(tenantId: string): ReviewRequest[] {
  return Array.from(_reviews.values()).filter(
    (r) => r.tenant_id === tenantId && r.status === "pending",
  );
}

// ---------------------------------------------------------------------------
// List all reviews for a job
// ---------------------------------------------------------------------------

export function listJobReviews(jobId: string): ReviewRequest[] {
  return Array.from(_reviews.values()).filter((r) => r.job_id === jobId);
}

// ---------------------------------------------------------------------------
// Approve a review
// ---------------------------------------------------------------------------

export function approveReview(
  reviewId: string,
  reviewerId: string,
  reason?: string,
): ReviewRequest | null {
  const review = _reviews.get(reviewId);
  if (!review || review.status !== "pending") return null;

  review.status = "approved";
  review.reviewer_id = reviewerId;
  review.decision_reason = reason ?? "Approved";
  review.decided_at = new Date().toISOString();

  return review;
}

// ---------------------------------------------------------------------------
// Reject a review
// ---------------------------------------------------------------------------

export function rejectReview(
  reviewId: string,
  reviewerId: string,
  reason: string,
): ReviewRequest | null {
  const review = _reviews.get(reviewId);
  if (!review || review.status !== "pending") return null;

  review.status = "rejected";
  review.reviewer_id = reviewerId;
  review.decision_reason = reason;
  review.decided_at = new Date().toISOString();

  return review;
}

// ---------------------------------------------------------------------------
// Request changes
// ---------------------------------------------------------------------------

export function requestChanges(
  reviewId: string,
  reviewerId: string,
  reason: string,
): ReviewRequest | null {
  const review = _reviews.get(reviewId);
  if (!review || review.status !== "pending") return null;

  review.status = "needs_changes";
  review.reviewer_id = reviewerId;
  review.decision_reason = reason;
  review.decided_at = new Date().toISOString();

  return review;
}

// ---------------------------------------------------------------------------
// Convert to HumanReviewRecord (for database persistence)
// ---------------------------------------------------------------------------

export function toHumanReviewRecord(review: ReviewRequest): HumanReviewRecord {
  return {
    _id: review._id,
    job_id: review.job_id,
    step_id: review.step_id,
    ai_recommendation: review.recommendation_data,
    ai_confidence: review.ai_confidence,
    evidence: review.evidence,
    reviewer_id: review.reviewer_id,
    decision: review.status,
    decision_reason: review.decision_reason,
    requested_at: review.requested_at,
    decided_at: review.decided_at,
  };
}

// ---------------------------------------------------------------------------
// Clear reviews (for testing)
// ---------------------------------------------------------------------------

export function clearReviews(): void {
  _reviews.clear();
}
