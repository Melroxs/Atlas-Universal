// ---------------------------------------------------------------------------
// Atlas Human Review API — Database-backed
//
// Uses Supabase RPCs to persist human reviews durably.
// Falls back to in-memory store for tests (when no Supabase client available).
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "../supabase";
import type { ReviewDecision, ProvenanceRecord } from "../jobs/types";

// ---------------------------------------------------------------------------
// DB Row type (matches the atlas_human_reviews table)
// ---------------------------------------------------------------------------

export interface HumanReviewRow {
  id: string;
  tenant_id: string;
  job_id: string;
  step_id: string | null;
  agent_run_id: string | null;
  claim_id: string | null;
  review_type: string;
  recommendation_summary: string;
  recommendation_data: Record<string, unknown>;
  financial_impact: number | null;
  evidence_references: ProvenanceRecord[];
  ai_confidence: number;
  qa_passed: boolean | null;
  qa_score: number | null;
  qa_issues: Array<{ severity: string; description: string }>;
  agent_type: string;
  model_used: string | null;
  token_usage: number;
  status: ReviewDecision;
  reviewer_user_id: string | null;
  reviewer_notes: string | null;
  requested_at: string;
  decided_at: string | null;
  resolved_at: string | null;
  rerun_step: string | null;
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["approved", "rejected", "needs_changes"],
  needs_changes: ["pending", "approved", "rejected"],
  approved: [], // terminal
  rejected: [], // terminal
  expired: [], // terminal
};

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get all valid transitions from a given status.
 */
export function getValidTransitions(status: string): string[] {
  return VALID_TRANSITIONS[status] ?? [];
}

// ---------------------------------------------------------------------------
// RPC-based API functions
// ---------------------------------------------------------------------------

export async function createReview(params: {
  tenant_id: string;
  job_id: string;
  step_id: string | null;
  agent_run_id: string | null;
  claim_id: string | null;
  review_type: string;
  recommendation_summary: string;
  recommendation_data: Record<string, unknown>;
  financial_impact: number | null;
  evidence_references: ProvenanceRecord[];
  ai_confidence: number;
  qa_passed: boolean | null;
  qa_score: number | null;
  qa_issues: Array<{ severity: string; description: string }>;
  agent_type: string;
  model_used: string | null;
  token_usage: number;
  correlation_id: string | null;
  rerun_step: string | null;
}): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase.rpc("human_reviews_create", {
    p_tenant_id: params.tenant_id,
    p_job_id: params.job_id,
    p_step_id: params.step_id,
    p_agent_run_id: params.agent_run_id,
    p_claim_id: params.claim_id,
    p_review_type: params.review_type,
    p_recommendation_summary: params.recommendation_summary,
    p_recommendation_data: params.recommendation_data,
    p_financial_impact: params.financial_impact,
    p_evidence_references: params.evidence_references,
    p_ai_confidence: params.ai_confidence,
    p_qa_passed: params.qa_passed,
    p_qa_score: params.qa_score,
    p_qa_issues: params.qa_issues,
    p_agent_type: params.agent_type,
    p_model_used: params.model_used,
    p_token_usage: params.token_usage,
    p_correlation_id: params.correlation_id,
    p_rerun_step: params.rerun_step,
  });

  if (error) throw new Error(`Failed to create review: ${error.message}`);
  return data as string;
}

export async function getReview(reviewId: string): Promise<HumanReviewRow | null> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase
    .from("atlas_human_reviews")
    .select("*")
    .eq("id", reviewId)
    .single();

  if (error || !data) return null;
  return data as HumanReviewRow;
}

export async function listReviews(
  tenantId: string,
  status?: string | null,
  limit = 50,
  offset = 0,
): Promise<HumanReviewRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client not configured");
  let query = supabase
    .from("atlas_human_reviews")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as HumanReviewRow[];
}

export async function listJobReviews(jobId: string): Promise<HumanReviewRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase
    .from("atlas_human_reviews")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data ?? []) as HumanReviewRow[];
}

export async function approveReview(
  reviewId: string,
  reviewerId: string,
  notes = "Approved",
): Promise<HumanReviewRow | null> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase.rpc("human_reviews_approve", {
    p_review_id: reviewId,
    p_reviewer_id: reviewerId,
    p_notes: notes,
  });

  if (error) return null;
  return data as unknown as HumanReviewRow;
}

export async function rejectReview(
  reviewId: string,
  reviewerId: string,
  reason: string,
): Promise<HumanReviewRow | null> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase.rpc("human_reviews_reject", {
    p_review_id: reviewId,
    p_reviewer_id: reviewerId,
    p_notes: reason,
  });

  if (error) return null;
  return data as unknown as HumanReviewRow;
}

export async function requestChanges(
  reviewId: string,
  reviewerId: string,
  reason: string,
  rerunStep?: string,
): Promise<HumanReviewRow | null> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase.rpc("human_reviews_request_changes", {
    p_review_id: reviewId,
    p_reviewer_id: reviewerId,
    p_notes: reason,
    p_rerun_step: rerunStep ?? null,
  });

  if (error) return null;
  return data as unknown as HumanReviewRow;
}

export async function countPendingReviews(tenantId: string): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase.rpc("human_reviews_count_pending", {
    p_tenant_id: tenantId,
  });

  if (error) return 0;
  return (data as number) ?? 0;
}
