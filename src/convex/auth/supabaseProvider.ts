/**
 * Supabase Authentication — Convex Auth credentials provider.
 *
 * Flow:
 *   1. The browser signs in with Supabase (email/password) and obtains an
 *      access token from the Supabase SDK session.
 *   2. The client calls Convex Auth's signIn action with provider "supabase"
 *      and params `{ accessToken }`.
 *   3. This provider verifies the token through the Node action in
 *      supabaseVerify.ts (service-role client), then links the identity to a
 *      Convex user via the internal mutation in supabaseLink.ts.
 *   4. Convex Auth mints a normal Convex session — every existing tenant
 *      isolation / authorization rule keeps working unchanged.
 *
 * Supabase is the identity provider only. Convex remains the application
 * backend and the source of truth for all Atlas data.
 *
 * Notes:
 * - Actions in this Convex version have no direct database access
 *   (ctx.db is unavailable), so all reads/writes go through ctx.runAction /
 *   ctx.runMutation.
 * - This file must NOT import `_generated/api`: `_generated/api` imports
 *   `auth.ts` (the signIn action), which imports this provider — an import
 *   cycle that degrades the provider type to `any` and cascades type errors
 *   across the whole app. Function references are built with
 *   `makeFunctionReference` instead.
 */

import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { makeFunctionReference } from "convex/server";
import type { VerifiedSupabaseClaims } from "./supabaseVerify";

const verifySupabaseAccessToken = makeFunctionReference<"action">(
  "auth/supabaseVerify:verifySupabaseAccessToken",
);
const supabaseEnsureUser = makeFunctionReference<"mutation">(
  "auth/supabaseLink:supabaseEnsureUser",
);

export const Supabase = ConvexCredentials({
  id: "supabase",
  authorize: async (credentials, ctx) => {
    const accessToken = credentials.accessToken;
    if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
      throw new Error("Missing Supabase access token.");
    }

    // Verify server-side with the service-role client. Throws on
    // invalid/expired tokens or when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
    // are missing — no account is ever created from an unverified identity.
    const claims = (await ctx.runAction(verifySupabaseAccessToken, {
      accessToken: accessToken.trim(),
    })) as VerifiedSupabaseClaims;
    if (!claims.uid) {
      throw new Error("Invalid Supabase session.");
    }

    // Find or create the Convex user, then let Convex Auth mint a session
    // for it.
    const userId = await ctx.runMutation(supabaseEnsureUser, {
      uid: claims.uid,
      email: claims.email ?? undefined,
      emailVerified: claims.emailVerified,
      name: claims.name ?? undefined,
      picture: claims.picture ?? undefined,
    });

    return { userId };
  },
});
