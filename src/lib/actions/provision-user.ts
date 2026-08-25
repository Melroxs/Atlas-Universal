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
import { getSupabaseClient, resolvedSupabaseUrl } from "@/lib/supabase";

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

  // Derive the project URL from the configured client (honors the public
  // fallback in lib/supabase.ts) rather than import.meta.env directly —
  // VITE_SUPABASE_URL may legitimately be absent in production builds.
  const functionUrl = `${resolvedSupabaseUrl}/functions/v1/admin-provision-user`;

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

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      // Surface the REAL failure class instead of a generic message so the
      // Super Admin (and diagnostics) can tell deployment issues apart from
      // authorization/validation/runtime failures.
      const serverError =
        result && typeof result === "object" && typeof result.error === "string"
          ? result.error
          : null;
      let reason: string;
      switch (response.status) {
        case 400:
          reason = serverError ?? "Invalid request";
          break;
        case 401:
          reason = "Your session has expired. Please sign in again.";
          break;
        case 403:
          reason = serverError ?? "You do not have permission to provision users.";
          break;
        case 404:
          reason =
            "The provisioning service is not deployed yet (admin-provision-user Edge Function is missing on the server). Contact your administrator to deploy it.";
          break;
        default:
          reason =
            serverError ??
            `Provisioning service error (HTTP ${response.status})`;
      }
      console.error(
        `[atlas] admin-provision-user failed: HTTP ${response.status}`,
        serverError ? `server: ${serverError.slice(0, 200)}` : "(no body)",
      );
      return { ok: false, error: reason };
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
    const msg = err instanceof Error ? err.message : String(err);
    // Distinguish network/CORS failures from other errors so "Failed to fetch"
    // never masks the actual layer that broke.
    const hint = /failed to fetch|networkerror|load failed/i.test(msg)
      ? " (network or CORS blocked the request — check that the function is deployed and the origin is allowed)"
      : "";
    return {
      ok: false,
      error: `Could not reach the provisioning service${hint}: ${msg}`,
    };
  }
}
