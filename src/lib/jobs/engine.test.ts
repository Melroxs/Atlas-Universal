// ---------------------------------------------------------------------------
// Atlas Job Engine — Unit Tests
//
// Tests the pure TypeScript job engine logic. No Supabase, no network,
// no mocking — just state machine validation, backoff math, idempotency
// key generation, step restart logic, and AI metadata accumulation.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import {
  isValidJobTransition,
  isValidStepTransition,
  calculateBackoffMs,
  nextRetryAt,
  generateIdempotencyKey,
  validateJobInput,
  attemptTransition,
  determineNextAction,
  mergeAIMetadata,
  createAIMetadata,
  recordAICall,
  createJobError,
  JOB_ERROR_CODES,
  isJobStuck,
  isJobReadyForRetry,
  findStepsNeedingRestart,
  summarizeSteps,
  planPipelineSteps,
  resolveStepInput,
} from "./engine";
import type { AtlasJob, AtlasJobStep, CreateJobInput, PipelineDefinition } from "./types";

// ---------------------------------------------------------------------------
// Job status transitions
// ---------------------------------------------------------------------------

describe("isValidJobTransition", () => {
  it("allows pending → queued", () => {
    expect(isValidJobTransition("pending", "queued")).toBe(true);
  });

  it("allows pending → cancelled", () => {
    expect(isValidJobTransition("pending", "cancelled")).toBe(true);
  });

  it("allows queued → processing", () => {
    expect(isValidJobTransition("queued", "processing")).toBe(true);
  });

  it("allows processing → completed", () => {
    expect(isValidJobTransition("processing", "completed")).toBe(true);
  });

  it("allows processing → failed", () => {
    expect(isValidJobTransition("processing", "failed")).toBe(true);
  });

  it("allows processing → retrying", () => {
    expect(isValidJobTransition("processing", "retrying")).toBe(true);
  });

  it("allows processing → awaiting_review", () => {
    expect(isValidJobTransition("processing", "awaiting_review")).toBe(true);
  });

  it("allows failed → queued (manual requeue)", () => {
    expect(isValidJobTransition("failed", "queued")).toBe(true);
  });

  it("allows retrying → queued", () => {
    expect(isValidJobTransition("retrying", "queued")).toBe(true);
  });

  it("allows awaiting_review → completed", () => {
    expect(isValidJobTransition("awaiting_review", "completed")).toBe(true);
  });

  it("allows awaiting_review → processing (re-run after review)", () => {
    expect(isValidJobTransition("awaiting_review", "processing")).toBe(true);
  });

  it("rejects completed → any (terminal)", () => {
    expect(isValidJobTransition("completed", "processing")).toBe(false);
    expect(isValidJobTransition("completed", "failed")).toBe(false);
    expect(isValidJobTransition("completed", "queued")).toBe(false);
  });

  it("rejects cancelled → any (terminal)", () => {
    expect(isValidJobTransition("cancelled", "processing")).toBe(false);
    expect(isValidJobTransition("cancelled", "queued")).toBe(false);
  });

  it("rejects pending → completed (must go through processing)", () => {
    expect(isValidJobTransition("pending", "completed")).toBe(false);
  });

  it("rejects queued → completed (must go through processing)", () => {
    expect(isValidJobTransition("queued", "completed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Step status transitions
// ---------------------------------------------------------------------------

describe("isValidStepTransition", () => {
  it("allows pending → processing", () => {
    expect(isValidStepTransition("pending", "processing")).toBe(true);
  });

  it("allows pending → skipped", () => {
    expect(isValidStepTransition("pending", "skipped")).toBe(true);
  });

  it("allows processing → completed", () => {
    expect(isValidStepTransition("processing", "completed")).toBe(true);
  });

  it("allows processing → failed", () => {
    expect(isValidStepTransition("processing", "failed")).toBe(true);
  });

  it("allows failed → pending (retry)", () => {
    expect(isValidStepTransition("failed", "pending")).toBe(true);
  });

  it("rejects completed → any (terminal)", () => {
    expect(isValidStepTransition("completed", "pending")).toBe(false);
    expect(isValidStepTransition("completed", "failed")).toBe(false);
  });

  it("rejects skipped → any (terminal)", () => {
    expect(isValidStepTransition("skipped", "pending")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Exponential backoff
// ---------------------------------------------------------------------------

describe("calculateBackoffMs", () => {
  it("returns 0 for attempt 0", () => {
    expect(calculateBackoffMs(0)).toBe(0);
  });

  it("returns approximately 15s for attempt 1", () => {
    const ms = calculateBackoffMs(1);
    // Base is 15000, jitter is ±20% = 12000..18000
    expect(ms).toBeGreaterThanOrEqual(12000);
    expect(ms).toBeLessThanOrEqual(18000);
  });

  it("returns approximately 30s for attempt 2", () => {
    const ms = calculateBackoffMs(2);
    expect(ms).toBeGreaterThanOrEqual(24000);
    expect(ms).toBeLessThanOrEqual(36000);
  });

  it("returns approximately 60s for attempt 3", () => {
    const ms = calculateBackoffMs(3);
    expect(ms).toBeGreaterThanOrEqual(48000);
    expect(ms).toBeLessThanOrEqual(72000);
  });

  it("caps at 1 hour (3600000 ms)", () => {
    const ms = calculateBackoffMs(20);
    expect(ms).toBeLessThanOrEqual(4320000); // 3600000 * 1.2 (with jitter)
  });

  it("is non-negative for all attempts", () => {
    for (let i = 0; i <= 20; i++) {
      expect(calculateBackoffMs(i)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("nextRetryAt", () => {
  it("returns a Date in the future", () => {
    const before = Date.now();
    const retryAt = nextRetryAt(1);
    expect(retryAt.getTime()).toBeGreaterThan(before);
  });

  it("returns a later date for higher attempt numbers", () => {
    const retry1 = nextRetryAt(1);
    const retry3 = nextRetryAt(3);
    // retry3 should generally be later (ignoring jitter, the base doubles)
    expect(retry3.getTime()).toBeGreaterThan(retry1.getTime() - 5000); // allow jitter
  });
});

// ---------------------------------------------------------------------------
// Idempotency key generation
// ---------------------------------------------------------------------------

describe("generateIdempotencyKey", () => {
  it("generates unique keys for unique invocations", () => {
    const key1 = generateIdempotencyKey("test", "tenant-1", { a: 1 });
    const key2 = generateIdempotencyKey("test", "tenant-1", { a: 1 });
    expect(key1).not.toBe(key2);
  });

  it("generates deterministic keys when requested", () => {
    const key1 = generateIdempotencyKey("test", "tenant-1", { a: 1 }, true);
    const key2 = generateIdempotencyKey("test", "tenant-1", { a: 1 }, true);
    expect(key1).toBe(key2);
  });

  it("generates different deterministic keys for different inputs", () => {
    const key1 = generateIdempotencyKey("test", "tenant-1", { a: 1 }, true);
    const key2 = generateIdempotencyKey("test", "tenant-1", { a: 2 }, true);
    expect(key1).not.toBe(key2);
  });

  it("keys include the job type prefix", () => {
    const key = generateIdempotencyKey("evidence_pipeline", "t1", {}, true);
    expect(key.startsWith("evidence_pipeline:")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe("validateJobInput", () => {
  const validInput: CreateJobInput = {
    tenant_id: "tenant-1",
    job_type: "evidence_ingestion",
    idempotency_key: "key-1",
    payload: { test: true },
  };

  it("returns no errors for valid input", () => {
    expect(validateJobInput(validInput)).toHaveLength(0);
  });

  it("requires tenant_id", () => {
    const errors = validateJobInput({ ...validInput, tenant_id: "" });
    expect(errors.some((e) => e.field === "tenant_id")).toBe(true);
  });

  it("requires job_type", () => {
    const errors = validateJobInput({ ...validInput, job_type: "" as any });
    expect(errors.some((e) => e.field === "job_type")).toBe(true);
  });

  it("requires idempotency_key", () => {
    const errors = validateJobInput({ ...validInput, idempotency_key: "" });
    expect(errors.some((e) => e.field === "idempotency_key")).toBe(true);
  });

  it("validates max_attempts range", () => {
    const errors = validateJobInput({ ...validInput, max_attempts: 0 });
    expect(errors.some((e) => e.field === "max_attempts")).toBe(true);

    const errors2 = validateJobInput({ ...validInput, max_attempts: 11 });
    expect(errors2.some((e) => e.field === "max_attempts")).toBe(true);
  });

  it("validates priority range", () => {
    const errors = validateJobInput({ ...validInput, priority: 0 as any });
    expect(errors.some((e) => e.field === "priority")).toBe(true);

    const errors2 = validateJobInput({ ...validInput, priority: 6 as any });
    expect(errors2.some((e) => e.field === "priority")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Status transition helper
// ---------------------------------------------------------------------------

describe("attemptTransition", () => {
  it("returns valid for legal transitions", () => {
    const result = attemptTransition("pending", "queued");
    expect(result.valid).toBe(true);
    expect(result.newStatus).toBe("queued");
  });

  it("returns invalid for illegal transitions", () => {
    const result = attemptTransition("completed", "processing");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid transition");
  });
});

// ---------------------------------------------------------------------------
// Next action determination
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<AtlasJob> = {}): AtlasJob {
  return {
    _id: "job-1",
    _creationTime: Date.now(),
    tenant_id: "tenant-1",
    user_id: null,
    job_type: "evidence_ingestion",
    status: "processing",
    priority: 3,
    idempotency_key: "key-1",
    payload: {},
    result: null,
    error: null,
    attempt_count: 1,
    max_attempts: 3,
    scheduled_at: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    locked_by: null,
    locked_at: null,
    lock_expires_at: null,
    parent_job_id: null,
    current_step_id: null,
    tags: [],
    ai_metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeStep(overrides: Partial<AtlasJobStep> = {}): AtlasJobStep {
  return {
    _id: "step-1",
    _creationTime: Date.now(),
    job_id: "job-1",
    step_type: "ingestion",
    sequence: 0,
    status: "pending",
    input: {},
    output: null,
    error: null,
    attempt_count: 0,
    max_attempts: 3,
    started_at: null,
    completed_at: null,
    ai_metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("determineNextAction", () => {
  it("dequeues a pending job with no steps", () => {
    const job = makeJob({ status: "pending" });
    const action = determineNextAction(job, []);
    expect(action.action).toBe("dequeue");
  });

  it("executes a processing job with no steps (simple job)", () => {
    const job = makeJob({ status: "processing" });
    const action = determineNextAction(job, []);
    expect(action.action).toBe("execute");
  });

  it("returns none for completed jobs", () => {
    const job = makeJob({ status: "completed" });
    const action = determineNextAction(job, []);
    expect(action.action).toBe("none");
  });

  it("completes when all steps are done", () => {
    const steps = [
      makeStep({ status: "completed", sequence: 0 }),
      makeStep({ _id: "step-2", status: "completed", sequence: 1, step_type: "extraction" }),
    ];
    const job = makeJob({ status: "processing" });
    const action = determineNextAction(job, steps);
    expect(action.action).toBe("complete");
  });

  it("executes the next pending step when preceding steps are complete", () => {
    const steps = [
      makeStep({ status: "completed", sequence: 0 }),
      makeStep({ _id: "step-2", status: "pending", sequence: 1, step_type: "extraction" }),
      makeStep({ _id: "step-3", status: "pending", sequence: 2, step_type: "classification" }),
    ];
    const job = makeJob({ status: "processing" });
    const action = determineNextAction(job, steps);
    expect(action.action).toBe("execute_step");
    expect(action.nextStepIndex).toBe(1);
  });

  it("escalates when a step exceeds max attempts", () => {
    const steps = [
      makeStep({ status: "completed", sequence: 0 }),
      makeStep({
        _id: "step-2",
        status: "failed",
        sequence: 1,
        step_type: "extraction",
        attempt_count: 3,
        max_attempts: 3,
      }),
    ];
    const job = makeJob({ status: "processing" });
    const action = determineNextAction(job, steps);
    expect(action.action).toBe("escalate");
    expect(action.reason).toContain("extraction");
  });

  it("retries a retrying job", () => {
    const job = makeJob({
      status: "retrying",
      scheduled_at: new Date(Date.now() + 60000).toISOString(),
    });
    const action = determineNextAction(job, []);
    expect(action.action).toBe("retry");
  });
});

// ---------------------------------------------------------------------------
// AI metadata
// ---------------------------------------------------------------------------

describe("mergeAIMetadata", () => {
  it("creates base metadata when existing is null", () => {
    const result = mergeAIMetadata(null, createAIMetadata("openai", "gpt-4"));
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4");
    expect(result.tokens_used).toBe(0);
  });

  it("accumulates tokens and cost across step executions", () => {
    const base = createAIMetadata("openai", "gpt-4");
    const after1 = recordAICall(base, 1000, 0.02, 500, 0.85);
    const after2 = recordAICall(after1, 500, 0.01, 300, 0.9);

    expect(after2.tokens_used).toBe(1500);
    expect(after2.estimated_cost_usd).toBeCloseTo(0.03);
    expect(after2.latency_ms).toBe(800);
    expect(after2.confidence).toBe(0.9); // latest wins
  });

  it("merges step metadata into existing", () => {
    const existing = recordAICall(
      createAIMetadata("openai", "gpt-4"),
      1000, 0.02, 500, 0.85,
    );
    const stepMeta = recordAICall(
      createAIMetadata("anthropic", "claude-3"),
      800, 0.015, 400, 0.9,
    );

    const merged = mergeAIMetadata(existing, stepMeta);
    expect(merged.tokens_used).toBe(1800);
    expect(merged.estimated_cost_usd).toBeCloseTo(0.035);
    expect(merged.provider).toBe("anthropic"); // step provider wins
  });
});

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

describe("createJobError", () => {
  it("creates a structured error with default retryable", () => {
    const err = createJobError(JOB_ERROR_CODES.AI_PROVIDER_ERROR, "Provider down");
    expect(err.code).toBe("AI_PROVIDER_ERROR");
    expect(err.message).toBe("Provider down");
    expect(err.retryable).toBe(true);
  });

  it("respects custom retryable flag", () => {
    const err = createJobError(
      JOB_ERROR_CODES.TENANT_ISOLATION_VIOLATION,
      "Cross-tenant access",
      {},
      false,
    );
    expect(err.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stuck job detection
// ---------------------------------------------------------------------------

describe("isJobStuck", () => {
  it("detects a stuck processing job with expired lock", () => {
    const job = makeJob({
      status: "processing",
      lock_expires_at: new Date(Date.now() - 60000).toISOString(),
    });
    expect(isJobStuck(job)).toBe(true);
  });

  it("does not flag a job with a valid lock", () => {
    const job = makeJob({
      status: "processing",
      lock_expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    expect(isJobStuck(job)).toBe(false);
  });

  it("does not flag non-processing jobs", () => {
    expect(isJobStuck(makeJob({ status: "completed" }))).toBe(false);
    expect(isJobStuck(makeJob({ status: "queued" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Retry readiness
// ---------------------------------------------------------------------------

describe("isJobReadyForRetry", () => {
  it("returns true for retrying jobs past their schedule", () => {
    const job = makeJob({
      status: "retrying",
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(isJobReadyForRetry(job)).toBe(true);
  });

  it("returns false for retrying jobs not yet scheduled", () => {
    const job = makeJob({
      status: "retrying",
      scheduled_at: new Date(Date.now() + 60000).toISOString(),
    });
    expect(isJobReadyForRetry(job)).toBe(false);
  });

  it("returns false for non-retrying jobs", () => {
    expect(isJobReadyForRetry(makeJob({ status: "processing" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Step restart
// ---------------------------------------------------------------------------

describe("findStepsNeedingRestart", () => {
  const steps = [
    makeStep({ sequence: 0, step_type: "ingestion", status: "completed" }),
    makeStep({ _id: "step-2", sequence: 1, step_type: "extraction", status: "completed" }),
    makeStep({ _id: "step-3", sequence: 2, step_type: "classification", status: "failed" }),
    makeStep({ _id: "step-4", sequence: 3, step_type: "entity_resolution", status: "pending" }),
  ];

  it("finds the failed step and all downstream steps", () => {
    const needingRestart = findStepsNeedingRestart(steps, 2);
    expect(needingRestart.map((s) => s.sequence)).toEqual([2, 3]);
  });

  it("does not include completed steps before the failure", () => {
    const needingRestart = findStepsNeedingRestart(steps, 2);
    expect(needingRestart.every((s) => s.sequence >= 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Summarize steps
// ---------------------------------------------------------------------------

describe("summarizeSteps", () => {
  it("produces a readable summary with icons", () => {
    const steps = [
      makeStep({ step_type: "ingestion", status: "completed" }),
      makeStep({ _id: "s2", step_type: "extraction", status: "failed" }),
      makeStep({ _id: "s3", step_type: "classification", status: "pending" }),
    ];
    const summary = summarizeSteps(steps);
    expect(summary).toContain("✓ ingestion");
    expect(summary).toContain("✗ extraction");
    expect(summary).toContain("· classification");
  });
});

// ---------------------------------------------------------------------------
// Pipeline planning
// ---------------------------------------------------------------------------

describe("planPipelineSteps", () => {
  it("returns steps from a pipeline definition", () => {
    const pipeline: PipelineDefinition = {
      id: "evidence_pipeline",
      name: "Evidence Reasoning Pipeline",
      steps: [
        { id: "ingestion", type: "ingestion", input_mapping: {}, max_attempts: 3, timeout_ms: 60000, requires_review: false },
        { id: "extraction", type: "extraction", input_mapping: { text: "$ingestion.output" }, max_attempts: 3, timeout_ms: 120000, requires_review: false },
      ],
      total_timeout_ms: 600000,
    };
    const steps = planPipelineSteps(pipeline);
    expect(steps).toHaveLength(2);
    expect(steps[0].id).toBe("ingestion");
    expect(steps[1].id).toBe("extraction");
  });
});

describe("resolveStepInput", () => {
  it("resolves static values", () => {
    const result = resolveStepInput({ claimId: "static-value" }, {});
    expect(result.claimId).toBe("static-value");
  });

  it("resolves step output references", () => {
    const context = {
      ingestion: { output: { text: "hello world" } },
    };
    const result = resolveStepInput(
      { text: "$ingestion.output" },
      context,
    );
    expect(result.text).toEqual({ text: "hello world" });
  });

  it("resolves whole step output references", () => {
    const context = {
      ingestion: { text: "hello" },
    };
    const result = resolveStepInput(
      { input: "$ingestion" },
      context,
    );
    expect(result.input).toEqual({ text: "hello" });
  });
});
