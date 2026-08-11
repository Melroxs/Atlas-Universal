/**
 * Firebase Authentication — Convex Auth credentials provider.
 *
 * Flow:
 *   1. The browser signs in with Firebase (email/password) and obtains an ID
 *      token from the Firebase SDK.
 *   2. The client calls Convex Auth's signIn action with provider "firebase"
 *      and params `{ idToken }`.
 *   3. This provider verifies the token through the Node action in
 *      firebaseVerify.ts (Firebase Admin SDK), then links the identity to a
 *      Convex user via the internal mutation in firebaseLink.ts.
 *   4. Convex Auth mints a normal Convex session — every existing tenant
 *      isolation / authorization rule keeps working unchanged.
 *
 * Firebase is the identity provider only. Convex remains the application
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
import type { VerifiedFirebaseClaims } from "./firebaseVerify";

const verifyFirebaseIdToken = makeFunctionReference<"action">(
  "auth/firebaseVerify:verifyFirebaseIdToken",
);
const firebaseEnsureUser = makeFunctionReference<"mutation">(
  "auth/firebaseLink:firebaseEnsureUser",
);

export const Firebase = ConvexCredentials({
  id: "firebase",
  authorize: async (credentials, ctx) => {
    const idToken = credentials.idToken;
    if (typeof idToken !== "string" || idToken.trim().length === 0) {
      throw new Error("Missing Firebase ID token.");
    }

    // Verify server-side with the Admin SDK. Throws on invalid/expired tokens
    // or when FIREBASE_SERVICE_ACCOUNT_JSON is missing — no account is ever
    // created from an unverified identity.
    const claims = (await ctx.runAction(verifyFirebaseIdToken, {
      idToken: idToken.trim(),
    })) as VerifiedFirebaseClaims;
    if (!claims.uid) {
      throw new Error("Invalid Firebase session.");
    }

    // Find or create the Convex user, then let Convex Auth mint a session
    // for it.
    const userId = await ctx.runMutation(firebaseEnsureUser, {
      uid: claims.uid,
      email: claims.email ?? undefined,
      emailVerified: claims.emailVerified,
      name: claims.name ?? undefined,
      picture: claims.picture ?? undefined,
    });

    return { userId };
  },
});
