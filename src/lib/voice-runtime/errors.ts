// ---------------------------------------------------------------------------
// Atlas Voice Runtime — Structured Error Types
//
// Every voice provider call produces typed errors. The runtime never exposes
// raw HTTP statuses or internal provider details to callers.
// ---------------------------------------------------------------------------

import type { VoiceProviderId } from "./types";

export type VoiceErrorCode =
  | "provider_unavailable"
  | "missing_api_key"
  | "invalid_model"
  | "authentication"
  | "rate_limited"
  | "timeout"
  | "network"
  | "malformed_audio"
  | "provider_error"
  | "all_providers_failed"
  | "invalid_request"
  | "not_implemented"
  | "session_limit"
  | "session_expired"
  | "audio_format_unsupported"
  | "microphone_denied"
  | "browser_unsupported";

export interface VoiceError extends Error {
  code: VoiceErrorCode;
  provider?: VoiceProviderId;
  httpStatus?: number;
  retryable: boolean;
  cause?: Error;
}

/**
 * Create a typed voice error.
 */
export function createVoiceError(
  code: VoiceErrorCode,
  message: string,
  options: {
    provider?: VoiceProviderId;
    httpStatus?: number;
    retryable?: boolean;
    cause?: Error;
  } = {},
): VoiceError {
  const error = new Error(message) as VoiceError;
  error.code = code;
  error.provider = options.provider;
  error.httpStatus = options.httpStatus;
  error.retryable = options.retryable ?? isRetryableCode(code);
  error.cause = options.cause;
  return error;
}

/**
 * Whether an error code is inherently retryable.
 */
export function isRetryableCode(code: VoiceErrorCode): boolean {
  switch (code) {
    case "timeout":
    case "network":
    case "rate_limited":
    case "provider_error":
    case "session_expired":
      return true;
    case "authentication":
    case "missing_api_key":
    case "invalid_model":
    case "invalid_request":
    case "all_providers_failed":
    case "provider_unavailable":
    case "malformed_audio":
    case "not_implemented":
    case "session_limit":
    case "audio_format_unsupported":
    case "microphone_denied":
    case "browser_unsupported":
      return false;
  }
}

/**
 * Map an HTTP status to a VoiceErrorCode.
 */
export function httpStatusToVoiceError(
  status: number,
  provider?: VoiceProviderId,
): { code: VoiceErrorCode; retryable: boolean; message: string } {
  if (status === 401 || status === 403) {
    return {
      code: "authentication",
      retryable: false,
      message: `Authentication failed for ${provider ?? "unknown provider"} (HTTP ${status}).`,
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
 * Sanitize an error message to remove any API key patterns.
 */
export function sanitizeVoiceErrorMessage(message: string): string {
  return message
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
    .replace(/nvapi-[A-Za-z0-9_-]{10,}/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9]{20,}/g, "[REDACTED]")
    .replace(/key[=:]\s*["']?[A-Za-z0-9_-]{20,}["']?/gi, "key=[REDACTED]");
}
