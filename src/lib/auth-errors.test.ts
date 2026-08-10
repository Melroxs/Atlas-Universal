// ---------------------------------------------------------------------------
// Phase 12 — Auth error classification tests (Part 15).
// Every surfaced message must be safe (no secrets/tokens/stack traces) and
// actionable (points at the missing VLY_EMAIL_API_KEY config when relevant).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { classifySendError, classifyVerifyError } from "./auth-errors";

describe("classifySendError (step 1 — request the code)", () => {
  it("maps relay 401/403 to not-configured with an actionable message", () => {
    const r = classifySendError(new Error("Failed to send verification email (status 401)"));
    expect(r.kind).toBe("not-configured");
    expect(r.message).toMatch(/VLY_EMAIL_API_KEY/);
    expect(r.message).toMatch(/Guest/i);
  });

  it("never leaks the key or tokens in the message", () => {
    const r = classifySendError(new Error("Failed to send verification email (status 401)"));
    expect(r.message).not.toMatch(/sk-|Bearer|api[- ]?key[:=]|header|config/i);
  });

  it("maps 5xx / network failures to service-unavailable", () => {
    expect(classifySendError(new Error("Failed to send verification email (status 503)")).kind).toBe(
      "service-unavailable",
    );
    expect(classifySendError(new Error("Network Error")).kind).toBe("service-unavailable");
    expect(classifySendError(new Error("request timeout")).kind).toBe("service-unavailable");
  });

  it("maps invalid email rejection", () => {
    const r = classifySendError(new Error("invalid email address"));
    expect(r.kind).toBe("invalid-email");
  });

  it("falls back to a safe generic message", () => {
    const r = classifySendError(new Error("something unexpected happened"));
    expect(r.kind).toBe("generic");
    expect(r.message).not.toContain("something unexpected");
  });
});

describe("classifyVerifyError (step 2 — enter the code)", () => {
  it("explains expired codes", () => {
    const r = classifyVerifyError(new Error("Verification code expired"));
    expect(r.message).toMatch(/expired/i);
  });

  it("explains incorrect codes honestly (library throws generic 'Could not verify code')", () => {
    const r = classifyVerifyError(new Error("Could not verify code"));
    expect(r.message).toMatch(/incorrect or has expired/i);
  });

  it("maps network failures during verification", () => {
    const r = classifyVerifyError(new Error("Network Error"));
    expect(r.message).toMatch(/temporarily unavailable/i);
  });

  it("falls back to a safe generic verification message", () => {
    const r = classifyVerifyError(new Error("boop"));
    expect(r.kind).toBe("generic");
    expect(r.message).not.toMatch(/boop/);
  });
});
