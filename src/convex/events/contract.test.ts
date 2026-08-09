import { describe, expect, it } from "vitest";
import {
  backoffMs,
  buildIdempotencyKey,
  classifyFailure,
  deterministicEventId,
  hashString,
  RETRY_CAP_MS,
  sanitizeEventError,
  sanitizeEventPayload,
  validateEnvelope,
  type EventEnvelope,
} from "./contract";

const baseEnvelope: EventEnvelope = {
  eventType: "drive.file_created",
  provider: "google_drive",
  connectorId: "conn_1",
  tenantId: "tenant_1",
  connectionId: "conn_1",
  sourceResourceId: "file_123",
  occurredAt: 1700000000000,
  receivedAt: 1700000001000,
  payload: { fileId: "file_123", name: "contract.pdf" },
  payloadVersion: "1.0.0",
  correlationId: null,
  idempotencyKey: "key-1",
  sourceMechanism: "polling",
  providerEventId: "change_1",
};

describe("deterministic identity", () => {
  it("hashString is stable and deterministic", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
    expect(hashString("abc")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("same event always maps to the same event id", () => {
    const a = deterministicEventId("drive:conn:change_9");
    const b = deterministicEventId("drive:conn:change_9");
    expect(a).toBe(b);
    expect(a.startsWith("evt_")).toBe(true);
  });
});

describe("idempotency keys", () => {
  it("prefers the provider's own key", () => {
    const key = buildIdempotencyKey({
      provider: "google_drive",
      connectionId: "conn_1",
      eventType: "drive.file_updated",
      sourceResourceId: "file_1",
      occurredAt: 1700000000000,
      providerKey: "change_42",
    });
    expect(key).toBe("google_drive:conn_1:change_42");
  });

  it("falls back to a stable hash of identity fields", () => {
    const base = {
      provider: "google_drive",
      connectionId: "conn_1",
      eventType: "drive.file_updated",
      sourceResourceId: "file_1",
      occurredAt: 1700000000000,
    };
    const a = buildIdempotencyKey(base);
    const b = buildIdempotencyKey(base);
    const different = buildIdempotencyKey({ ...base, occurredAt: 1700000001000 });
    expect(a).toBe(b);
    expect(a).not.toBe(different);
  });
});

describe("envelope validation", () => {
  it("accepts a valid envelope", () => {
    const res = validateEnvelope(baseEnvelope);
    expect(res.ok).toBe(true);
  });

  it("rejects malformed envelopes", () => {
    expect(validateEnvelope(null).ok).toBe(false);
    expect(validateEnvelope({}).ok).toBe(false);
    expect(validateEnvelope({ ...baseEnvelope, occurredAt: "yesterday" }).ok).toBe(false);
    expect(validateEnvelope({ ...baseEnvelope, payload: "nope" }).ok).toBe(false);
    expect(validateEnvelope({ ...baseEnvelope, idempotencyKey: undefined }).ok).toBe(false);
  });
});

describe("payload sanitization", () => {
  it("redacts credential-like keys recursively", () => {
    const payload = {
      fileId: "f1",
      tokens: { access_token: "SECRET", refreshToken: "SECRET2" },
      name: "ok.pdf",
      headers: { authorization: "Bearer xyz", "api-key": "k" },
    };
    const cleaned = sanitizeEventPayload(payload) as Record<string, unknown>;
    // The whole credential-bearing key is redacted, and nested credential keys
    // inside safe keys are redacted too.
    expect(cleaned.tokens).toBe("[redacted]");
    expect(cleaned.headers).toEqual({ authorization: "[redacted]", "api-key": "[redacted]" });
    expect(cleaned.fileId).toBe("f1");
    expect(cleaned.name).toBe("ok.pdf");
    // no raw secret value survives
    expect(JSON.stringify(cleaned)).not.toContain("SECRET");
    expect(JSON.stringify(cleaned)).not.toContain("Bearer xyz");
  });

  it("truncates deeply nested structures", () => {
    let nested: Record<string, unknown> = { a: "x" };
    for (let i = 0; i < 20; i++) nested = { next: nested };
    const cleaned = sanitizeEventPayload(nested) as Record<string, unknown>;
    expect(cleaned.next).toBeDefined();
    expect(JSON.stringify(cleaned).length).toBeLessThan(500);
  });
});

describe("retry model", () => {
  it("classifies transient failures as retryable", () => {
    expect(classifyFailure(new Error("fetch failed"), undefined)).toBe("retryable");
    expect(classifyFailure(new Error("socket hang up"), undefined)).toBe("retryable");
    expect(classifyFailure(new Error("rate limit exceeded"), undefined)).toBe("retryable");
    expect(classifyFailure(new Error("timeout"), undefined)).toBe("retryable");
    expect(classifyFailure(new Error("boom"), "drive_rate_limited")).toBe("retryable");
    expect(classifyFailure(new Error("boom"), "drive_api_502")).toBe("retryable");
  });

  it("classifies permanent failures as non-retryable", () => {
    expect(classifyFailure(new Error("file not found"), "drive_file_not_found")).toBe("permanent");
    expect(classifyFailure(new Error("permission denied"), "drive_permission_denied")).toBe("permanent");
    expect(classifyFailure(new Error("unauthorized"), undefined)).toBe("permanent");
    expect(classifyFailure(new Error("invalid payload"), undefined)).toBe("permanent");
  });

  it("defaults unknown failures to permanent — no hammering", () => {
    expect(classifyFailure(new Error("weird error"))).toBe("permanent");
  });

  it("applies bounded exponential backoff", () => {
    expect(backoffMs(1)).toBe(15000);
    expect(backoffMs(2)).toBe(30000);
    expect(backoffMs(3)).toBe(60000);
    expect(backoffMs(12)).toBe(RETRY_CAP_MS);
  });

  it("sanitizes error messages to a bounded length", () => {
    const long = "x".repeat(1000);
    expect(sanitizeEventError(new Error(long)).length).toBeLessThanOrEqual(303);
  });
});
