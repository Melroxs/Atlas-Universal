// ---------------------------------------------------------------------------
// Phase 12 — Auth configuration status tests (Part 12/17).
// The report must be honest (booleans only — no secrets) and correctly
// identify the missing VLY_EMAIL_API_KEY deployment variable that blocks
// email login/signup.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { authStatusFromEnv } from "./authStatus";

describe("authStatusFromEnv", () => {
  it("reports email OTP unconfigured when the key is missing", () => {
    const status = authStatusFromEnv({});
    expect(status.emailOtpConfigured).toBe(false);
    expect(status.guestConfigured).toBe(true);
  });

  it("reports email OTP configured when the key is present", () => {
    const status = authStatusFromEnv({ VLY_EMAIL_API_KEY: "vly-key-123" });
    expect(status.emailOtpConfigured).toBe(true);
  });

  it("treats blank/whitespace keys as unconfigured", () => {
    expect(authStatusFromEnv({ VLY_EMAIL_API_KEY: "   " }).emailOtpConfigured).toBe(false);
    expect(authStatusFromEnv({ VLY_EMAIL_API_KEY: "" }).emailOtpConfigured).toBe(false);
  });

  it("never includes the key value in the report", () => {
    const status = authStatusFromEnv({ VLY_EMAIL_API_KEY: "sk-super-secret-value" });
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(JSON.stringify(status)).not.toContain("sk-");
  });

  it("marks auth usable when the site URL is present", () => {
    expect(authStatusFromEnv({ CONVEX_SITE_URL: "https://x.convex.cloud" }).authUsable).toBe(true);
    expect(authStatusFromEnv({}).authUsable).toBe(false);
  });
});
