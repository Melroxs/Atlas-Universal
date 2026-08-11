// ---------------------------------------------------------------------------
// Phase 14 — Auth error classification tests (Firebase Authentication).
// Every surfaced message must be safe (no secrets/tokens/stack traces) and
// actionable (maps known Firebase auth/* codes to friendly guidance, and
// calls out missing deployment keys when relevant).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { classifyAuthError } from "./auth-errors";

function firebaseError(code: string): Error {
  const error = new Error(`Firebase: ${code}.`);
  (error as { code?: string }).code = code;
  return error;
}

describe("classifyAuthError", () => {
  it("maps known Firebase codes to friendly messages", () => {
    expect(classifyAuthError(firebaseError("auth/email-already-in-use"))).toMatch(/already exists/i);
    expect(classifyAuthError(firebaseError("auth/invalid-email"))).toMatch(/looks invalid/i);
    expect(classifyAuthError(firebaseError("auth/weak-password"))).toMatch(/too weak/i);
    expect(classifyAuthError(firebaseError("auth/wrong-password"))).toMatch(/incorrect/i);
    expect(classifyAuthError(firebaseError("auth/user-not-found"))).toMatch(/no account/i);
    expect(classifyAuthError(firebaseError("auth/invalid-credential"))).toMatch(/incorrect/i);
    expect(classifyAuthError(firebaseError("auth/too-many-requests"))).toMatch(/too many attempts/i);
    expect(classifyAuthError(firebaseError("auth/network-request-failed"))).toMatch(/connection/i);
  });

  it("points at missing deployment config for backend exchange errors", () => {
    const r = classifyAuthError(
      new Error("Firebase is not configured (FIREBASE_SERVICE_ACCOUNT_JSON missing)."),
    );
    expect(r).toMatch(/FIREBASE_SERVICE_ACCOUNT_JSON/);
    expect(r).toMatch(/Guest/i);
  });

  it("never leaks the key or tokens in the message", () => {
    const r = classifyAuthError(
      new Error("Firebase is not configured (FIREBASE_SERVICE_ACCOUNT_JSON missing)."),
    );
    expect(r).not.toMatch(/sk-|Bearer|private_key|BEGIN|AIza/i);
  });

  it("maps network / timeout failures", () => {
    expect(classifyAuthError(new Error("Network Error"))).toMatch(/connection/i);
    expect(classifyAuthError(new Error("request timeout"))).toMatch(/connection/i);
  });

  it("handles expired sessions", () => {
    expect(classifyAuthError(new Error("Firebase ID token has expired"))).toMatch(/expired/i);
  });

  it("falls back to a safe generic message", () => {
    const r = classifyAuthError(new Error("something unexpected happened"));
    expect(r).toBe("Unable to sign in. Please try again.");
    expect(r).not.toContain("something unexpected");
  });
});
