// ---------------------------------------------------------------------------
// Supabase Authentication — client-side SDK helpers.
//
// Supabase is the identity provider only. Signing in here gets a Supabase
// session; the access token is then exchanged for a Convex Auth session (see
// src/hooks/use-auth.ts and src/convex/auth/supabaseProvider.ts). Convex
// remains the application backend and source of truth for all data.
//
// The client config values are public by design (they ship in the browser
// bundle). The server-side secrets (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
// never touch this module.
// ---------------------------------------------------------------------------

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

const env = import.meta.env;

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

/**
 * True when the browser-side Supabase config keys are present. The Auth page
 * shows an honest banner when this is false (email login unavailable, Guest
 * still works) instead of firing doomed network calls.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing).",
    );
  }
  if (!client) {
    client = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/** The Supabase client, or null when client config is missing. */
export function getSupabaseClient(): SupabaseClient | null {
  return isSupabaseConfigured() ? getClient() : null;
}

/**
 * Create a new Supabase account. Returns the user, or null when email
 * confirmation is enabled and the user must confirm their email before
 * signing in.
 */
export async function supabaseSignUp(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ user: User | null; needsEmailConfirmation: boolean }> {
  const { data, error } = await getClient().auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: input.name?.trim() ? { full_name: input.name.trim() } : undefined,
    },
  });
  if (error) throw error;
  return {
    user: data.user ?? null,
    needsEmailConfirmation: !data.session,
  };
}

/** Sign in to an existing Supabase account. */
export async function supabaseSignIn(
  email: string,
  password: string,
): Promise<User> {
  const { data, error } = await getClient().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  if (!data.user) throw new Error("Supabase sign-in returned no user.");
  return data.user;
}

/** Send Supabase's password-reset email. Throws with an error code on failure. */
export async function supabaseSendPasswordReset(email: string): Promise<void> {
  const { error } = await getClient().auth.resetPasswordForEmail(email.trim());
  if (error) throw error;
}

/** Current Supabase session access token, or null when signed out. */
export async function getSupabaseAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await getClient().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Sign out of Supabase only (Convex sign-out is handled by the auth hook). */
export async function supabaseSignOut(): Promise<void> {
  try {
    await getClient().auth.signOut();
  } catch {
    // Already signed out — nothing to do.
  }
}
