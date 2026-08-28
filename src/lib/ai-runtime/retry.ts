// ---------------------------------------------------------------------------
// Atlas AI Runtime — Retry & Backoff
//
// Exponential backoff with jitter for transient AI provider failures.
// Authentication errors and validation errors are NEVER retried.
// ---------------------------------------------------------------------------

import type { AIErrorCode, AIGenerateResponse } from "./types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Maximum number of retry attempts (0 = no retries). */
  maxRetries: number;
  /** Base delay in milliseconds for the first retry. */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (cap). */
  maxDelayMs: number;
  /** Jitter factor (0..1). 0.2 = ±20% randomness. */
  jitterFactor: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterFactor: 0.2,
};

// ---------------------------------------------------------------------------
// Non-retryable error codes
// ---------------------------------------------------------------------------

const NON_RETRYABLE_CODES: Set<AIErrorCode> = new Set([
  "auth",
  "validation_error",
  "provider_not_configured",
  "no_providers_available",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine if an error code is retryable. */
export function isRetryable(code: AIErrorCode): boolean {
  return !NON_RETRYABLE_CODES.has(code);
}

/** Calculate delay with exponential backoff + jitter. */
export function backoffDelay(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, config.maxDelayMs);
  const jitter = capped * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

/** Sleep for the given milliseconds, respecting an abort signal. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

// ---------------------------------------------------------------------------
// Retry executor
// ---------------------------------------------------------------------------

export type AIOperation<T> = (attempt: number) => Promise<T>;

/**
 * Execute an AI operation with retry on transient failures.
 *
 * Returns the successful result or the last failed result after exhausting
 * retries. Never retries non-retryable errors (auth, validation).
 */
export async function withRetry<T extends { ok: boolean; error?: AIGenerateResponse["error"] }>(
  operation: AIOperation<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  signal?: AbortSignal,
): Promise<T> {
  let lastResult: T | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    lastResult = await operation(attempt);

    // Success — return immediately.
    if (lastResult.ok) return lastResult;

    // Non-retryable error — stop immediately.
    if (lastResult.error && !isRetryable(lastResult.error.code)) {
      return lastResult;
    }

    // Don't sleep after the last attempt.
    if (attempt < config.maxRetries) {
      const delay = backoffDelay(attempt, config);
      await sleep(delay, signal);
    }
  }

  return lastResult!;
}

// ---------------------------------------------------------------------------
// Rate-limit detection
// ---------------------------------------------------------------------------

/** Check if a response indicates rate limiting. */
export function isRateLimited(response: AIGenerateResponse): boolean {
  return !response.ok && response.error?.code === "rate_limited";
}

/** Calculate rate-limit retry-after delay (from headers or default). */
export function rateLimitDelay(response: AIGenerateResponse, defaultMs = 5000): number {
  if (response.error?.status === 429) {
    // Some providers include Retry-After headers — we don't have access
    // to raw headers here, so use a conservative default.
    return defaultMs;
  }
  return defaultMs;
}
