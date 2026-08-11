// ---------------------------------------------------------------------------
// Auth configuration status — honest, secret-free runtime diagnostics.
//
// Firebase Authentication is the identity provider. Two layers must be
// configured for email login/signup to work:
//   1. Client (VITE_FIREBASE_*) — checked in the browser by src/lib/firebase.ts.
//   2. Server (FIREBASE_SERVICE_ACCOUNT_JSON) — checked here; the Admin SDK
//      action in auth/firebaseVerify.ts uses it to verify ID tokens. When it
//      is missing, the exchange fails with "Firebase is not configured".
// This query reports presence (boolean) only, so the UI can explain exactly
// what is missing without ever exposing the key.
// ---------------------------------------------------------------------------

import { query } from "./_generated/server";

export interface AuthStatusReport {
  /** True when FIREBASE_SERVICE_ACCOUNT_JSON is set in the Convex environment. */
  firebaseConfigured: boolean;
  /** True when the anonymous (Guest) provider is registered. */
  guestConfigured: boolean;
  /** True when auth is usable at all (site URL present for OIDC discovery). */
  authUsable: boolean;
}

export type AuthEnv = Record<string, string | undefined>;

/** Pure derivation for unit tests — no secrets in the output, only booleans. */
export function authStatusFromEnv(env: AuthEnv): AuthStatusReport {
  const key = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  return {
    firebaseConfigured: Boolean(key && key.trim().length > 0),
    guestConfigured: true, // Anonymous provider is statically registered
    authUsable: Boolean(env.CONVEX_SITE_URL),
  };
}

/** Public query — safe for signed-out users on the /auth page. */
export const authStatus = query({
  args: {},
  handler: async () =>
    authStatusFromEnv({
      FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
      CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
    }),
});
