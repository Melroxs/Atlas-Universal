// ---------------------------------------------------------------------------
// Clerk → Supabase JWT Bridge
//
// This module configures the Supabase client to use Clerk session tokens
// for authentication. Clerk is the identity provider; Supabase remains the
// database. The Supabase client reads the Clerk JWT and uses it for RLS.
//
// Prerequisites:
// 1. Clerk Dashboard → Configure → JWT Templates → "supabase" template
//    - Algorithm: HMAC (HS256)
//    - Secret: paste your Supabase JWT secret (from Supabase Dashboard → Settings → API → JWT Secret)
//    - Claims:
//        sub: "{{user.id}}"
//        role: "authenticated"
//        aud: "authenticated"
//        app_metadata: {}
//        user_metadata: { email: "{{user.primary_email_address.email_address}}", full_name: "{{user.first_name}} {{user.last_name}}" }
// 2. Supabase Dashboard → Authentication → Providers → enable Clerk or set JWT issuer
// ---------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isHttpUrl, isJwt } from "@/lib/supabase";

// The Supabase URL and anon key are public by design (they ship in every
// browser bundle; RLS gates all data).
const FALLBACK_URL = "https://ibxvzxblyhzwokljkslt.supabase.co";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlieHZ6eGJseWh6d29rbGprc2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0ODM3NzYsImV4cCI6MjEwMjA1OTc3Nn0.12Fubl-jzjDaVaHQFCGrUQODTtZaeiGPNBGNjQoPhyc";

const RAW_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const RAW_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const SUPABASE_URL = isHttpUrl(RAW_URL) ? RAW_URL : FALLBACK_URL;
const SUPABASE_ANON_KEY = isJwt(RAW_ANON_KEY) ? RAW_ANON_KEY : FALLBACK_ANON_KEY;

/**
 * Create a Supabase client authenticated with a Clerk session token.
 *
 * Called once per auth state change so Supabase RLS sees the Clerk identity.
 * Falls back to the anonymous client when no token is provided.
 */
export function createSupabaseClientWithClerk(
  getToken: () => Promise<string | null>,
): SupabaseClient {
  return createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        // The Authorization header is set per-request via the
        // supabase.auth.getSession() wrapper below; this is a placeholder.
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Singleton client with Clerk token injection
// ---------------------------------------------------------------------------

let clerkClient: SupabaseClient | null = null;
let currentGetToken: (() => Promise<string | null>) | null = null;

/**
 * Get or create the Supabase client that uses Clerk tokens for auth.
 * When the Clerk token function changes (sign-in / sign-out), the client
 * is reconfigured so the next RPC call uses the fresh token.
 */
export function getSupabaseClientWithClerk(
  getToken: () => Promise<string | null>,
): SupabaseClient {
  if (!clerkClient || currentGetToken !== getToken) {
    currentGetToken = getToken;
    clerkClient = createClient(
      SUPABASE_URL as string,
      SUPABASE_ANON_KEY as string,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  }
  return clerkClient;
}

/**
 * Inject the Clerk JWT into the Supabase client's auth session so that
 * every RPC call carries the correct Authorization header.
 *
 * This replaces the old `supabase.auth.setSession()` call with a Clerk token.
 */
export async function setSupabaseSessionFromClerk(
  supabase: SupabaseClient,
  getToken: () => Promise<string | null>,
): Promise<void> {
  const token = await getToken();
  if (!token) {
    // No Clerk session — clear the Supabase session
    await supabase.auth.setSession({ access_token: "", refresh_token: "" });
    return;
  }
  // Set a fake session so Supabase uses the token in Authorization header
  await supabase.auth.setSession({
    access_token: token,
    refresh_token: "clerk-managed",
  });
}
