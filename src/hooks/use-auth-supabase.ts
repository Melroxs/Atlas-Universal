import { api } from "@/lib/api";
import { useQuery } from "@/hooks/use-supabase";
import {
  onSupabaseAuthChange,
  supabaseAnonymousSignIn,
  supabaseSignOut,
} from "@/lib/supabase";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

/**
 * Authentication state backed entirely by Supabase Auth.
 *
 * `user` is the caller's row from the `profiles` table (mirrors the old
 * Convex users table), or null when signed out / no profile row exists yet.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const user = useQuery(
    api.users.currentUser,
    {},
    { enabled: Boolean(session?.user) },
  );

  useEffect(() => {
    const unsubscribe = onSupabaseAuthChange((next) => {
      setSession(next);
      setReady(true);
    });
    return unsubscribe;
  }, []);

  const isAuthenticated = Boolean(session?.user);
  const isLoading = !ready || (isAuthenticated && user === undefined);

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
    signIn,
    signOut,
  };
}
