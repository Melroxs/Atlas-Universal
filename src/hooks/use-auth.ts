import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import {
  getSupabaseAccessToken,
  getSupabaseClient,
  isSupabaseConfigured,
  supabaseSignOut,
} from "@/lib/supabase";

export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.currentUser);
  const { signIn, signOut: convexSignOut } = useAuthActions();
  const [hasSupabaseSession, setHasSupabaseSession] = useState(false);
  const exchanging = useRef(false);

  // Track the Supabase session (persists across reloads via localStorage).
  // Guest (anonymous) users never touch Supabase, so hasSupabaseSession stays
  // false for them.
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSupabaseSession(Boolean(session));
    });
    // Seed state from the persisted session (onAuthStateChange fires async).
    void supabase.auth.getSession().then(({ data: sessionData }) => {
      setHasSupabaseSession(Boolean(sessionData.session));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Session bridge: when a live Supabase session exists but the Convex
  // session is gone (expired/cleared), exchange a fresh access token for a
  // new Convex session. Skipped on /auth — the auth page performs its own
  // explicit exchange and this would only race it.
  useEffect(() => {
    if (!hasSupabaseSession || !isSupabaseConfigured()) return;
    if (isAuthLoading || isAuthenticated || exchanging.current) return;
    if (typeof window !== "undefined" && window.location.pathname === "/auth") {
      return;
    }
    exchanging.current = true;
    void (async () => {
      try {
        const accessToken = await getSupabaseAccessToken();
        if (accessToken) {
          await signIn("supabase", { accessToken });
        }
      } catch (error) {
        // A failed exchange (e.g. server key missing) must not leave the user
        // stuck in an unauthenticated loop — sign out of Supabase so the
        // bridge stops retrying and the user can sign in again explicitly.
        console.error("Supabase session exchange failed:", error);
        await supabaseSignOut();
      } finally {
        exchanging.current = false;
      }
    })();
  }, [hasSupabaseSession, isAuthLoading, isAuthenticated, signIn]);

  /** Sign out of both Supabase and the Convex session. */
  const signOut = async () => {
    await supabaseSignOut();
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
