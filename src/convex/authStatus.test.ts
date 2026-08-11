// ---------------------------------------------------------------------------
// Phase 14 — Auth configuration status tests (Supabase Authentication).
// The report must be honest (booleans only — no secrets) and correctly
// identify the missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY deployment
// variables that block the server-side token verification step of email
// login/signup.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { authStatusFromEnv } from "./authStatus";

describe("authStatusFromEnv", () => {
  it("reports Supabase unconfigured when server keys are missing", () => {
    const status = authStatusFromEnv({});
    expect(status.supabaseConfigured).toBe(false);
    expect(status.guestConfigured).toBe(true);
  });

  it("reports Supabase configured when both server env vars are present", () => {
    const status = authStatusFromEnv({
      SUPABASE_URL: "https://abc.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    });
    expect(status.supabaseConfigured).toBe(true);
  });

  it("treats missing or blank service role key as unconfigured", () => {
    expect(
      authStatusFromEnv({ SUPABASE_URL: "https://abc.supabase.co" })
        .supabaseConfigured,
    ).toBe(false);
    expect(
      authStatusFromEnv({
        SUPABASE_URL: "https://abc.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "   ",
      }).supabaseConfigured,
    ).toBe(false);
    expect(
      authStatusFromEnv({ SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiJ9" })
        .supabaseConfigured,
    ).toBe(false);
  });

  it("never includes the service role key in the report", () => {
    const status = authStatusFromEnv({
      SUPABASE_URL: "https://abc.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiJ9.very.secret",
    });
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(JSON.stringify(status)).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("marks auth usable when the site URL is present", () => {
    expect(
      authStatusFromEnv({ CONVEX_SITE_URL: "https://x.convex.cloud" })
        .authUsable,
    ).toBe(true);
    expect(authStatusFromEnv({}).authUsable).toBe(false);
  });
});
