"use node";

/**
 * Firebase ID-token verification (Node runtime).
 *
 * Firebase Authentication is the identity provider for Atlas. This action is
 * the ONLY place the Firebase Admin SDK is imported, so it must run on the
 * Node runtime ("use node"). The credentials provider (firebaseProvider.ts,
 * V8) calls this action via ctx.runAction and never touches the service
 * account itself.
 *
 * Secrets: the service account JSON is read from the Convex environment
 * (FIREBASE_SERVICE_ACCOUNT_JSON) and never leaves this module. Only
 * sanitized, verified claims are returned.
 */

import { cert, getApps, initializeApp } from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { action } from "../_generated/server";
import { v } from "convex/values";

/** Verified, sanitized claims — the only thing the rest of the system sees. */
export interface VerifiedFirebaseClaims {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

function getAdminApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) {
    throw new Error(
      "Firebase is not configured (FIREBASE_SERVICE_ACCOUNT_JSON missing).",
    );
  }
  let serviceAccount: Record<string, string>;
  try {
    serviceAccount = JSON.parse(raw) as Record<string, string>;
  } catch {
    throw new Error(
      "Firebase is not configured (FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON).",
    );
  }
  if (!serviceAccount.project_id || !serviceAccount.client_email) {
    throw new Error(
      "Firebase is not configured (FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields).",
    );
  }
  return initializeApp({
    credential: cert(serviceAccount as Parameters<typeof cert>[0]),
  });
}

/**
 * Verify a Firebase ID token and return its sanitized claims.
 * Throws for expired/malformed tokens and for missing server config, so the
 * provider never creates an account from an unverified identity.
 */
export const verifyFirebaseIdToken = action({
  args: { idToken: v.string() },
  handler: async (_ctx, { idToken }): Promise<VerifiedFirebaseClaims> => {
    const token = idToken.trim();
    if (!token) {
      throw new Error("Missing Firebase ID token.");
    }
    const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === "string" ? decoded.email : null,
      emailVerified: decoded.email_verified === true,
      name: typeof decoded.name === "string" ? decoded.name : null,
      picture: typeof decoded.picture === "string" ? decoded.picture : null,
    };
  },
});
