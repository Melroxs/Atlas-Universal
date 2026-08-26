// ---------------------------------------------------------------------------
// Atlas Job Engine — Core Logic
//
// A reusable, testable job lifecycle engine. This module contains:
//   - Job status transitions (the state machine)
//   - Step sequencing and restart logic
//   - Retry with exponential backoff calculation
//   - Idempotency key generation
//   - Structured error handling
//   - AI metadata accumulation
//
// The engine is PURE — no database calls, no RPC imports. It validates
// transitions and produces the data shapes that the RPC layer persists.
// This makes it unit-testable without mocking Supabase.
//
// Usage:
//   The RPC layer (src/lib/jobs/rpc.ts) calls these functions to validate
//   transitions before making database calls. The Edge Function worker
//   calls the engine to determine what to do next after each step.
// ---------------------------------------------------------------------------

import type {
  AtlasJob,
  AtlasJobStep,
  AtlasJobAttempt,
  AIMetadata,
  CreateJobInput,
  EnqueueResult,
  JobError,
  JobStatus,
  JobStepStatus,
  JobPriority,
  PipelineDefinition,
  PipelineStepDefinition,
  ErrorCategory,
} from "./types";
import { classifyError, isRetryableCategory } from "./types";

// ---------------------------------------------------------------------------
// Status transition rules
// ---------------------------------------------------------------------------

/**
 * Legal status transitions for a job.
 * Returns true when `from → to` is a valid transition.
 */
export function isValidJobTransition(from: JobStatus, to: JobStatus): boolean {
  const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
    pending: ["queued", "cancelled"],
    queued: ["processing", "cancelled"],
    processing: ["completed", "failed", "retrying", "awaiting_review", "cancelled"],
    completed: [], // terminal
    failed: ["retrying", "queued"], // manual requeue
    retrying: ["queued", "cancelled"],
    cancelled: [], // terminal
    awaiting_review: ["completed", "failed", "cancelled", "processing"],
  };
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Legal status transitions for a step.
 */
export function isValidStepTransition(from: JobStepStatus, to: JobStepStatus): boolean {
  const TRANSITIONS: Record<JobStepStatus, JobStepStatus[]> = {
    pending: ["processing", "skipped", "cancelled"],
    processing: ["completed", "failed", "cancelled"],
    completed: [], // terminal
    failed: ["pending"], // retry resets to pending
    skipped: [], // terminal
    cancelled: [], // terminal
  };
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Exponential backoff
// ---------------------------------------------------------------------------

const BASE_BACKOFF_MS = 15_000; // 15 seconds
const MAX_BACKOFF_MS = 3_600_000; // 1 hour
const BACKOFF_MULTIPLIER = 2;

/**
 * Calculate the next retry delay using exponential backoff with jitter.
 *
 * delay = min(BASE * multiplier^(attempt-1), MAX) + jitter
 *
 * Jitter is ±20% of the computed delay to prevent thundering herd.
 */
export function calculateBackoffMs(attempt: number): number {
  if (attempt <= 0) return 0;
  const exponential = BASE_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
  const capped = Math.min(exponential, MAX_BACKOFF_MS);
  // Add ±20% jitter
  const jitter = capped * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * Calculate the ISO timestamp for the next retry.
 */
export function nextRetryAt(attempt: number): Date {
  return new Date(Date.now() + calculateBackoffMs(attempt));
}

// ---------------------------------------------------------------------------
// Idempotency key generation
// ---------------------------------------------------------------------------

/**
 * Generate an idempotency key for a job.
 *
 * For deterministic keys (same input = same key), use a custom key.
 * For unique keys, this generates a UUID-based key.
 */
export function generateIdempotencyKey(
  jobType: string,
  tenantId: string,
  payload: Record<string, unknown>,
  deterministic = false,
): string {
  if (deterministic) {
    // Deterministic: hash of tenant + type + payload.
    // Use sorted top-level keys for stable serialization; payload is included
    // as a deep-serialized string (JSON.stringify handles nesting correctly).
    const canonical = JSON.stringify({ jobType, tenantId, payload });
    return `${jobType}:${hashString(canonical)}`;
  }
  // Unique: timestamp-based
  return `${jobType}:${tenantId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

/** Simple string hash (djb2 variant, non-cryptographic but good distribution). */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

// ---------------------------------------------------------------------------
// Job creation validation
// ---------------------------------------------------------------------------

export interface JobValidationError {
  field: string;
  message: string;
}

/**
 * Validate a CreateJobInput before enqueueing.
 * Returns an array of validation errors (empty = valid).
 */
export function validateJobInput(input: CreateJobInput): JobValidationError[] {
  const errors: JobValidationError[] = [];

  if (!input.tenant_id) {
    errors.push({ field: "tenant_id", message: "Tenant ID is required." });
  }
  if (!input.job_type) {
    errors.push({ field: "job_type", message: "Job type is required." });
  }
  if (!input.idempotency_key) {
    errors.push({ field: "idempotency_key", message: "Idempotency key is required." });
  }
  if (input.max_attempts !== undefined && (input.max_attempts < 1 || input.max_attempts > 10)) {
    errors.push({ field: "max_attempts", message: "Max attempts must be between 1 and 10." });
  }
  if (input.priority !== undefined && (input.priority < 1 || input.priority > 5)) {
    errors.push({ field: "priority", message: "Priority must be between 1 and 5." });
  }
  if (!input.payload || typeof input.payload !== "object") {
    errors.push({ field: "payload", message: "Payload must be a non-null object." });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Job state machine transitions
// ---------------------------------------------------------------------------

export interface TransitionResult {
  valid: boolean;
  newStatus?: JobStatus;
  error?: string;
}

/**
 * Attempt a job status transition. Returns the result without side effects.
 */
export function attemptTransition(
  currentStatus: JobStatus,
  targetStatus: JobStatus,
): TransitionResult {
  if (!isValidJobTransition(currentStatus, targetStatus)) {
    return {
      valid: false,
      error: `Invalid transition: ${currentStatus} → ${targetStatus}`,
    };
  }
  return { valid: true, newStatus: targetStatus };
}

/**
 * Determine the next action for a job based on its current state.
 */
export interface NextAction {
  action: "dequeue" | "execute" | "execute_step" | "complete" | "retry" | "escalate" | "none";
  reason: string;
  nextStepIndex?: number;
  retryAt?: Date;
}

export function determineNextAction(job: AtlasJob, steps: AtlasJobStep[]): NextAction {
  // If no steps, the job is a simple one-shot.
  if (steps.length === 0) {
    switch (job.status) {
      case "pending":
      case "queued":
        return { action: "dequeue", reason: "Job is ready for execution." };
      case "processing":
        // Simple job in processing state — handler needs to execute.
        // (The dequeue sets status=processing; the worker must now call the handler.)
        return { action: "execute", reason: "Simple job — execute handler." };
      case "retrying":
        return { action: "retry", reason: "Job scheduled for retry.", retryAt: job.scheduled_at ? new Date(job.scheduled_at) : undefined };
      default:
        return { action: "none", reason: `Job is in terminal state: ${job.status}` };
    }
  }

  // Find the next pending step.
  const pendingSteps = steps
    .filter((s) => s.status === "pending")
    .sort((a, b) => a.sequence - b.sequence);

  // Check for failed steps that need attention.
  const failedSteps = steps.filter((s) => s.status === "failed");

  // All steps completed?
  const completedSteps = steps.filter((s) => s.status === "completed");
  if (completedSteps.length === steps.length) {
    return { action: "complete", reason: "All steps completed successfully." };
  }

  // Any step failed beyond retry limit?
  for (const failed of failedSteps) {
    if (failed.attempt_count >= failed.max_attempts) {
      return {
        action: "escalate",
        reason: `Step "${failed.step_type}" (seq ${failed.sequence}) failed after ${failed.attempt_count} attempts.`,
        nextStepIndex: failed.sequence,
      };
    }
  }

  // There are pending steps — find the first one that can run.
  // (A step can run when all preceding steps are completed.)
  for (const step of pendingSteps) {
    const precedingComplete = steps
      .filter((s) => s.sequence < step.sequence)
      .every((s) => s.status === "completed" || s.status === "skipped");

    if (precedingComplete) {
      return {
        action: "execute_step",
        reason: `Step "${step.step_type}" (seq ${step.sequence}) is ready.`,
        nextStepIndex: step.sequence,
      };
    }
  }

  // Steps are still processing.
  return { action: "none", reason: "Steps are still in progress." };
}

// ---------------------------------------------------------------------------
// Pipeline execution planning
// ---------------------------------------------------------------------------

/**
 * Create job steps from a pipeline definition.
 * Returns the step definitions ordered by sequence.
 */
export function planPipelineSteps(pipeline: PipelineDefinition): PipelineStepDefinition[] {
  return pipeline.steps.map((step, i) => ({
    ...step,
    // Ensure sequence is set correctly.
    id: step.id || `step_${i}`,
  }));
}

/**
 * Map a pipeline step input to actual values from previous step outputs.
 * Input mapping format: { "param_name": "$step_id.output_field" }
 */
export function resolveStepInput(
  mapping: Record<string, string>,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, ref] of Object.entries(mapping)) {
    if (ref.startsWith("$")) {
      // Reference to a previous step output: $step_id.field
      const dotIndex = ref.indexOf(".");
      if (dotIndex > 0) {
        const stepRef = ref.slice(1, dotIndex);
        const field = ref.slice(dotIndex + 1);
        const stepOutput = context[stepRef] as Record<string, unknown> | undefined;
        resolved[key] = stepOutput?.[field];
      } else {
        // Reference to the whole step output
        const stepRef = ref.slice(1);
        resolved[key] = context[stepRef];
      }
    } else {
      // Static value
      resolved[key] = ref;
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// AI metadata helpers
// ---------------------------------------------------------------------------

/**
 * Merge AI metadata from multiple step executions into a job-level summary.
 */
export function mergeAIMetadata(existing: AIMetadata | null, stepMeta: AIMetadata | null): AIMetadata {
  const base: AIMetadata = existing ?? {
    provider: null,
    model: null,
    tokens_used: 0,
    estimated_cost_usd: 0,
    latency_ms: 0,
    confidence: null,
    retry_count: 0,
  };

  if (!stepMeta) return base;

  return {
    provider: stepMeta.provider ?? base.provider,
    model: stepMeta.model ?? base.model,
    tokens_used: (base.tokens_used ?? 0) + (stepMeta.tokens_used ?? 0),
    estimated_cost_usd: (base.estimated_cost_usd ?? 0) + (stepMeta.estimated_cost_usd ?? 0),
    latency_ms: (base.latency_ms ?? 0) + (stepMeta.latency_ms ?? 0),
    confidence: stepMeta.confidence ?? base.confidence,
    retry_count: (base.retry_count ?? 0) + (stepMeta.retry_count ?? 0),
  };
}

/**
 * Create a fresh AI metadata record for a new AI call.
 */
export function createAIMetadata(
  provider: string,
  model: string,
): AIMetadata {
  return {
    provider,
    model,
    tokens_used: 0,
    estimated_cost_usd: 0,
    latency_ms: 0,
    confidence: null,
    retry_count: 0,
  };
}

/**
 * Record the result of an AI call into metadata.
 */
export function recordAICall(
  meta: AIMetadata,
  tokens: number,
  costUsd: number | null,
  latencyMs: number,
  confidence: number | null,
): AIMetadata {
  return {
    ...meta,
    tokens_used: (meta.tokens_used ?? 0) + tokens,
    estimated_cost_usd: (meta.estimated_cost_usd ?? 0) + (costUsd ?? 0),
    latency_ms: (meta.latency_ms ?? 0) + latencyMs,
    confidence: confidence ?? meta.confidence,
  };
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Create a structured job error.
 */
export function createJobError(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
  retryable = true,
): JobError {
  return { code, message, details, retryable };
}

/**
 * Common error codes.
 */
export const JOB_ERROR_CODES = {
  AI_PROVIDER_ERROR: "AI_PROVIDER_ERROR",
  AI_TIMEOUT: "AI_TIMEOUT",
  AI_LOW_CONFIDENCE: "AI_LOW_CONFIDENCE",
  AI_INVALID_OUTPUT: "AI_INVALID_OUTPUT",
  TOOL_AUTHORIZATION_FAILED: "TOOL_AUTHORIZATION_FAILED",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_INPUT_INVALID: "TOOL_INPUT_INVALID",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
  TENANT_ISOLATION_VIOLATION: "TENANT_ISOLATION_VIOLATION",
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  CLAIM_NOT_FOUND: "CLAIM_NOT_FOUND",
  TIMEOUT: "TIMEOUT",
  DEPENDENCY_FAILED: "DEPENDENCY_FAILED",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
  HANDLER_NOT_FOUND: "HANDLER_NOT_FOUND",
  UNKNOWN: "UNKNOWN",
} as const;

// ---------------------------------------------------------------------------
// Error classification integration
// ---------------------------------------------------------------------------

/**
 * Determine whether a job error should be retried, considering both
 * the error's retryable flag AND its classification category.
 * Permanent errors stop retrying even if retryable=true was set.
 */
export function shouldRetry(error: JobError): boolean {
  if (!error.retryable) return false;
  const category = classifyError(error);
  return isRetryableCategory(category);
}

/**
 * Get the error category from a job error.
 */
export function getErrorCategory(error: JobError): ErrorCategory {
  return classifyError(error);
}

// ---------------------------------------------------------------------------
// Stuck job detection
// ---------------------------------------------------------------------------

/**
 * Given a job's lock state, determine if it's stuck.
 * A job is stuck when it's "processing" and its lock has expired.
 */
export function isJobStuck(job: AtlasJob, now = new Date()): boolean {
  if (job.status !== "processing") return false;
  if (!job.lock_expires_at) return false;
  return new Date(job.lock_expires_at) < now;
}

/**
 * Given a job, determine if it's eligible for retry based on its schedule.
 */
export function isJobReadyForRetry(job: AtlasJob, now = new Date()): boolean {
  if (job.status !== "retrying") return false;
  if (!job.scheduled_at) return true;
  return new Date(job.scheduled_at) <= now;
}

// ---------------------------------------------------------------------------
// Step restart (the key feature: restart a single failed step)
// ---------------------------------------------------------------------------

/**
 * Given a set of steps, find the steps that need to be re-executed
 * when a specific step is restarted. Only the failed step and any
 * downstream steps that depend on it need restart.
 */
export function findStepsNeedingRestart(
  steps: AtlasJobStep[],
  failedStepSequence: number,
): AtlasJobStep[] {
  // Steps that depend on the failed step (same or higher sequence) and are
  // not already completed with verified output.
  return steps
    .filter((s) => s.sequence >= failedStepSequence)
    .sort((a, b) => a.sequence - b.sequence);
}

/**
 * Build a summary of step statuses for display/debugging.
 */
export function summarizeSteps(steps: AtlasJobStep[]): string {
  const sorted = [...steps].sort((a, b) => a.sequence - b.sequence);
  return sorted
    .map((s) => {
      const icon =
        s.status === "completed" ? "✓" :
        s.status === "failed" ? "✗" :
        s.status === "processing" ? "⟳" :
        s.status === "skipped" ? "○" :
        s.status === "cancelled" ? "—" :
        "·";
      return `${icon} ${s.step_type}`;
    })
    .join("\n");
}
