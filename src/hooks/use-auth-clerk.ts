import { api } from "@/lib/api";
import { useQuery } from "@/hooks/use-supabase";
import { useAuth as useClerkAuth, useUser, useClerk } from "@clerk/react";

/**
 * Authentication state backed by Clerk.
 *
 * Returns the same interface as the Supabase implementation:
 *   { isLoading, isAuthenticated, user, session, signIn, signOut }
 *
 * `user` is the caller's row from the `profiles` table, or null when signed
 * out / no profile row exists yet. Clerk is the source of truth for identity;
 * Supabase handles data + RLS.
 */
export function useAuth() {
  const {
    isLoaded: clerkLoaded,
    isSignedIn,
  } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const { signOut: clerkSignOut } = useClerk();

  // Profile from the Atlas database (Supabase).
  // Only query when Clerk says the user is signed in and loaded.
  const profile = useQuery(
    api.users.currentUser,
    {},
    { enabled: Boolean(isSignedIn && clerkLoaded) },
  );

  const isAuthenticated = Boolean(isSignedIn && clerkLoaded);
  const isLoading = !clerkLoaded || (isAuthenticated && profile === undefined);

  const signIn = async (_provider?: string) => {
    // Clerk sign-in is handled via the Auth page's <SignIn /> component.
    void _provider;
  };

  const signOut = async () => {
    await clerkSignOut();
  };

  return {
    isLoading,
    isAuthenticated,
    user: profile,
    session: null,
    signIn,
    signOut,
  };
}
