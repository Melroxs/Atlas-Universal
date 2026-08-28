// ---------------------------------------------------------------------------
// Atlas AI Runtime — Error module unit tests
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  createAIRuntimeError,
  isRetryableCode,
  httpStatusToErrorCode,
  classifyFetchError,
  sanitizeErrorMessage,
} from "./errors";

// ---------------------------------------------------------------------------
// createAIRuntimeError
// ---------------------------------------------------------------------------

describe("createAIRuntimeError", () => {
  it("creates an error with all fields", () => {
    const err = createAIRuntimeError("rate_limited", "Too many requests", {
      provider: "gemini",
      httpStatus: 429,
      retryable: true,
    });
    expect(err.code).toBe("rate_limited");
    expect(err.message).toBe("Too many requests");
    expect(err.provider).toBe("gemini");
    expect(err.httpStatus).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults retryable from the error code", () => {
    const auth = createAIRuntimeError("authentication", "bad key");
    expect(auth.retryable).toBe(false);

    const timeout = createAIRuntimeError("timeout", "timed out");
    expect(timeout.retryable).toBe(true);
  });

  it("allows overriding retryable even when code suggests otherwise", () => {
    const err = createAIRuntimeError("malformed_response", "bad json", {
      retryable: true,
    });
    expect(err.retryable).toBe(true);
  });

  it("preserves a cause error", () => {
    const cause = new Error("original");
    const err = createAIRuntimeError("network", "net fail", { cause });
    expect(err.cause).toBe(cause);
  });
});

// ---------------------------------------------------------------------------
// isRetryableCode
// ---------------------------------------------------------------------------

describe("isRetryableCode", () => {
  it("returns true for retryable codes", () => {
    expect(isRetryableCode("timeout")).toBe(true);
    expect(isRetryableCode("network")).toBe(true);
    expect(isRetryableCode("rate_limited")).toBe(true);
    expect(isRetryableCode("provider_error")).toBe(true);
  });

  it("returns false for non-retryable codes", () => {
    expect(isRetryableCode("authentication")).toBe(false);
    expect(isRetryableCode("missing_api_key")).toBe(false);
    expect(isRetryableCode("invalid_model")).toBe(false);
    expect(isRetryableCode("invalid_request")).toBe(false);
    expect(isRetryableCode("all_providers_failed")).toBe(false);
    expect(isRetryableCode("provider_unavailable")).toBe(false);
    expect(isRetryableCode("malformed_response")).toBe(false);
    expect(isRetryableCode("not_implemented")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// httpStatusToErrorCode
// ---------------------------------------------------------------------------

describe("httpStatusToErrorCode", () => {
  it("maps 401 to authentication (not retryable)", () => {
    const result = httpStatusToErrorCode(401, "gemini");
    expect(result.code).toBe("authentication");
    expect(result.retryable).toBe(false);
    expect(result.message).toContain("gemini");
    expect(result.message).toContain("401");
  });

  it("maps 403 to authentication (not retryable)", () => {
    const result = httpStatusToErrorCode(403);
    expect(result.code).toBe("authentication");
    expect(result.retryable).toBe(false);
  });

  it("maps 429 to rate_limited (retryable)", () => {
    const result = httpStatusToErrorCode(429, "nvidia-nim");
    expect(result.code).toBe("rate_limited");
    expect(result.retryable).toBe(true);
    expect(result.message).toContain("nvidia-nim");
  });

  it("maps 404 to invalid_model (not retryable)", () => {
    const result = httpStatusToErrorCode(404);
    expect(result.code).toBe("invalid_model");
    expect(result.retryable).toBe(false);
  });

  it("maps 400/422/other 4xx to invalid_request (not retryable)", () => {
    expect(httpStatusToErrorCode(400).code).toBe("invalid_request");
    expect(httpStatusToErrorCode(422).code).toBe("invalid_request");
    expect(httpStatusToErrorCode(415).code).toBe("invalid_request");
  });

  it("maps 500/502/503 to provider_error (retryable)", () => {
    expect(httpStatusToErrorCode(500).code).toBe("provider_error");
    expect(httpStatusToErrorCode(500).retryable).toBe(true);
    expect(httpStatusToErrorCode(502).code).toBe("provider_error");
    expect(httpStatusToErrorCode(502).retryable).toBe(true);
    expect(httpStatusToErrorCode(503).code).toBe("provider_error");
    expect(httpStatusToErrorCode(503).retryable).toBe(true);
  });

  it("uses 'unknown provider' when provider is not given", () => {
    const result = httpStatusToErrorCode(401);
    expect(result.message).toContain("unknown provider");
  });
});

// ---------------------------------------------------------------------------
// classifyFetchError
// ---------------------------------------------------------------------------

describe("classifyFetchError", () => {
  it("classifies AbortError as timeout", () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    const result = classifyFetchError(err, "gemini", 5000);
    expect(result.code).toBe("timeout");
    expect(result.provider).toBe("gemini");
    expect(result.retryable).toBe(true);
    expect(result.message).toContain("5000");
  });

  it("classifies ECONNREFUSED as network error", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:443");
    const result = classifyFetchError(err, "nvidia-nim");
    expect(result.code).toBe("network");
    expect(result.provider).toBe("nvidia-nim");
    expect(result.retryable).toBe(true);
  });

  it("classifies ECONNRESET as network error", () => {
    const err = new Error("read ECONNRESET");
    const result = classifyFetchError(err, "gemini");
    expect(result.code).toBe("network");
    expect(result.retryable).toBe(true);
  });

  it("classifies ENOTFOUND as network error", () => {
    const err = new Error("getaddrinfo ENOTFOUND api.nvidia.com");
    const result = classifyFetchError(err, "nvidia-nim");
    expect(result.code).toBe("network");
    expect(result.retryable).toBe(true);
  });

  it("classifies generic fetch errors as network error", () => {
    const err = new Error("fetch failed");
    const result = classifyFetchError(err, "gemini");
    expect(result.code).toBe("network");
    expect(result.retryable).toBe(true);
  });

  it("classifies unknown errors as provider_error", () => {
    const err = new Error("something weird");
    const result = classifyFetchError(err, "gemini");
    expect(result.code).toBe("provider_error");
    expect(result.retryable).toBe(true);
  });

  it("handles non-Error thrown values", () => {
    const result = classifyFetchError("string error", "gemini");
    expect(result.code).toBe("provider_error");
    expect(result.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sanitizeErrorMessage
// ---------------------------------------------------------------------------

describe("sanitizeErrorMessage", () => {
  it("redacts Google API keys (AIza...)", () => {
    const msg = "Key AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx is invalid";
    const sanitized = sanitizeErrorMessage(msg);
    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).not.toContain("AIzaSyBxxx");
  });

  it("redacts NVIDIA API keys (nvapi-...)", () => {
    const msg = "Auth failed with nvapi-1234567890abcdef";
    const sanitized = sanitizeErrorMessage(msg);
    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).not.toContain("nvapi-1234567890abcdef");
  });

  it("redacts OpenAI keys (sk-...)", () => {
    const msg = "Bad key sk-abcdefghijklmnopqrstuvwxyz123456";
    const sanitized = sanitizeErrorMessage(msg);
    expect(sanitized).toContain("[REDACTED]");
    expect(sanitized).not.toContain("sk-abcde");
  });

  it("redacts key= patterns", () => {
    const msg = "key=abcdef1234567890abcdef12";
    const sanitized = sanitizeErrorMessage(msg);
    expect(sanitized).toContain("[REDACTED]");
  });

  it("leaves clean messages unchanged", () => {
    const msg = "Rate limit exceeded for provider gemini (HTTP 429).";
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });
});
