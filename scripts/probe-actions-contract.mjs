// ---------------------------------------------------------------------------
// LIVE probe: Actions-page RPC contracts against the deployed Supabase project.
//
//   node scripts/probe-actions-contract.mjs
//
// Signs up a throwaway user + workspace, then calls every RPC the Actions page
// uses the way the browser calls it (p_<lowercased-camel> via PostgREST):
//   archive_stats      → exists in schema (probe its real shape)
//   tools_list         → known 404 (documented pre-existing gap)
//   tools_list_actions → exists (probe its real shape)
// Prints HTTP status + JSON shape summary (keys only, never contents), then
// cleans up (user, memberships, tenant). Prints no secrets.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";

function parseEnvFile(file) {
  const out = {};
  try {
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  } catch {}
  return out;
}

const env = parseEnvFile(".env.local");
const URL = env.VITE_SUPABASE_URL ?? "https://ibxvzxblyhzwokljkslt.supabase.co";
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON || !SERVICE) {
  console.error("VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(2);
}

const auth = (t) => ({ apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${t}` });
const svc = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };

let userId = null;
let tenantId = null;

async function del(table, filter) {
  try {
    await fetch(`${URL}/rest/v1/${table}?${filter}`, { method: "DELETE", headers: svc });
  } catch {}
}

async function cleanup() {
  try {
    if (tenantId) {
      await del("memberships", `tenantId=eq.${tenantId}`);
      await del("tenants", `_id=eq.${tenantId}`);
    }
    if (userId) {
      await fetch(`${URL}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svc }).catch(() => {});
    }
    console.log("cleanup: probe tenant + user removed");
  } catch (e) {
    console.error("cleanup error:", String(e).slice(0, 200));
  }
}

/** Summarize a JSON value's shape without printing contents. */
function shape(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `Array(${v.length})[${shape(v[0], depth + 1)}]`;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v);
    return `{ ${keys.slice(0, 12).join(", ")}${keys.length > 12 ? ", …" : ""} }`;
  }
  return typeof v;
}

async function rpc(token, name, body = {}) {
  const res = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify(body),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {}
  return { status: res.status, body: parsed };
}

try {
  // 1. Throwaway user + workspace.
  const su = await fetch(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `actions.${Date.now()}@example.com`, password: "ActionsProbe!42", data: { full_name: "Actions Probe" } }),
  });
  const sb = await su.json().catch(() => ({}));
  const token = sb.access_token;
  userId = sb.user?.id ?? null;
  if (!token) {
    console.log(`FAIL signup HTTP ${su.status} — ${JSON.stringify(sb).slice(0, 160)}`);
    process.exit(1);
  }
  const tt = await rpc(token, "tenants_create_tenant", { p_name: "Actions Probe Co" });
  tenantId = tt.body?.tenantId ?? tt.body?.tenant_id ?? tt.body?.id ?? null;
  if (!tenantId) {
    const mt = await fetch(`${URL}/rest/v1/memberships?select=tenantId&limit=1`, { headers: auth(token) }).catch(() => null);
    const mb = mt ? await mt.json().catch(() => []) : [];
    tenantId = Array.isArray(mb) ? mb[0]?.tenantId ?? null : null;
  }
  console.log(`probe user created, tenant: ${tenantId ? "yes" : "NO"}\n`);

  // 2. archive_stats — how Knowledge/Actions consume it.
  const st = await rpc(token, "archive_stats");
  console.log(`archive_stats → HTTP ${st.status}; shape: ${shape(st.body)}`);
  if (st.body && typeof st.body === "object" && !Array.isArray(st.body)) {
    for (const k of ["total", "filesIngested", "potentialClaims", "failed", "processing"]) {
      if (k in st.body) console.log(`  archive_stats.${k} = ${shape(st.body[k])}`);
    }
  }

  // 3. tools_list — the 404 from the production console.
  const tl = await rpc(token, "tools_list");
  console.log(`tools_list → HTTP ${tl.status}${tl.status === 404 ? " (function absent from deployed schema)" : ""}; body: ${JSON.stringify(tl.body).slice(0, 120)}`);

  // 4. tools_list_actions — with and without p_limit.
  const ta = await rpc(token, "tools_list_actions", {});
  console.log(`tools_list_actions {} → HTTP ${ta.status}; shape: ${shape(ta.body)}`);
  const ta2 = await rpc(token, "tools_list_actions", { p_limit: 5 });
  console.log(`tools_list_actions {p_limit:5} → HTTP ${ta2.status}; shape: ${shape(ta2.body)}`);

  console.log("\nRESULT: see shapes above. Exit code 0 = diagnostic complete.");
} finally {
  await cleanup();
}
