// ---------------------------------------------------------------------------
// Atlas Test Job Handlers
//
// Simple handlers for Milestone 2 validation. These prove the full
// enqueue → queue → worker → claim → execute → persist → complete cycle.
//
// DO NOT use these in production — they are test fixtures.
// ---------------------------------------------------------------------------

import type { JobExecutionContext, HandlerResult, JobError } from "../types";
import { createJobError, JOB_ERROR_CODES } from "../engine";

// ---------------------------------------------------------------------------
// test_job — Simple echo handler
//
// Validates:
//   - Handler registry works
//   - Worker can claim and execute
//   - Results are persisted
//   - Steps complete
//   - Idempotency (safe to re-execute)
// ---------------------------------------------------------------------------

export async function testJobHandler(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  ctx.logger.info("Test job executing", {
    job_type: ctx.job.job_type,
    payload: ctx.job.payload,
    attempt: ctx.attempt,
  });

  const { message, delay_ms } = ctx.job.payload as {
    message?: string;
    delay_ms?: number;
  };

  // Simulate work
  if (typeof delay_ms === "number" && delay_ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay_ms));
  }

  // Check for cancellation
  if (ctx.signal.aborted) {
    return {
      success: false,
      error: createJobError(JOB_ERROR_CODES.TIMEOUT, "Job was cancelled during execution"),
    };
  }

  return {
    success: true,
    result: {
      echo: message ?? "no message",
      processed_at: new Date().toISOString(),
      worker_id: ctx.worker_id,
      attempt: ctx.attempt,
    },
  };
}

// ---------------------------------------------------------------------------
// test_fail_job — Always fails handler
//
// Validates:
//   - Error classification works
//   - Retry logic works
//   - Max attempts enforced
//   - Dead-letter behavior
// ---------------------------------------------------------------------------

export async function testFailJobHandler(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  const { error_code, retryable } = ctx.job.payload as {
    error_code?: string;
    retryable?: boolean;
  };

  ctx.logger.info("Test fail job executing", { attempt: ctx.attempt });

  return {
    success: false,
    error: createJobError(
      error_code ?? JOB_ERROR_CODES.AI_PROVIDER_ERROR,
      `Test failure (attempt ${ctx.attempt})`,
      { attempt: ctx.attempt },
      retryable ?? true,
    ),
  };
}

// ---------------------------------------------------------------------------
// test_step_job — Multi-step handler
//
// Validates:
//   - Step-level execution
//   - Steps execute in order
//   - Failed steps retry independently
//   - Completed steps are not re-executed
// ---------------------------------------------------------------------------

export async function testStepJobHandler(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  const step = ctx.step;
  if (!step) {
    return {
      success: false,
      error: createJobError(JOB_ERROR_CODES.TOOL_INPUT_INVALID, "No step provided"),
    };
  }

  ctx.logger.info("Test step job executing", {
    step_type: step.step_type,
    sequence: step.sequence,
    input: step.input,
  });

  // Each step type does different work
  switch (step.step_type) {
    case "step_a":
      return {
        success: true,
        result: { step_a_output: "computed_a", value: 1 },
      };
    case "step_b":
      return {
        success: true,
        result: { step_b_output: "computed_b", value: 2 },
      };
    case "step_c":
      // Check if the input references previous step outputs
      return {
        success: true,
        result: {
          step_c_output: "computed_c",
          input_received: step.input,
        },
      };
    case "step_fail":
      return {
        success: false,
        error: createJobError(JOB_ERROR_CODES.AI_PROVIDER_ERROR, "Step intentionally failed"),
      };
    default:
      return {
        success: true,
        result: { step_type: step.step_type, processed: true },
      };
  }
}

// ---------------------------------------------------------------------------
// test_cancel_job — Checks cancellation
//
// Validates:
//   - Cancellation signal works
//   - Long-running jobs can be stopped
// ---------------------------------------------------------------------------

export async function testCancelJobHandler(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  const { work_ms } = ctx.job.payload as { work_ms?: number };

  ctx.logger.info("Test cancel job executing", { work_ms });

  // Simulate long work with cancellation check
  const workDuration = work_ms ?? 5000;
  const checkInterval = 100;
  let elapsed = 0;

  while (elapsed < workDuration) {
    if (ctx.signal.aborted) {
      return {
        success: false,
        error: createJobError(JOB_ERROR_CODES.TIMEOUT, "Job was cancelled"),
      };
    }
    await new Promise((r) => setTimeout(r, checkInterval));
    elapsed += checkInterval;
  }

  return {
    success: true,
    result: { completed: true, elapsed_ms: elapsed },
  };
}

// ---------------------------------------------------------------------------
// test_idempotent_job — Validates idempotency
//
// Uses a "counter" in the payload. On first execution, increments it.
// On re-execution, checks if the result already has the incremented value.
// In a real handler, this would check the database for an existing record.
// ---------------------------------------------------------------------------

let testExecutionCount = 0; // In-memory counter for testing

export async function testIdempotentJobHandler(
  ctx: JobExecutionContext,
): Promise<HandlerResult> {
  const { idempotency_test } = ctx.job.payload as { idempotency_test?: boolean };

  testExecutionCount++;

  ctx.logger.info("Idempotent job executing", {
    execution_count: testExecutionCount,
    idempotency_test,
  });

  // In a real handler, you would check if the operation was already performed.
  // For testing, we track the execution count.
  return {
    success: true,
    result: {
      execution_count: testExecutionCount,
      idempotent: true,
    },
  };
}

/** Reset the idempotency test counter (for testing). */
export function resetIdempotencyCounter(): void {
  testExecutionCount = 0;
}

/** Get the current execution count (for testing). */
export function getIdempotencyCounter(): number {
  return testExecutionCount;
}
