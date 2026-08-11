import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import {
  firebaseSignOut,
  getFirebaseAuth,
  getFirebaseIdToken,
  isFirebaseConfigured,
} from "@/lib/firebase";

export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.currentUser);
  const { signIn, signOut: convexSignOut } = useAuthActions();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const exchanging = useRef(false);

  // Track the Firebase session (survives reloads via localStorage). Guest
  // (anonymous) users never touch Firebase, so firebaseUser stays null.
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => setFirebaseUser(u));
    return unsubscribe;
  }, []);

  // Session bridge: when a live Firebase session exists but the Convex
  // session is gone (expired/cleared), exchange a fresh ID token for a new
  // Convex session. Skipped on /auth — the auth page performs its own
  // explicit exchange and this would only race it.
  useEffect(() => {
    if (!firebaseUser || !isFirebaseConfigured()) return;
    if (isAuthLoading || isAuthenticated || exchanging.current) return;
    if (typeof window !== "undefined" && window.location.pathname === "/auth") {
      return;
    }
    exchanging.current = true;
    void (async () => {
      try {
        const idToken = await getFirebaseIdToken();
        if (idToken) {
          await signIn("firebase", { idToken });
        }
      } catch (error) {
        // A failed exchange (e.g. server key missing) must not leave the user
        // stuck in an unauthenticated loop — sign out of Firebase so the
        // bridge stops retrying and the user can sign in again explicitly.
        console.error("Firebase session exchange failed:", error);
        await firebaseSignOut();
      } finally {
        exchanging.current = false;
      }
    })();
  }, [firebaseUser, isAuthLoading, isAuthenticated, signIn]);

  /** Sign out of both Firebase and the Convex session. */
  const signOut = async () => {
    await firebaseSignOut();
    await convexSignOut();
  };

  // Derive isLoading directly from the dependencies instead of managing separate state
  const isLoading = isAuthLoading || user === undefined;

  return {
    isLoading,
    isAuthenticated,
    user,
    signIn,
    signOut,
  };
}
