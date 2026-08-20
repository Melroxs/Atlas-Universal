import { api } from "@/lib/api";
import { useQuery } from "@/hooks/use-supabase";
import { useAuth as useClerkAuth, useUser, useClerk } from "@clerk/clerk-react";

/**
 * Authentication state backed by Clerk.
 *
 * Usage:
 *   const { isLoading, isAuthenticated, user, signIn, signOut } = useAuth();
 *
 * `user` is the caller's row from the `profiles` table (mirrors the old
 * Convex users table), or null when signed out / no profile row exists yet.
 *
 * Clerk is the source of truth for identity. Supabase handles data + RLS.
 */
export function useAuth() {
  const {
    isLoaded: clerkLoaded,
    isSignedIn,
    getToken,
  } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const { signOut: clerkSignOut } = useClerk();

  // Profile from the Atlas database (Supabase). This gives us the workspace
  // membership, role, and company info that Clerk doesn't store.
  const profile = useQuery(
    api.users.currentUser,
    {},
    { enabled: Boolean(isSignedIn && clerkLoaded) },
  );

  const isAuthenticated = Boolean(isSignedIn && clerkLoaded);
  const isLoading = !clerkLoaded || (isAuthenticated && profile === undefined);

  /**
   * Sign in — delegates to the Auth page which renders Clerk's <SignIn />.
   * This is called from components that need to trigger the Clerk modal.
   */
  const signIn = async (_provider?: string) => {
    // The actual sign-in flow is handled by the Auth page's Clerk <SignIn />.
    // This function exists for API compatibility with the old useAuth contract.
    void _provider;
  };

  /**
   * Sign out — clears the Clerk session and any Supabase session state.
   */
  const signOut = async () => {
    await clerkSignOut();
  };

  return {
    isLoading,
    isAuthenticated,
    user: profile,
    session: null, // Clerk manages sessions; Supabase session is derived
    clerkUser,
    getToken,
    signIn,
    signOut,
  };
}
