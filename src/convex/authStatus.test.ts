// ---------------------------------------------------------------------------
// Phase 14 — Auth configuration status tests (Firebase Authentication).
// The report must be honest (booleans only — no secrets) and correctly
// identify the missing FIREBASE_SERVICE_ACCOUNT_JSON deployment variable that
// blocks the server-side token verification step of email login/signup.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { authStatusFromEnv } from "./authStatus";

describe("authStatusFromEnv", () => {
  it("reports Firebase unconfigured when the service account is missing", () => {
    const status = authStatusFromEnv({});
    expect(status.firebaseConfigured).toBe(false);
    expect(status.guestConfigured).toBe(true);
  });

  it("reports Firebase configured when the service account env is present", () => {
    const status = authStatusFromEnv({
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"project_id":"atlas","client_email":"a@b.iam.gserviceaccount.com"}',
    });
    expect(status.firebaseConfigured).toBe(true);
  });

  it("treats blank/whitespace service account env as unconfigured", () => {
    expect(authStatusFromEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: "   " }).firebaseConfigured).toBe(false);
    expect(authStatusFromEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: "" }).firebaseConfigured).toBe(false);
  });

  it("never includes the service account value in the report", () => {
    const status = authStatusFromEnv({
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"private_key":"BEGIN PRIVATE KEY secret"}',
    });
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(JSON.stringify(status)).not.toContain("PRIVATE");
  });

  it("marks auth usable when the site URL is present", () => {
    expect(authStatusFromEnv({ CONVEX_SITE_URL: "https://x.convex.cloud" }).authUsable).toBe(true);
    expect(authStatusFromEnv({}).authUsable).toBe(false);
  });
});
