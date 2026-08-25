/**
 * Client-side function to send team invitation emails via the team-invite-email
 * Edge Function.
 *
 * This is called AFTER tenants_invite_member RPC succeeds and the invite row
 * has been created in public.invites. The Edge Function verifies that a pending
 * invite exists for this email+tenant before sending the email.
 *
 * If this call fails, the DB invite still exists — the invited person will
 * still be able to join by signing up with the invited email address.
 * This function only provides the actual email notification.
 */
import { getSupabaseClient, resolvedSupabaseUrl } from "@/lib/supabase";

export interface TeamInviteEmailResult {
  ok: boolean;
  error?: string;
  message_id?: string;
}

export async function sendTeamInviteEmail(params: {
  email: string;
  tenantId: string;
  tenantName?: string;
  inviterName?: string;
}): Promise<TeamInviteEmailResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured" };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, error: "Not authenticated" };
  }

  const functionUrl = `${resolvedSupabaseUrl}/functions/v1/team-invite-email`;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  try {
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        ...(anonKey ? { apikey: anonKey } : {}),
      },
      body: JSON.stringify({
        email: params.email,
        tenantId: params.tenantId,
        tenantName: params.tenantName,
        inviterName: params.inviterName,
      }),
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      const serverError =
        result && typeof result === "object" && typeof result.error === "string"
          ? result.error
          : `HTTP ${response.status}`;
      return { ok: false, error: serverError };
    }

    return {
      ok: result?.ok ?? true,
      message_id: result?.message_id,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
