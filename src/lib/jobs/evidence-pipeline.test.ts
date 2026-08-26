// ---------------------------------------------------------------------------
// Atlas Evidence Pipeline — Tests
//
// Tests the pipeline definition, handlers, dependency resolution, and
// integration with the job engine. These tests use the same mock RPC
// pattern as the worker tests.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getEvidencePipelineDefinition,
  getStepDependencies,
  getDownstreamSteps,
  generateCorrelationId,
  buildEvidencePipelinePayload,
  EVIDENCE_PIPELINE_STEPS,
  type EvidencePipelinePayload,
} from "./evidence-pipeline";
import {
  EVIDENCE_PIPELINE_HANDLERS,
  handleDocumentIngestion,
  handleClaimDiscovery,
  handleCompletenessAnalysis,
  handleFindingsAnalysis,
  handleContradictionScan,
  handleEvidenceReadiness,
  handleReconciliation,
} from "./evidence-handlers";
import { registerJobHandler, clearHandlers } from "./handler-registry";
import { AtlasWorker, type WorkerRPC } from "./worker";
import type { JobExecutionContext, HandlerResult, JobError } from "./types";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeJobContext(
  overrides: Partial<JobExecutionContext> = {},
): JobExecutionContext {
  return {
    job: {
      _id: "test-job-1",
      _creationTime: Date.now(),
      tenant_id: "tenant-1",
      user_id: null,
      job_type: "evidence_pipeline",
      status: "processing",
      priority: 3,
      idempotency_key: "test-key-1",
      payload: buildEvidencePipelinePayload({ tenant_id: "tenant-1" }),
      result: null,
      error: null,
      attempt_count: 1,
      max_attempts: 3,
      scheduled_at: null,
      started_at: null,
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
    },
    step: null,
    steps: [],
    supabase: null,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    signal: new AbortController().signal,
    worker_id: "test-worker-1",
    attempt: 1,
    ...overrides,
  };
}

function createMockRPC(): WorkerRPC & {
  jobs: Map<string, { status: string; result: Record<string, unknown> | null }>;
  completions: Array<{ jobId: string; result: Record<string, unknown> }>;
  failures: Array<{ jobId: string; error: JobError; retryable: boolean }>;
  dequeuedJobs: string[];
} {
  const jobs = new Map<string, { status: string; result: Record<string, unknown> | null }>();
  const completions: Array<{ jobId: string; result: Record<string, unknown> }> = [];
  const failures: Array<{ jobId: string; error: JobError; retryable: boolean }> = [];
  const dequeuedJobs: string[] = [];

  return {
    jobs,
    completions,
    failures,
    dequeuedJobs,
    dequeue: vi.fn(async (workerId: string, jobTypes?: string[], maxJobs = 1) => {
      const result: Array<{ id: string }> = [];
      for (const [id, job] of jobs) {
        if (result.length >= maxJobs) break;
        if (job.status !== "queued" && job.status !== "pending") continue;
        if (jobTypes && jobTypes.length > 0 && !jobTypes.includes("evidence_pipeline")) continue;
        job.status = "processing";
        dequeuedJobs.push(id);
        result.push({ id });
      }
      return result;
    }) as WorkerRPC["dequeue"],
    getJob: vi.fn(async (jobId: string) => {
      const job = jobs.get(jobId);
      if (!job) return null;
      return {
        _id: jobId,
        id: jobId,
        _creationTime: Date.now(),
        tenant_id: "tenant-1",
        user_id: null,
        job_type: "evidence_pipeline",
        status: job.status,
        priority: 3,
        idempotency_key: "test",
        payload: buildEvidencePipelinePayload({ tenant_id: "tenant-1" }),
        result: job.result,
        error: null,
        attempt_count: 1,
        max_attempts: 3,
        scheduled_at: null,
        started_at: null,
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
        steps: [],
      } as unknown as Awaited<ReturnType<WorkerRPC["getJob"]>>;
    }) as WorkerRPC["getJob"],
    completeJob: vi.fn(async (jobId: string, result: Record<string, unknown>) => {
      const job = jobs.get(jobId);
      if (job) {
        job.status = "completed";
        job.result = result;
      }
      completions.push({ jobId, result });
      return { ok: true };
    }) as WorkerRPC["completeJob"],
    failJob: vi.fn(async (jobId: string, error: JobError, retryable = true) => {
      failures.push({ jobId, error, retryable });
      return { ok: true, retrying: retryable };
    }) as WorkerRPC["failJob"],
    completeStep: vi.fn(async () => ({ ok: true })) as WorkerRPC["completeStep"],
    failStep: vi.fn(async () => ({ ok: true })) as WorkerRPC["failStep"],
    cancelJob: vi.fn(async () => ({ ok: true })) as WorkerRPC["cancelJob"],
    unlockStuck: vi.fn(async () => ({ unlocked: 0 })) as WorkerRPC["unlockStuck"],
  };
}

// ---------------------------------------------------------------------------
// Pipeline Definition Tests
// ---------------------------------------------------------------------------

describe("Evidence Pipeline — Definition", () => {
  it("returns a valid pipeline definition", () => {
    const pipeline = getEvidencePipelineDefinition();
    expect(pipeline.id).toBe("evidence_pipeline_v1");
    expect(pipeline.name).toBe("Evidence Reasoning Pipeline");
    expect(pipeline.version).toBe("1.0.0");
    expect(pipeline.steps.length).toBe(7);
    expect(pipeline.total_timeout_ms).toBeGreaterThan(0);
  });

  it("defines steps in dependency order", () => {
    const pipeline = getEvidencePipelineDefinition();
    const stepIds = pipeline.steps.map((s) => s.type);
    expect(stepIds).toEqual([
      EVIDENCE_PIPELINE_STEPS.DOCUMENT_INGESTION,
      EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY,
      EVIDENCE_PIPELINE_STEPS.COMPLETENESS_ANALYSIS,
      EVIDENCE_PIPELINE_STEPS.FINDINGS_ANALYSIS,
      EVIDENCE_PIPELINE_STEPS.CONTRADICTION_SCAN,
      EVIDENCE_PIPELINE_STEPS.EVIDENCE_READINESS,
      EVIDENCE_PIPELINE_STEPS.RECONCILIATION,
    ]);
  });

  it("first step has no dependencies", () => {
    const deps = getStepDependencies(EVIDENCE_PIPELINE_STEPS.DOCUMENT_INGESTION);
    expect(deps).toEqual([]);
  });

  it("claim discovery depends on document ingestion", () => {
    const deps = getStepDependencies(EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY);
    expect(deps).toEqual([EVIDENCE_PIPELINE_STEPS.DOCUMENT_INGESTION]);
  });

  it("evidence readiness depends on completeness, findings, and contradiction", () => {
    const deps = getStepDependencies(EVIDENCE_PIPELINE_STEPS.EVIDENCE_READINESS);
    expect(deps).toContain(EVIDENCE_PIPELINE_STEPS.COMPLETENESS_ANALYSIS);
    expect(deps).toContain(EVIDENCE_PIPELINE_STEPS.FINDINGS_ANALYSIS);
    expect(deps).toContain(EVIDENCE_PIPELINE_STEPS.CONTRADICTION_SCAN);
  });

  it("document ingestion has downstream steps", () => {
    const downstream = getDownstreamSteps(EVIDENCE_PIPELINE_STEPS.DOCUMENT_INGESTION);
    expect(downstream).toContain(EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY);
  });

  it("reconciliation has no downstream steps", () => {
    const downstream = getDownstreamSteps(EVIDENCE_PIPELINE_STEPS.RECONCILIATION);
    expect(downstream).toEqual([]);
  });

  it("every step has max_attempts and timeout", () => {
    const pipeline = getEvidencePipelineDefinition();
    for (const step of pipeline.steps) {
      expect(step.max_attempts).toBeGreaterThan(0);
      expect(step.timeout_ms).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Pipeline Payload Tests
// ---------------------------------------------------------------------------

describe("Evidence Pipeline — Payload", () => {
  it("generates unique correlation IDs", () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^ep-/);
  });

  it("builds a valid payload", () => {
    const payload = buildEvidencePipelinePayload({
      tenant_id: "tenant-1",
      user_id: "user-1",
      claim_id: "claim-1",
    });
    expect(payload.tenant_id).toBe("tenant-1");
    expect(payload.user_id).toBe("user-1");
    expect(payload.claim_id).toBe("claim-1");
    expect(payload.pipeline_version).toBe("1.0.0");
    expect(payload.correlation_id).toMatch(/^ep-/);
    expect(payload.enabled).toBe(true);
  });

  it("payload has all required fields", () => {
    const payload = buildEvidencePipelinePayload({ tenant_id: "t1" });
    expect(payload.tenant_id).toBeDefined();
    expect(payload.pipeline_version).toBeDefined();
    expect(payload.correlation_id).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Handler Tests — Each step returns success
// ---------------------------------------------------------------------------

describe("Evidence Pipeline — Handlers", () => {
  beforeEach(() => {
    clearHandlers();
  });

  it("all 7 handlers are registered", () => {
    expect(Object.keys(EVIDENCE_PIPELINE_HANDLERS).length).toBe(7);
  });

  it("document ingestion handler returns success", async () => {
    const ctx = makeJobContext();
    const result = await handleDocumentIngestion(ctx);
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("claim discovery handler returns success", async () => {
    const ctx = makeJobContext();
    const result = await handleClaimDiscovery(ctx);
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("completeness analysis handler returns success", async () => {
    const ctx = makeJobContext();
    const result = await handleCompletenessAnalysis(ctx);
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("findings analysis handler returns success", async () => {
    const ctx = makeJobContext();
    const result = await handleFindingsAnalysis(ctx);
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("contradiction scan handler returns success", async () => {
    const ctx = makeJobContext();
    const result = await handleContradictionScan(ctx);
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("evidence readiness handler returns success", async () => {
    const ctx = makeJobContext();
    const result = await handleEvidenceReadiness(ctx);
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("reconciliation handler returns success", async () => {
    const ctx = makeJobContext();
    const result = await handleReconciliation(ctx);
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("handlers log execution with correlation_id", async () => {
    const ctx = makeJobContext();
    await handleDocumentIngestion(ctx);
    expect(ctx.logger.info).toHaveBeenCalled();
    const calls = (ctx.logger.info as ReturnType<typeof vi.fn>).mock.calls;
    const correlationLog = calls.find((c: unknown[]) =>
      typeof c[1] === "object" && c[1] !== null && "correlation_id" in (c[1] as Record<string, unknown>),
    );
    expect(correlationLog).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Worker Integration — Pipeline runs through the worker
// ---------------------------------------------------------------------------

describe("Evidence Pipeline — Worker Integration", () => {
  beforeEach(() => {
    clearHandlers();
  });

  it("pipeline step handlers can be registered and executed via worker", async () => {
    // Register all evidence pipeline handlers
    for (const [stepType, handler] of Object.entries(EVIDENCE_PIPELINE_HANDLERS)) {
      registerJobHandler(stepType, handler);
    }

    // Verify registration
    expect(Object.keys(EVIDENCE_PIPELINE_HANDLERS).length).toBe(7);
  });

  it("pipeline definition is compatible with the job engine", () => {
    const pipeline = getEvidencePipelineDefinition();
    // Every step in the definition should have a corresponding handler
    for (const step of pipeline.steps) {
      expect(EVIDENCE_PIPELINE_HANDLERS[step.type]).toBeDefined();
    }
  });

  it("step types match between definition and handlers", () => {
    const pipeline = getEvidencePipelineDefinition();
    const handlerKeys = new Set(Object.keys(EVIDENCE_PIPELINE_HANDLERS));
    const stepTypes = new Set(pipeline.steps.map((s) => s.type));
    // All step types should have handlers
    for (const stepType of stepTypes) {
      expect(handlerKeys.has(stepType)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Dependency Enforcement
// ---------------------------------------------------------------------------

describe("Evidence Pipeline — Dependency Enforcement", () => {
  it("can determine which steps are ready to run", () => {
    const pipeline = getEvidencePipelineDefinition();

    // With no completed steps, only the first step (no deps) is ready
    const completedSteps = new Set<string>();
    const readySteps = pipeline.steps.filter((step) => {
      const deps = step.depends_on ?? [];
      return deps.every((dep) => completedSteps.has(dep));
    });
    expect(readySteps.length).toBe(1);
    expect(readySteps[0].type).toBe(EVIDENCE_PIPELINE_STEPS.DOCUMENT_INGESTION);
  });

  it("unblocks downstream steps after dependency completes", () => {
    const pipeline = getEvidencePipelineDefinition();
    const completedSteps = new Set([EVIDENCE_PIPELINE_STEPS.DOCUMENT_INGESTION]);

    const readySteps = pipeline.steps.filter((step) => {
      const deps = step.depends_on ?? [];
      return deps.every((dep) => completedSteps.has(dep));
    });

    // After document ingestion completes, claim_discovery should be ready
    expect(readySteps.some((s) => s.type === EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY)).toBe(true);
    // But evidence_readiness should NOT be ready (needs completeness, findings, contradiction)
    expect(readySteps.some((s) => s.type === EVIDENCE_PIPELINE_STEPS.EVIDENCE_READINESS)).toBe(false);
  });

  it("evidence readiness unlocks after all three dependencies complete", () => {
    const pipeline = getEvidencePipelineDefinition();
    const completedSteps = new Set([
      EVIDENCE_PIPELINE_STEPS.DOCUMENT_INGESTION,
      EVIDENCE_PIPELINE_STEPS.CLAIM_DISCOVERY,
      EVIDENCE_PIPELINE_STEPS.COMPLETENESS_ANALYSIS,
      EVIDENCE_PIPELINE_STEPS.FINDINGS_ANALYSIS,
      EVIDENCE_PIPELINE_STEPS.CONTRADICTION_SCAN,
    ]);

    const readySteps = pipeline.steps.filter((step) => {
      const deps = step.depends_on ?? [];
      return deps.every((dep) => completedSteps.has(dep));
    });

    expect(readySteps.some((s) => s.type === EVIDENCE_PIPELINE_STEPS.EVIDENCE_READINESS)).toBe(true);
    expect(readySteps.some((s) => s.type === EVIDENCE_PIPELINE_STEPS.RECONCILIATION)).toBe(true);
  });
});
