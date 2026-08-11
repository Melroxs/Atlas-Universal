"use node";

/**
 * Supabase access-token verification (Node runtime).
 *
 * Supabase Authentication is the identity provider for Atlas. This action is
 * the ONLY place the Supabase server-side (service-role) client is created,
 * so it must run on the Node runtime ("use node"). The credentials provider
 * (supabaseProvider.ts, V8) calls this action via ctx.runAction and never
 * touches the service-role key itself.
 *
 * The service-role client calls the Auth API's getUser endpoint to validate
 * the access token server-side. This checks the signature, expiry, and that
 * the user actually exists in the Supabase project (not deleted/banned).
 *
 * Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from the
 * Convex environment and never leave this module. Only sanitized, verified
 * claims are returned.
 */

import { createClient } from "@supabase/supabase-js";
import { action } from "../_generated/server";
import { v } from "convex/values";

/** Verified, sanitized claims — the only thing the rest of the system sees. */
export interface VerifiedSupabaseClaims {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !url.trim()) {
    throw new Error("Supabase is not configured (SUPABASE_URL missing).");
  }
  if (!key || !key.trim()) {
    throw new Error(
      "Supabase is not configured (SUPABASE_SERVICE_ROLE_KEY missing).",
    );
  }
  return createClient(url.trim(), key.trim(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Verify a Supabase access token and return its sanitized claims.
 * Throws for expired/malformed tokens, missing users, and for missing server
 * config — the provider never creates an account from an unverified identity.
 */
export const verifySupabaseAccessToken = action({
  args: { accessToken: v.string() },
  handler: async (_ctx, { accessToken }): Promise<VerifiedSupabaseClaims> => {
    const token = accessToken.trim();
    if (!token) {
      throw new Error("Missing Supabase access token.");
    }
    const { data, error } = await getAdminClient().auth.getUser(token);
    if (error || !data.user) {
      throw new Error("Invalid Supabase session.");
    }
    const user = data.user;
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    return {
      uid: user.id,
      email: typeof user.email === "string" ? user.email : null,
      emailVerified: Boolean(
        user.email_confirmed_at || user.confirmed_at,
      ),
      name:
        typeof meta.full_name === "string"
          ? meta.full_name
          : typeof meta.name === "string"
            ? meta.name
            : null,
      picture:
        typeof meta.avatar_url === "string"
          ? meta.avatar_url
          : typeof meta.picture === "string"
            ? meta.picture
            : null,
    };
  },
});
