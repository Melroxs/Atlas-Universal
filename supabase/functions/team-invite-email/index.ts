// supabase/functions/team-invite-email/index.ts
//
// Sends the actual invitation email for the normal-user "Invite Members"
// flow (Settings → Team). The tenants_invite_member RPC creates the pending
// invite row in public.invites; THIS function delivers the email that tells
// the invited person Atlas is waiting for them.
//
// SECURITY MODEL (matches outreach-send / email conventions):
//   - RESEND_API_KEY lives only in Supabase Edge Function secrets — never
//     exposed to the browser, never logged, never returned in errors.
//   - The caller's JWT is verified against Supabase Auth.
//   - Server-side authorization: the caller must be an active member of the
//     tenant that owns a PENDING invite for exactly this email address.
//     A caller cannot send arbitrary invitations to arbitrary addresses —
//     only invites that actually exist in the database for their workspace.
//   - CORS restricted to the explicit Atlas production origins (no wildcard).
//
// Deploy:
//   supabase functions deploy team-invite-email
// Required secrets (already used by outreach-send):
//   RESEND_API_KEY, RESEND_SENDER_EMAIL, RESEND_SENDER_NAME
// Optional:
//   SITE_URL (defaults to https://atlas-ai-os.com) — used as the link target.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const ATLAS_ALLOWED_ORIGINS = [
  "https://atlas-ai-os.com",
  "https://atlasmvp.freebuff.app",
  "https://atlasuniversalos.freebuff.app",
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function fail(message: string, detail?: string) {
  if (detail) console.error(`[team-invite-email] ${message}: ${detail}`);
  return { ok: false, error: message };
}

const RESEND_API = "https://api.resend.com/emails";

serve(async (req: Request) => {
  const corsH = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsH });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsH, "Content-Type": "application/json" },
    });
  }

  try {
    // ── 1. Secrets ────────────────────────────────────────────────────────
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      return respond(corsH, 500, fail(
        "Invitation email service is not configured. Ask your administrator to set up email delivery.",
        "RESEND_API_KEY missing",
      ));
    }
    const senderEmail =
      Deno.env.get("RESEND_SENDER_EMAIL") || "pilot@atlas-ai-os.com";
    const senderName =
      Deno.env.get("RESEND_SENDER_NAME") || "Atlas";
    const siteUrl =
      Deno.env.get("SITE_URL") || "https://atlas-ai-os.com";

    // ── 2. Parse request ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return respond(corsH, 401, fail("Not authenticated"));
    }
    let body: { email?: string; tenantId?: string; inviterName?: string; tenantName?: string };
    try {
      body = await req.json();
    } catch {
      return respond(corsH, 400, fail("Invalid request body"));
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
    if (!email || !email.includes("@")) {
      return respond(corsH, 400, fail("A valid recipient email is required"));
    }
    if (!tenantId) {
      return respond(corsH, 400, fail("Workspace is required"));
    }

    // ── 3. Verify caller identity + authorization ─────────────────────────
    const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (!secretKeysRaw) {
      return respond(corsH, 500, fail("Server configuration error", "SUPABASE_SECRET_KEYS missing"));
    }
    let serviceRoleKey: string;
    try {
      serviceRoleKey = JSON.parse(secretKeysRaw)["default"];
    } catch {
      return respond(corsH, 500, fail("Server configuration error", "bad SUPABASE_SECRET_KEYS"));
    }
    if (!serviceRoleKey) {
      return respond(corsH, 500, fail("Server configuration error", "no default key"));
    }
    const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
    let anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (publishableKeysRaw) {
      try {
        anonKey = JSON.parse(publishableKeysRaw)["default"] ?? anonKey;
      } catch { /* keep fallback */ }
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!anonKey || !supabaseUrl) {
      return respond(corsH, 500, fail("Server configuration error", "missing URL/anon key"));
    }

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Caller must be authenticated
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return respond(corsH, 401, fail("Not authenticated"));
    }
    const callerId = userData.user.id;

    // Caller must be an active manager-or-above member of the tenant
    const { data: membership, error: mErr } = await adminClient
      .from("memberships")
      .select("role, status")
      .eq("userId", callerId)
      .eq("tenantId", tenantId)
      .maybeSingle();
    if (mErr || !membership) {
      return respond(corsH, 403, fail("You are not a member of this workspace"));
    }
    if (membership.status !== "active" || !["owner", "admin", "manager"].includes(membership.role)) {
      return respond(corsH, 403, fail("Only managers and above can resend invitations"));
    }

    // A PENDING invite for this exact email must exist for this tenant —
    // this prevents sending arbitrary emails to arbitrary addresses.
    const { data: invite, error: iErr } = await adminClient
      .from("invites")
      .select("_id, role")
      .eq("tenantId", tenantId)
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();
    if (iErr || !invite) {
      return respond(corsH, 404, fail(
        "No pending invitation exists for this address in this workspace.",
        iErr ? iErr.message : undefined,
      ));
    }

    // ── 4. Resolve display names ──────────────────────────────────────────
    let tenantName = body.tenantName || "your workspace";
    let inviterName = body.inviterName || "";
    try {
      const { data: t } = await adminClient.from("tenants").select("name").eq("_id", tenantId).maybeSingle();
      if (t?.name) tenantName = t.name;
      const { data: p } = await adminClient.from("profiles").select("name").eq("_id", callerId).maybeSingle();
      if (p?.name) inviterName = p.name;
    } catch { /* best-effort naming */ }

    // ── 5. Send via Resend ────────────────────────────────────────────────
    const roleLabel = String(invite.role ?? "member");
    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
        <h2 style="margin:0 0 12px;color:#0f172a;">You've been invited to ${escapeHtml(tenantName)} on Atlas</h2>
        <p style="color:#334155;line-height:1.6;margin:0 0 16px;">
          ${escapeHtml(inviterName || "A teammate")} has invited you to collaborate in
          <strong>${escapeHtml(tenantName)}</strong> as <strong>${escapeHtml(roleLabel)}</strong>.
        </p>
        <p style="color:#334155;line-height:1.6;margin:0 0 24px;">
          Sign in to Atlas (or create your account) using <strong>${escapeHtml(email)}</strong> and this
          workspace will be waiting for you automatically.
        </p>
        <a href="${siteUrl}/auth?returnTo=%2Fdashboard"
           style="display:inline-block;background:#0d9488;color:#ffffff;text-decoration:none;
                  padding:10px 20px;border-radius:8px;font-weight:600;">Open Atlas</a>
        <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
          If you weren't expecting this invitation you can safely ignore this email.
        </p>
      </div>`;

    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${senderName} <${senderEmail}>`,
        to: [email],
        subject: `You've been invited to ${tenantName} on Atlas`,
        html,
      }),
    });

    const resBody = await res.json().catch(() => null);

    if (!res.ok) {
      // Map provider failures honestly — never leak the API key.
      const providerError =
        resBody && typeof resBody === "object" && typeof resBody.message === "string"
          ? resBody.message.slice(0, 200)
          : `HTTP ${res.status}`;
      console.error(`[team-invite-email] Resend rejected: HTTP ${res.status} ${providerError}`);
      const friendly =
        res.status === 401 || res.status === 403
          ? "Email service authentication failed. Contact your administrator."
          : res.status === 422
            ? "The email service rejected this recipient or sender configuration."
            : "The email service could not be reached. Try again shortly.";
      return respond(corsH, 502, { ok: false, error: friendly });
    }

    // Provider accepted the message. Delivery to the inbox is not guaranteed
    // from acceptance alone — report acceptance honestly.
    const messageId = resBody && typeof resBody === "object" ? resBody.id ?? null : null;
    console.info(`[team-invite-email] accepted by provider for ${maskEmail(email)} id=${messageId ?? "?"}`);

    return respond(corsH, 200, {
      ok: true,
      message_id: messageId,
      message: `Invitation email sent to ${email}`,
    });
  } catch (err) {
    return respond(corsH, 500, fail(
      "Unexpected server error while sending the invitation.",
      err instanceof Error ? err.message : String(err),
    ));
  }
});

function respond(corsH: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsH, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** Never log full recipient addresses. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const shown = local.slice(0, Math.min(2, local.length));
  return `${shown}***@${domain}`;
}
