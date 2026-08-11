// ---------------------------------------------------------------------------
// Auth configuration status — honest, secret-free runtime diagnostics.
//
// Supabase Authentication is the identity provider. Two layers must be
// configured for email login/signup to work:
//   1. Client (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY) — checked in the
//      browser by src/lib/supabase.ts.
//   2. Server (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) — checked here; the
//      service-role action in auth/supabaseVerify.ts uses them to validate
//      access tokens. When they are missing, the exchange fails with
//      "Supabase is not configured".
// This query reports presence (boolean) only, so the UI can explain exactly
// what is missing without ever exposing the key.
// ---------------------------------------------------------------------------

import { query } from "./_generated/server";

export interface AuthStatusReport {
  /** True when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in the Convex environment. */
  supabaseConfigured: boolean;
  /** True when the anonymous (Guest) provider is registered. */
  guestConfigured: boolean;
  /** True when auth is usable at all (site URL present for OIDC discovery). */
  authUsable: boolean;
}

export type AuthEnv = Record<string, string | undefined>;

/** Pure derivation for unit tests — no secrets in the output, only booleans. */
export function authStatusFromEnv(env: AuthEnv): AuthStatusReport {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    supabaseConfigured: Boolean(
      url && url.trim().length > 0 && key && key.trim().length > 0,
    ),
    guestConfigured: true, // Anonymous provider is statically registered
    authUsable: Boolean(env.CONVEX_SITE_URL),
  };
}

/** Public query — safe for signed-out users on the /auth page. */
export const authStatus = query({
  args: {},
  handler: async () =>
    authStatusFromEnv({
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
    }),
});
