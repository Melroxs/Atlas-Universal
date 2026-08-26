// ---------------------------------------------------------------------------
// Atlas Human Review — RPC Wrappers
//
// Client-side functions for human review CRUD via Supabase RPCs.
// Mirrors the pattern established in src/lib/jobs/rpc.ts.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "../supabase";
import type { HumanReviewRow } from "../agents/human-review-api";

// ---------------------------------------------------------------------------
// Create a review
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
  evidence_references: Record<string, unknown>[];
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

  if (error) throw new Error(`human_reviews_create failed: ${error.message}`);
  return data as string;
}

// ---------------------------------------------------------------------------
// Get a review by ID
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// List reviews for a tenant
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// List reviews for a job
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Approve a review
// ---------------------------------------------------------------------------

export async function approveReviewRPC(
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

// ---------------------------------------------------------------------------
// Reject a review
// ---------------------------------------------------------------------------

export async function rejectReviewRPC(
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

// ---------------------------------------------------------------------------
// Request changes
// ---------------------------------------------------------------------------

export async function requestChangesRPC(
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

// ---------------------------------------------------------------------------
// Count pending reviews
// ---------------------------------------------------------------------------

export async function countPendingReviews(tenantId: string): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase client not configured");
  const { data, error } = await supabase.rpc("human_reviews_count_pending", {
    p_tenant_id: tenantId,
  });

  if (error) return 0;
  return (data as number) ?? 0;
}
