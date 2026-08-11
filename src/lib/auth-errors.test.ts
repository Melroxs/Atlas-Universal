// ---------------------------------------------------------------------------
// Phase 14 — Auth error classification tests (Supabase Authentication).
// Every surfaced message must be safe (no secrets/tokens/stack traces) and
// actionable (maps known Supabase error codes to friendly guidance, and
// calls out missing deployment keys when relevant).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { classifyAuthError } from "./auth-errors";

function supabaseError(code: string): Error {
  const error = new Error(`Supabase: ${code}.`);
  (error as { code?: string }).code = code;
  return error;
}

describe("classifyAuthError", () => {
  it("maps known Supabase codes to friendly messages", () => {
    expect(classifyAuthError(supabaseError("invalid_credentials"))).toMatch(/incorrect/i);
    expect(classifyAuthError(supabaseError("email_exists"))).toMatch(/already exists/i);
    expect(classifyAuthError(supabaseError("user_already_exists"))).toMatch(/already exists/i);
    expect(classifyAuthError(supabaseError("weak_password"))).toMatch(/too weak/i);
    expect(classifyAuthError(supabaseError("email_not_confirmed"))).toMatch(/confirmed/i);
    expect(classifyAuthError(supabaseError("invalid_email"))).toMatch(/invalid/i);
    expect(classifyAuthError(supabaseError("over_email_send_rate_limit"))).toMatch(/too many attempts/i);
    expect(classifyAuthError(supabaseError("over_request_rate_limit"))).toMatch(/too many attempts/i);
  });

  it("points at missing deployment config for backend exchange errors", () => {
    const r = classifyAuthError(
      new Error("Supabase is not configured (SUPABASE_SERVICE_ROLE_KEY missing)."),
    );
    expect(r).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(r).toMatch(/Guest/i);
  });

  it("never leaks the key or tokens in the message", () => {
    const r = classifyAuthError(
      new Error("Supabase is not configured (SUPABASE_SERVICE_ROLE_KEY missing)."),
    );
    expect(r).not.toMatch(/eyJ|Bearer|service_role_key=|BEGIN|private_key/i);
  });

  it("maps network / timeout failures", () => {
    expect(classifyAuthError(new Error("Network Error"))).toMatch(/connection/i);
    expect(classifyAuthError(new Error("request timeout"))).toMatch(/connection/i);
  });

  it("handles expired sessions", () => {
    expect(classifyAuthError(new Error("Supabase access token has expired"))).toMatch(/expired/i);
  });

  it("falls back to a safe generic message", () => {
    const r = classifyAuthError(new Error("something unexpected happened"));
    expect(r).toBe("Unable to sign in. Please try again.");
    expect(r).not.toContain("something unexpected");
  });
});
