// ---------------------------------------------------------------------------
// Supabase — the single backend for Atlas.
//
// Auth (email/password + anonymous guests + password reset) and all data go
// through Supabase. The anon key is public by design (it ships in the browser
// bundle); every table is locked down with row-level security and every data
// operation runs as a Postgres RPC so tenants can never see each other.
// Server-side secrets (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) are used only
// by Edge Functions / the Supabase platform — never by this module.
// ---------------------------------------------------------------------------

import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

const env = import.meta.env;

const SUPABASE_URL = env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * True when the browser-side Supabase config keys are present. The Auth page
 * shows an honest banner when this is false instead of firing doomed calls.
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

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

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

/** Sign in as an anonymous guest (no email/password required). */
export async function supabaseAnonymousSignIn(): Promise<User> {
  const { data, error } = await getClient().auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error("Supabase anonymous sign-in returned no user.");
  return data.user;
}

/** Send Supabase's password-reset email. Throws with an error code on failure. */
export async function supabaseSendPasswordReset(email: string): Promise<void> {
  const { error } = await getClient().auth.resetPasswordForEmail(email.trim());
  if (error) throw error;
}

/** Current Supabase session, or null when signed out. */
export async function getSupabaseSession(): Promise<Session | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await getClient().auth.getSession();
  return data.session ?? null;
}

/** Sign out of Supabase. */
export async function supabaseSignOut(): Promise<void> {
  try {
    await getClient().auth.signOut();
  } catch {
    // Already signed out — nothing to do.
  }
}

/** Subscribe to auth state changes. Returns an unsubscribe function. */
export function onSupabaseAuthChange(
  callback: (session: Session | null) => void,
): () => void {
  if (!isSupabaseConfigured()) return () => undefined;
  const supabase = getClient();
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  void supabase.auth.getSession().then(({ data: sessionData }) => {
    callback(sessionData.session ?? null);
  });
  return () => data.subscription.unsubscribe();
}
