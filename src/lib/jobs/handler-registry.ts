// ---------------------------------------------------------------------------
// Atlas Job Handler Registry
//
// Maps job_type strings to handler functions. The worker resolves the
// handler at execution time. If no handler exists, the job is failed
// with a PERMANENT error (no infinite retry).
//
// Design:
//   - Handlers are registered at worker startup (module scope)
//   - Each handler is a pure async function receiving a JobExecutionContext
//   - Handlers MUST be idempotent — a crash during execution should be safe
//     to retry without duplicate side effects
//   - Handlers MUST classify their errors properly (retryable vs permanent)
// ---------------------------------------------------------------------------

import type { JobHandler } from "./types";

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

const handlers = new Map<string, JobHandler>();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register a job handler for a given job type.
 * Overwrites any previously registered handler for the same type.
 */
export function registerJobHandler(jobType: string, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

/**
 * Register multiple handlers at once.
 */
export function registerJobHandlers(
  entries: Array<{ jobType: string; handler: JobHandler }>,
): void {
  for (const { jobType, handler } of entries) {
    handlers.set(jobType, handler);
  }
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Resolve a handler for a job type.
 * Returns the handler or null if no handler is registered.
 */
export function getJobHandler(jobType: string): JobHandler | null {
  return handlers.get(jobType) ?? null;
}

/**
 * Check if a handler is registered for a job type.
 */
export function hasJobHandler(jobType: string): boolean {
  return handlers.has(jobType);
}

/**
 * List all registered job types.
 */
export function listRegisteredHandlers(): string[] {
  return [...handlers.keys()];
}

/**
 * Clear all registered handlers (for testing).
 */
export function clearHandlers(): void {
  handlers.clear();
}
