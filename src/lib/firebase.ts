// ---------------------------------------------------------------------------
// Firebase Authentication — client-side SDK helpers.
//
// Firebase is the identity provider only. Signing in here gets a Firebase
// session + ID token; the ID token is then exchanged for a Convex Auth
// session (see src/hooks/use-auth.ts and src/convex/auth/firebaseProvider.ts).
// Convex remains the application backend and source of truth for all data.
//
// The client config values are public by design (they ship in the browser
// bundle). The server-side secret (FIREBASE_SERVICE_ACCOUNT_JSON) never
// touches this module.
// ---------------------------------------------------------------------------

import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type Auth,
  type User,
} from "firebase/auth";

const env = import.meta.env;

const FIREBASE_CONFIG = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

/**
 * True when the browser-side Firebase config keys are present. The Auth page
 * shows an honest banner when this is false (email login unavailable, Guest
 * still works) instead of firing doomed network calls.
 */
export function isFirebaseConfigured(): boolean {
  return Boolean(
    FIREBASE_CONFIG.apiKey &&
      FIREBASE_CONFIG.authDomain &&
      FIREBASE_CONFIG.projectId,
  );
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

function getApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured (VITE_FIREBASE_* keys missing).");
  }
  if (!app) {
    app = initializeApp({
      apiKey: FIREBASE_CONFIG.apiKey,
      authDomain: FIREBASE_CONFIG.authDomain,
      projectId: FIREBASE_CONFIG.projectId,
      appId: FIREBASE_CONFIG.appId,
      storageBucket: FIREBASE_CONFIG.storageBucket,
      messagingSenderId: FIREBASE_CONFIG.messagingSenderId,
    });
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!auth) {
    auth = getAuth(getApp());
  }
  return auth;
}

/** Create a new Firebase account and set the display name. */
export async function firebaseSignUp(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<User> {
  const credential = await createUserWithEmailAndPassword(
    getFirebaseAuth(),
    input.email.trim(),
    input.password,
  );
  if (input.name?.trim()) {
    await updateProfile(credential.user, { displayName: input.name.trim() });
  }
  return credential.user;
}

/** Sign in to an existing Firebase account. */
export async function firebaseSignIn(
  email: string,
  password: string,
): Promise<User> {
  return (
    await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password)
  ).user;
}

/** Send Firebase's password-reset email. Throws with an auth/* code on error. */
export async function firebaseSendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
}

/** Current Firebase user (persists across reloads via localStorage). */
export function getFirebaseCurrentUser(): User | null {
  if (!isFirebaseConfigured()) return null;
  return getFirebaseAuth().currentUser;
}

/** Fresh ID token for the signed-in Firebase user, or null. */
export async function getFirebaseIdToken(): Promise<string | null> {
  const user = getFirebaseCurrentUser();
  if (!user) return null;
  return user.getIdToken();
}

/** Sign out of Firebase only (Convex sign-out is handled by the auth hook). */
export async function firebaseSignOut(): Promise<void> {
  try {
    await signOut(getFirebaseAuth());
  } catch {
    // Already signed out — nothing to do.
  }
}
