// ---------------------------------------------------------------------------
// Atlas Evidence Pipeline — Trigger Mechanism
//
// Provides functions to enqueue evidence pipeline jobs from existing Atlas
// workflows (document upload, claim creation, manual trigger).
//
// Uses the existing enqueueEvidencePipeline RPC from Milestone 1.
// Feature-flagged via PIPELINE_CONFIG so existing synchronous paths
// are not disrupted.
// ---------------------------------------------------------------------------

import { getSupabaseClient } from "@/lib/supabase";
import { enqueueEvidencePipeline } from "./rpc";
import { getPipelineConfig } from "./pipeline-config";

// ---------------------------------------------------------------------------
// Trigger Result
// ---------------------------------------------------------------------------

export interface TriggerResult {
  /** Whether a pipeline job was actually enqueued. */
  enqueued: boolean;
  /** Job ID if enqueued, null otherwise. */
  job_id: string | null;
  /** Reason when not enqueued. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Trigger: Document Uploaded
//
// Called after a document has been successfully ingested by the existing
// archive/upload flow. Enqueues an evidence pipeline job for the
// document's claim (if one exists).
// ---------------------------------------------------------------------------

export async function triggerOnDocumentUploaded(params: {
  tenant_id: string;
  user_id: string;
  claim_id: string;
  document_id?: string;
}): Promise<TriggerResult> {
  const config = getPipelineConfig();
  if (!config.enabled) {
    return { enqueued: false, job_id: null, reason: "pipeline_disabled" };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { enqueued: false, job_id: null, reason: "no_supabase_client" };
  }

  try {
    const result = await enqueueEvidencePipeline(
      supabase,
      params.tenant_id,
      params.claim_id,
      params.user_id,
    );
    return { enqueued: true, job_id: result.job_id ?? null };
  } catch (err) {
    return {
      enqueued: false,
      job_id: null,
      reason: err instanceof Error ? err.message : "enqueue_failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Trigger: Claim Created
//
// Called after a new claim is created or approved from a claim candidate.
// Enqueues a full evidence pipeline job for the claim.
// ---------------------------------------------------------------------------

export async function triggerOnClaimCreated(params: {
  tenant_id: string;
  user_id: string;
  claim_id: string;
}): Promise<TriggerResult> {
  const config = getPipelineConfig();
  if (!config.enabled) {
    return { enqueued: false, job_id: null, reason: "pipeline_disabled" };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { enqueued: false, job_id: null, reason: "no_supabase_client" };
  }

  try {
    const result = await enqueueEvidencePipeline(
      supabase,
      params.tenant_id,
      params.claim_id,
      params.user_id,
    );
    return { enqueued: true, job_id: result.job_id ?? null };
  } catch (err) {
    return {
      enqueued: false,
      job_id: null,
      reason: err instanceof Error ? err.message : "enqueue_failed",
    };
  }
}

// ---------------------------------------------------------------------------
// Trigger: Manual
//
// Allows users or admin tools to manually trigger an evidence pipeline
// for a specific claim.
// ---------------------------------------------------------------------------

export async function triggerManual(params: {
  tenant_id: string;
  user_id: string;
  claim_id: string;
}): Promise<TriggerResult> {
  const config = getPipelineConfig();
  if (!config.enabled) {
    return { enqueued: false, job_id: null, reason: "pipeline_disabled" };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return { enqueued: false, job_id: null, reason: "no_supabase_client" };
  }

  try {
    const result = await enqueueEvidencePipeline(
      supabase,
      params.tenant_id,
      params.claim_id,
      params.user_id,
    );
    return { enqueued: true, job_id: result.job_id ?? null };
  } catch (err) {
    return {
      enqueued: false,
      job_id: null,
      reason: err instanceof Error ? err.message : "enqueue_failed",
    };
  }
}
