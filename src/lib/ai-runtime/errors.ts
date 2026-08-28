// ---------------------------------------------------------------------------
// Atlas AI Runtime — Structured Error Types
//
// Every AI provider call produces typed errors. The runtime never exposes
// raw HTTP statuses or internal provider details to callers — only the
// structured error code, a human-readable message, and whether it's safe
// to retry.
// ---------------------------------------------------------------------------

import type {
  AIRuntimeError,
  AIRuntimeErrorCode,
  ProviderId,
} from "./types";

// ---------------------------------------------------------------------------
// Error factory
// ---------------------------------------------------------------------------

export function createAIRuntimeError(
  code: AIRuntimeErrorCode,
  message: string,
  options: {
    provider?: ProviderId;
    httpStatus?: number;
    retryable?: boolean;
    cause?: Error;
  } = {},
): AIRuntimeError {
  const error = new Error(message) as AIRuntimeError;
  error.code = code;
  error.provider = options.provider;
  error.httpStatus = options.httpStatus;
  error.retryable = options.retryable ?? isRetryableCode(code);
  error.cause = options.cause;
  return error;
}

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

/** Whether an error code is inherently retryable. */
export function isRetryableCode(code: AIRuntimeErrorCode): boolean {
  switch (code) {
    case "timeout":
    case "network":
    case "rate_limited":
    case "provider_error":
      return true;
    case "authentication":
    case "missing_api_key":
    case "invalid_model":
    case "invalid_request":
    case "all_providers_failed":
    case "provider_unavailable":
    case "malformed_response":
    case "not_implemented":
      return false;
  }
}

/** Map an HTTP status to an AIRuntimeErrorCode. */
export function httpStatusToErrorCode(
  status: number,
  provider?: ProviderId,
): { code: AIRuntimeErrorCode; retryable: boolean; message: string } {
  if (status === 401 || status === 403) {
    return {
      code: "authentication",
      retryable: false,
      message: `Authentication failed for ${provider ?? "unknown provider"} (HTTP ${status}) — check API key configuration.`,
    };
  }
  if (status === 429) {
    return {
      code: "rate_limited",
      retryable: true,
      message: `Rate limit exceeded for ${provider ?? "unknown provider"} (HTTP 429).`,
    };
  }
  if (status === 404) {
    return {
      code: "invalid_model",
      retryable: false,
      message: `Model not found on ${provider ?? "unknown provider"} (HTTP 404).`,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      code: "invalid_request",
      retryable: false,
      message: `Invalid request to ${provider ?? "unknown provider"} (HTTP ${status}).`,
    };
  }
  if (status >= 500) {
    return {
      code: "provider_error",
      retryable: true,
      message: `Server error from ${provider ?? "unknown provider"} (HTTP ${status}).`,
    };
  }
  return {
    code: "provider_error",
    retryable: false,
    message: `Unexpected error from ${provider ?? "unknown provider"} (HTTP ${status}).`,
  };
}

/**
 * Classify a fetch/network error into an AIRuntimeError.
 * Never leaks API keys in error messages.
 */
export function classifyFetchError(
  err: unknown,
  provider: ProviderId,
  timeoutMs?: number,
): AIRuntimeError {
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.message.includes("abort")) {
      return createAIRuntimeError("timeout", `Request to ${provider} timed out after ${timeoutMs ?? "unknown"}ms`, { provider, retryable: true, cause: err });
    }
    if (
      err.message.includes("fetch") ||
      err.message.includes("network") ||
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("ECONNRESET") ||
      err.message.includes("ENOTFOUND")
    ) {
      return createAIRuntimeError("network", `Network error communicating with ${provider}: ${err.message}`, { provider, retryable: true, cause: err });
    }
    return createAIRuntimeError("provider_error", `Unexpected error from ${provider}: ${err.message}`, { provider, retryable: true, cause: err });
  }
  return createAIRuntimeError("provider_error", `Unknown error from ${provider}`, { provider, retryable: true });
}

// ---------------------------------------------------------------------------
// Security: never log API keys
// ---------------------------------------------------------------------------

/**
 * Sanitize an error message to remove any API key patterns.
 * Keys like "AIza..." (Google), "nvapi-..." (NVIDIA), "sk-..." (OpenAI)
 * are replaced with "[REDACTED]".
 */
export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
    .replace(/nvapi-[A-Za-z0-9_-]{10,}/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{20,}/g, "[REDACTED]")
    .replace(/key[=:]\s*["']?[A-Za-z0-9_-]{20,}["']?/gi, "key=[REDACTED]");
}
