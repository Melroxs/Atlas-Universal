// ---------------------------------------------------------------------------
// connections-run-due-syncs — background connector sweep.
//
// Browser contract (src/lib/api.ts): `{ ok: boolean }`. The app treats this
// as optional background infrastructure: if it fails, Knowledge and document/
// archive ingestion continue normally.
//
// Production defect this function fixes: the browser preflight for this
// endpoint was hitting a 404 (the function was never deployed), and a 404 is
// not a valid CORS preflight response — so every authenticated page logged
// "Response to preflight request doesn't pass access control check". This
// handler answers OPTIONS with 204 + the shared CORS headers and runs the
// sweep behind real auth + tenant scoping.
//
// Honesty contract: this project does not deploy a connector sync engine
// (connections-sync-google-drive is also absent), so the sweep reports the
// truth — it counts connected connectors, marks nothing, fabricates nothing.
// When a real engine is added, the sync loop plugs in below and the response
// shape stays `{ ok, checked, due, synced }`.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  atlasCorsHeaders,
  atlasJson,
  handleAtlasPreflight,
} from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  const preflight = handleAtlasPreflight(req);
  if (preflight) return preflight;

  const headers = atlasCorsHeaders(req);

  try {
    // Auth is enforced independently of CORS — a browser that is blocked by
    // CORS is not the gate; the JWT is.
    const authorization = req.headers.get("authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return atlasJson({ ok: false, error: "Unauthorized" }, 401, headers);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser(token);
    if (userError || !user) {
      return atlasJson({ ok: false, error: "Unauthorized" }, 401, headers);
    }

    // Tenant scoping: the sweep only ever touches the caller's workspace.
    const { data: memberships } = await admin
      .from("memberships")
      .select("tenantId")
      .eq("userId", user.id)
      .eq("status", "active")
      .limit(1);
    const tenantId = (memberships?.[0]?.tenantId as string | undefined) ?? null;
    if (!tenantId) {
      return atlasJson(
        { ok: false, error: "No active workspace for this user." },
        400,
        headers,
      );
    }

    const { count } = await admin
      .from("connections")
      .select("_id", { count: "exact", head: true })
      .eq("tenantId", tenantId)
      .eq("status", "connected");

    return atlasJson(
      {
        ok: true,
        checked: count ?? 0,
        due: 0,
        synced: 0,
        note:
          "Connector sync engine is not deployed for this project; sweep completed with nothing to run.",
      },
      200,
      headers,
    );
  } catch (e) {
    console.error("[connections-run-due-syncs] sweep failed:", e);
    return atlasJson({ ok: false, error: "Internal error" }, 500, headers);
  }
});
