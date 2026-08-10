// ---------------------------------------------------------------------------
// Auth configuration status — honest, secret-free runtime diagnostics.
//
// Email OTP sends through the Freebuff relay (auth.freebuff.app/send_otp)
// using VLY_EMAIL_API_KEY. When that key is missing from the Convex
// environment, email login/signup fails with "Failed to send verification
// email (status 401)" — a blocking MVP defect that is purely a deployment
// configuration issue. This query reports presence (boolean) only, so the UI
// can explain exactly what is missing without ever exposing the key.
// ---------------------------------------------------------------------------

import { query } from "./_generated/server";

export interface AuthStatusReport {
  /** True when VLY_EMAIL_API_KEY is set in the Convex environment. */
  emailOtpConfigured: boolean;
  /** True when the anonymous (Guest) provider is registered. */
  guestConfigured: boolean;
  /** True when auth is usable at all (site URL present for OIDC discovery). */
  authUsable: boolean;
}

export type AuthEnv = Record<string, string | undefined>;

/** Pure derivation for unit tests — no secrets in the output, only booleans. */
export function authStatusFromEnv(env: AuthEnv): AuthStatusReport {
  const key = env.VLY_EMAIL_API_KEY;
  return {
    emailOtpConfigured: Boolean(key && key.trim().length > 0),
    guestConfigured: true, // Anonymous provider is statically registered
    authUsable: Boolean(env.CONVEX_SITE_URL),
  };
}

/** Public query — safe for signed-out users on the /auth page. */
export const authStatus = query({
  args: {},
  handler: async () =>
    authStatusFromEnv({
      VLY_EMAIL_API_KEY: process.env.VLY_EMAIL_API_KEY,
      CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
    }),
});
