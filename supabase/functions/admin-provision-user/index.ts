// supabase/functions/admin-provision-user/index.ts
//
// Server-side user provisioning using the Supabase Auth Admin API.
// This function:
//   1. Authenticates the caller (must be super_admin or atlas_admin)
//   2. Creates/invites a Supabase Auth user via admin API
//   3. Provisions the Atlas profile via admin_invite_user RPC
//   4. Sends a branded invitation email via Resend
//
// Uses SUPABASE_SECRET_KEYS (modern built-in env var) for service-role access.
// No manual secret setup required.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const ATLAS_ALLOWED_ORIGINS = [
  "https://atlas-ai-os.com",
  "https://atlasmvp.freebuff.app",
  "https://atlasuniversalos.freebuff.app",
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (ATLAS_ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
  }
  return h;
}

function respond(corsH: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsH, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  const corsH = corsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsH });
  }

  if (req.method !== "POST") {
    return respond(corsH, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    // ── 1. Parse SUPABASE_SECRET_KEYS (modern built-in env var) ──────────
    const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (!secretKeysRaw) {
      console.error("SUPABASE_SECRET_KEYS not available");
      return respond(corsH, 500, { ok: false, error: "Server configuration error" });
    }

    let secretKeys: Record<string, string>;
    try {
      secretKeys = JSON.parse(secretKeysRaw);
    } catch {
      console.error("Failed to parse SUPABASE_SECRET_KEYS");
      return respond(corsH, 500, { ok: false, error: "Server configuration error" });
    }

    const serviceRoleKey = secretKeys["default"];
    if (!serviceRoleKey) {
      console.error("SUPABASE_SECRET_KEYS['default'] not found");
      return respond(corsH, 500, { ok: false, error: "Server configuration error" });
    }

    // ── 2. Parse SUPABASE_PUBLISHABLE_KEYS for the anon key ──────────────
    const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
    let anonKey: string;

    if (publishableKeysRaw) {
      try {
        const publishableKeys = JSON.parse(publishableKeysRaw);
        anonKey = publishableKeys["default"] ?? "";
      } catch {
        anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      }
    } else {
      anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    }

    if (!anonKey) {
      console.error("No anon/publishable key available");
      return respond(corsH, 500, { ok: false, error: "Server configuration error" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) {
      return respond(corsH, 500, { ok: false, error: "Server configuration error" });
    }

    // ── 3. Create a client with the caller's JWT (for auth verification) ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return respond(corsH, 401, { ok: false, error: "Missing authorization header" });
    }

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");

    // Client with the caller's JWT — used to verify the caller is an admin
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the caller is authenticated
    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser();

    if (authError || !user) {
      return respond(corsH, 401, { ok: false, error: "Not authenticated" });
    }

    // Verify the caller is an admin via the database
    const { data: callerProfile, error: profileError } = await supabaseUser
      .from("profiles")
      .select("platform_role, account_status")
      .eq("_id", user.id)
      .single();

    if (profileError || !callerProfile) {
      return respond(corsH, 403, { ok: false, error: "Profile not found" });
    }

    if (
      callerProfile.account_status !== "active" ||
      !["super_admin", "atlas_admin"].includes(callerProfile.platform_role)
    ) {
      return respond(corsH, 403, { ok: false, error: "Access denied: admin role required" });
    }

    // ── 4. Parse the request body ────────────────────────────────────────
    const { email, name, role, status, companyName } = await req.json();

    if (!email || typeof email !== "string") {
      return respond(corsH, 400, { ok: false, error: "Email is required" });
    }

    // Only super_admin can assign admin roles
    if (
      ["super_admin", "atlas_admin"].includes(role) &&
      callerProfile.platform_role !== "super_admin"
    ) {
      return respond(corsH, 403, { ok: false, error: "Only super_admin can assign admin roles" });
    }

    // ── 5. Create a service-role client for Auth Admin operations ────────
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // ── 6. Check if the user already exists in Supabase Auth ─────────────
    const { data: existingUsers, error: listError } =
      await supabaseAdmin.auth.admin.listUsers({
        filter: `email = "${email}"`,
      });

    if (listError) {
      console.error("Error listing users:", listError);
      return respond(corsH, 500, {
        ok: false,
        error: `Failed to check existing users: ${listError.message}`,
      });
    }

    let authUserId: string;
    let action: string;

    const existingUser = existingUsers?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );

    if (existingUser) {
      // User already exists in Supabase Auth
      authUserId = existingUser.id;
      action = "existing_user_provisioned";
    } else {
      // ── 7. Create a new Supabase Auth user with invitation ─────────────
      const siteUrl = Deno.env.get("SITE_URL") || "https://atlas-ai-os.com";
      const { data: inviteData, error: inviteError } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          data: {
            full_name: name || email.split("@")[0],
          },
          redirectTo: `${siteUrl}/auth`,
        });

      if (inviteError) {
        console.error("Error inviting user:", inviteError);
        return respond(corsH, 500, {
          ok: false,
          error: `Failed to create/invite user: ${inviteError.message}`,
        });
      }

      authUserId = inviteData?.id ?? "";
      action = "new_user_invited";

      if (!authUserId) {
        return respond(corsH, 500, {
          ok: false,
          error: "User creation succeeded but no ID returned",
        });
      }
    }

    // ── 8. Provision the Atlas profile via RPC ───────────────────────────
    // The fixed admin_invite_user RPC creates the invite record and handles
    // the profile/membership setup.
    const { data: rpcResult, error: rpcError } = await supabaseUser.rpc(
      "admin_invite_user",
      {
        p_email: email,
        p_name: name || null,
        p_role: role || "customer_user",
        p_status: status || "active",
        p_company_name: companyName || null,
      },
    );

    if (rpcError) {
      console.error("Error provisioning profile:", rpcError);
      // The Auth user was created but profile provisioning failed.
      return respond(corsH, 200, {
        ok: true,
        user_id: authUserId,
        action: action,
        warning: `Auth user created but profile provisioning had an issue: ${rpcError.message}. The user's profile will be created on first login.`,
      });
    }

    // ── 9. Send invitation email via Resend ──────────────────────────────
    let emailSent = false;
    let emailWarning: string | null = null;

    if (action === "new_user_invited") {
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      if (resendApiKey) {
        try {
          const senderEmail = Deno.env.get("RESEND_SENDER_EMAIL") || "pilot@atlas-ai-os.com";
          const senderName = Deno.env.get("RESEND_SENDER_NAME") || "Atlas";
          const siteUrl = Deno.env.get("SITE_URL") || "https://atlas-ai-os.com";

          const roleLabel = role || "customer_user";
          const html = `
            <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="margin:0 0 12px;color:#0f172a;">You're invited to Atlas</h2>
              <p style="color:#334155;line-height:1.6;margin:0 0 16px;">
                ${escapeHtml(name || "You")} have been invited to join Atlas as <strong>${escapeHtml(roleLabel)}</strong>.
              </p>
              <p style="color:#334155;line-height:1.6;margin:0 0 16px;">
                Atlas helps companies recover revenue that would otherwise be missed.
                Your account is ready — click below to set your password and access your workspace.
              </p>
              <a href="${siteUrl}/auth?returnTo=%2Fdashboard"
                 style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;
                        padding:10px 20px;border-radius:8px;font-weight:600;">Accept My Invitation</a>
              <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
                If you weren't expecting this invitation you can safely ignore this email.
              </p>
            </div>`;

          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: `${senderName} <${senderEmail}>`,
              to: [email],
              subject: "You're invited to Atlas",
              html,
            }),
          });

          if (res.ok) {
            emailSent = true;
            console.info(`[admin-provision-user] invitation email sent to ${email}`);
          } else {
            const errBody = await res.text().catch(() => "");
            console.error(`[admin-provision-user] Resend error ${res.status}: ${errBody.slice(0, 200)}`);
            emailWarning = "Invitation created but email could not be sent. The user can still sign in normally.";
          }
        } catch (e) {
          console.error("[admin-provision-user] email send error:", e);
          emailWarning = "Invitation created but email could not be sent. The user can still sign in normally.";
        }
      } else {
        emailWarning = "Invitation created but RESEND_API_KEY is not configured. Email not sent.";
      }
    }

    // ── 10. Return success ───────────────────────────────────────────────
    const message =
      action === "new_user_invited"
        ? emailSent
          ? `Invitation email sent to ${email}. User will receive a link to set their password and access Atlas.`
          : `Invitation created for ${email}. ${emailWarning || "Email was not sent."}`
        : `Existing user ${email} has been provisioned with role=${role}, status=${status}.`;

    return respond(corsH, 200, {
      ok: true,
      user_id: authUserId,
      action: action,
      message: message,
      invitation_sent: emailSent,
      warning: emailWarning,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return respond(corsH, 500, {
      ok: false,
      error: `Internal error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}
