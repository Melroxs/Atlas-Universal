import { api } from "@/lib/api";
import { useQuery } from "@/hooks/use-supabase";
import {
  type SupabaseAuthEvent,
  onSupabaseAuthChange,
  supabaseAnonymousSignIn,
  supabaseSignOut,
} from "@/lib/supabase";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

/**
 * Authentication state backed entirely by Supabase Auth.
 *
 * Usage:
 *   const { isLoading, isAuthenticated, user, signIn, signOut } = useAuth();
 *
 * `user` is the caller's row from the `profiles` table (mirrors the old
 * Convex users table), or null when signed out / no profile row exists yet.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [lastEvent, setLastEvent] = useState<SupabaseAuthEvent | null>(null);
  const user = useQuery(
    api.users.currentUser,
    {},
    { enabled: Boolean(session?.user) },
  );

  useEffect(() => {
    const unsubscribe = onSupabaseAuthChange((next, event) => {
      setSession(next);
      if (event) setLastEvent(event);
      setReady(true);
    });
    return unsubscribe;
  }, []);

  const isAuthenticated = Boolean(session?.user);
  const isLoading = !ready || (isAuthenticated && user === undefined);

  /** Sign in as a guest (anonymous Supabase identity). */
  const signIn = async (provider?: string) => {
    if (provider === "anonymous") {
      await supabaseAnonymousSignIn();
      return;
    }
    throw new Error(
      "Direct sign-in must go through the Auth page (email/password or Guest).",
    );
  };

  const signOut = async () => {
    await supabaseSignOut();
  };

  return {
    isLoading,
    isAuthenticated,
    user,
    session,
    lastEvent,
    signIn,
    signOut,
  };
}
