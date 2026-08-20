/**
 * Barrel hook that selects the auth implementation based on whether a valid
 * Clerk publishable key is configured.
 *
 * When Clerk IS configured, the Clerk implementation is loaded via a static
 * import (ClerkProvider is mounted synchronously at the app root, so there
 * is no provider/hook ordering concern).
 *
 * When Clerk is NOT configured, only Supabase auth is used.
 */

import { isClerkConfigured } from "@/lib/clerk-config";

// Static imports for both implementations. Only the active one's hooks
// are actually invoked at runtime — the other code path is dead.
import { useAuth as useAuthClerk } from "./use-auth-clerk";
import { useAuth as useAuthSupabase } from "./use-auth-supabase";

/**
 * Authentication state for Atlas.
 *
 * When a valid Clerk publishable key is set, delegates to Clerk + Supabase bridge.
 * Otherwise, falls back to Supabase Auth directly.
 */
export function useAuth() {
  if (isClerkConfigured) {
    return useAuthClerk();
  }
  return useAuthSupabase();
}
