// supabase/functions/admin-provision-user/index.ts
//
// Server-side user provisioning using the Supabase Auth Admin API.
// This function uses SUPABASE_SECRET_KEYS['default'] (the modern built-in
// service-role key) to create/invite Supabase Auth users and provision
// their Atlas profiles.
//
// SUPABASE_SECRET_KEYS is a built-in Edge Function env var — a JSON dictionary
// containing all secret keys for the project. The 'default' entry holds the
// service_role key, which bypasses RLS for admin operations.
//
// The service-role key is NEVER exposed to the browser — it lives only
// in this Edge Function's runtime via Supabase's built-in secret injection.
//
// Deploy:
//   supabase functions deploy admin-provision-user
//
// No manual secret setup required — SUPABASE_SECRET_KEYS is injected automatically.
// If SITE_URL is needed, set it via:
//   supabase secrets set SITE_URL=https://atlasmvp.freebuff.app

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. Parse SUPABASE_SECRET_KEYS (modern built-in env var) ──────────
    const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (!secretKeysRaw) {
      console.error("SUPABASE_SECRET_KEYS not available");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let secretKeys: Record<string, string>;
    try {
      secretKeys = JSON.parse(secretKeysRaw);
    } catch {
      console.error("Failed to parse SUPABASE_SECRET_KEYS");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const serviceRoleKey = secretKeys["default"];
    if (!serviceRoleKey) {
      console.error("SUPABASE_SECRET_KEYS['default'] not found");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 2. Parse SUPABASE_PUBLISHABLE_KEYS for the anon key ──────────────
    const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
    let anonKey: string;

    if (publishableKeysRaw) {
      try {
        const publishableKeys = JSON.parse(publishableKeysRaw);
        anonKey = publishableKeys["default"] ?? "";
      } catch {
        // Fall back to legacy
        anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      }
    } else {
      // Legacy fallback — SUPABASE_ANON_KEY is still available
      anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    }

    if (!anonKey) {
      console.error("No anon/publishable key available");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 3. Create a client with the caller's JWT (for auth verification) ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Client with the caller's JWT — used to verify the caller is an admin
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      anonKey,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Verify the caller is authenticated
    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify the caller is an admin via the database
    const { data: callerProfile, error: profileError } = await supabaseUser
      .from("profiles")
      .select("platform_role, account_status")
      .eq("_id", user.id)
      .single();

    if (profileError || !callerProfile) {
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (
      callerProfile.account_status !== "active" ||
      !["super_admin", "atlas_admin"].includes(callerProfile.platform_role)
    ) {
      return new Response(
        JSON.stringify({ error: "Access denied: admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 4. Parse the request body ────────────────────────────────────────
    const { email, name, role, status, companyName } = await req.json();

    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Only super_admin can assign admin roles
    if (
      ["super_admin", "atlas_admin"].includes(role) &&
      callerProfile.platform_role !== "super_admin"
    ) {
      return new Response(
        JSON.stringify({ error: "Only super_admin can assign admin roles" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 5. Create a service-role client for Auth Admin operations ────────
    // This bypasses RLS — used only for admin API calls (inviteUserByEmail,
    // listUsers). The service-role key comes from SUPABASE_SECRET_KEYS,
    // which is a Supabase-managed built-in env var.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey,
    );

    // ── 6. Check if the user already exists in Supabase Auth ─────────────
    const { data: existingUsers, error: listError } =
      await supabaseAdmin.auth.admin.listUsers({
        filter: `email = "${email}"`,
      });

    if (listError) {
      console.error("Error listing users:", listError);
      return new Response(
        JSON.stringify({ error: `Failed to check existing users: ${listError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
      const siteUrl = Deno.env.get("SITE_URL") || "https://atlasmvp.freebuff.app";
      const { data: inviteData, error: inviteError } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          data: {
            full_name: name || email.split("@")[0],
          },
          redirectTo: `${siteUrl}/auth`,
        });

      if (inviteError) {
        console.error("Error inviting user:", inviteError);
        return new Response(
          JSON.stringify({
            error: `Failed to create/invite user: ${inviteError.message}`,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      authUserId = inviteData?.id ?? "";
      action = "new_user_invited";

      if (!authUserId) {
        return new Response(
          JSON.stringify({ error: "User creation succeeded but no ID returned" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ── 8. Provision the Atlas profile via RPC ───────────────────────────
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
      // The profile will be created by the handle_new_user trigger on next login,
      // or can be manually provisioned.
      return new Response(
        JSON.stringify({
          ok: true,
          user_id: authUserId,
          action: action,
          warning: `Auth user created but profile provisioning had an issue: ${rpcError.message}. The user's profile will be created on first login.`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 9. Return success ────────────────────────────────────────────────
    const message =
      action === "new_user_invited"
        ? `Invitation email sent to ${email}. User will receive a link to set their password and access Atlas.`
        : `Existing user ${email} has been provisioned with role=${role}, status=${status}.`;

    return new Response(
      JSON.stringify({
        ok: true,
        user_id: authUserId,
        action: action,
        message: message,
        invitation_sent: action === "new_user_invited",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({
        error: `Internal error: ${err instanceof Error ? err.message : String(err)}`,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
