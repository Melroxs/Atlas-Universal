/**
 * Client-side function to provision a user via the admin-provision-user Edge Function.
 *
 * This function calls a server-side Edge Function that uses the Supabase
 * service-role key to create/invite Supabase Auth users and provision their
 * Atlas profiles. The service-role key is NEVER exposed to the browser.
 *
 * Flow:
 *   1. Frontend calls Edge Function with caller's JWT (for auth verification)
 *   2. Edge Function verifies caller is super_admin or atlas_admin
 *   3. Edge Function creates/invites Supabase Auth user (sends invitation email)
 *   4. Edge Function provisions Atlas profile via admin_invite_user RPC
 *   5. Returns result to frontend
 */
import { getSupabaseClient } from "@/lib/supabase";

export interface ProvisionUserResult {
  ok: boolean;
  user_id?: string;
  action?: string;
  message?: string;
  invitation_sent?: boolean;
  warning?: string;
  error?: string;
}

export async function provisionUserViaEdge(params: {
  email: string;
  name?: string;
  role?: string;
  status?: string;
  companyName?: string;
}): Promise<ProvisionUserResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured" };
  }

  // Get the current session's access token
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return { ok: false, error: "Not authenticated" };
  }

  // Get the Supabase URL for the Edge Function
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  if (!supabaseUrl) {
    return { ok: false, error: "Supabase URL not configured" };
  }
  const functionUrl = `${supabaseUrl}/functions/v1/admin-provision-user`;

  try {
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({
        email: params.email,
        name: params.name,
        role: params.role,
        status: params.status,
        companyName: params.companyName,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        ok: false,
        error: result.error || `HTTP ${response.status}`,
      };
    }

    return {
      ok: result.ok ?? true,
      user_id: result.user_id,
      action: result.action,
      message: result.message,
      invitation_sent: result.invitation_sent,
      warning: result.warning,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Edge Function call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
