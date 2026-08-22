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
import { normalizeRole, normalizeStatus, type AtlasRole, type AtlasAccountStatus } from "@/lib/auth/access-gate";

/**
 * Authentication state backed entirely by Supabase Auth.
 *
 * Usage:
 *   const { isLoading, isAuthenticated, user, role, accountStatus, signIn, signOut } = useAuth();
 *
 * `user` is the caller's row from the `profiles` table (mirrors the old
 * Convex users table), or null when signed out / no profile row exists yet.
 *
 * `role` and `accountStatus` are derived from the profile row, normalized
 * to canonical Atlas values.
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

  // Derive role and account status from profile
  const role: AtlasRole = normalizeRole(user?.platform_role);
  const accountStatus: AtlasAccountStatus = normalizeStatus(user?.account_status);

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
    role,
    accountStatus,
    session,
    lastEvent,
    signIn,
    signOut,
  };
}
