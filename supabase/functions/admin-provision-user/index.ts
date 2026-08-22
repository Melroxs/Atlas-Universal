// supabase/functions/admin-provision-user/index.ts
//
// Server-side user provisioning using the Supabase Auth Admin API.
// This function uses the service-role key (stored as a Supabase secret)
// to create/invite Supabase Auth users and provision their Atlas profiles.
//
// The service-role key is NEVER exposed to the browser — it lives only
// in this Edge Function's environment via `supabase secrets set`.
//
// Deploy:
//   supabase functions deploy admin-provision-user
//   supabase secrets set SERVICE_ROLE_KEY=<your-service-role-key>

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
    // Create a Supabase client with the caller's JWT (for auth verification)
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
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
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

    // Parse the request body
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

    // Create a service-role client for Auth Admin operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SERVICE_ROLE_KEY") ?? "",
    );

    // Step 1: Check if the user already exists in Supabase Auth
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
      // Step 2: Create a new Supabase Auth user with invitation
      // Using inviteUserByEmail which sends a magic link / invitation email
      const { data: inviteData, error: inviteError } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          data: {
            full_name: name || email.split("@")[0],
          },
          redirectTo: `${Deno.env.get("SITE_URL") || "https://atlasmvp.freebuff.app"}/auth`,
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

    // Step 3: Provision the Atlas profile via RPC
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

    // Step 4: Return success
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
