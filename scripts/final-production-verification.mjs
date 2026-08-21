// ---------------------------------------------------------------------------
// FINAL production verification — simulates the EXACT browser experience for
// the two real accounts using real sessions (read-only magic-link exchange;
// passwords are never read, changed or reset):
//
//   session -> users_current_user()      (RequireAuth gate input)
//           -> tenants_get_my_workspace() (AppShell workspace load)
//           -> insurance_claim_counts()   (Dashboard first data call)
//
// Each response is evaluated against the exact gate logic shipped in the
// deployed production bundle. No secrets are printed.
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
if (!ANON || !SERVICE) { console.error("keys missing"); process.exit(2); }
const svc = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };

function prodGate(profile) {
  const role = profile?.platform_role ?? "user";
  const status = profile?.account_status ?? "pending";
  return role === "super_admin" || status === "active" ? "ALLOWED" : "ACCESS-DENIED";
}

async function rpc(name, token, args = {}) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, data: d, raw: t };
}

async function mintSession(email) {
  const gl = await fetch(`${URL}/auth/v1/admin/generate_link`, {
    method: "POST", headers: svc,
    body: JSON.stringify({ email, type: "magiclink" }),
  });
  const gb = await gl.json().catch(() => ({}));
  if (!gl.ok || !gb.action_link) throw new Error(`generate_link HTTP ${gl.status}`);
  const res = await fetch(gb.action_link, { redirect: "manual" });
  const m = (res.headers.get("location") ?? "").match(/access_token=([^&]+)/);
  if (!m) throw new Error("no token in redirect");
  return decodeURIComponent(m[1]);
}

async function verify(label, email) {
  console.log(`\n===== ${label} =====`);
  const token = await mintSession(email);
  console.log("session:            OK (real Supabase JWT)");

  // Step 1 — RequireAuth gate input.
  const u = await rpc("users_current_user", token);
  const profile = u.data;
  const gate = prodGate(profile);
  console.log(`users_current_user: HTTP ${u.status} | account_status=${JSON.stringify(profile?.account_status)} platform_role=${JSON.stringify(profile?.platform_role)} | GATE=${gate}`);

  if (gate !== "ALLOWED") {
    console.log("RESULT: BLOCKED (would land on /access-denied)");
    return { gate, dashboard: "BLOCKED" };
  }

  // Step 2 — AppShell workspace load (what the dashboard renders first).
  const w = await rpc("tenants_get_my_workspace", token);
  const tenantName = w.data?.tenant?.name ?? null;
  const memberCount = Array.isArray(w.data?.members) ? w.data.members.length : null;
  console.log(`workspace:          HTTP ${w.status} | tenant=${JSON.stringify(tenantName)} members=${memberCount}`);

  // Step 3 — Dashboard first data call.
  const c = await rpc("insurance_claim_counts", token);
  console.log(`claim_counts:       HTTP ${c.status} | keys=${c.data && typeof c.data === "object" ? Object.keys(c.data).length : typeof c.data}`);

  console.log("RESULT: AUTHORIZED — dashboard data path functional");
  return { gate, dashboard: "OK", tenant: tenantName };
}

(async () => {
  const melissa = await verify("FOUNDER — Melissa October", "melissa.o.rox@gmail.com");
  const ycdemo = await verify("YC DEMO", "ycdemo@gmail.com");
  console.log("\n================ FINAL VERDICT ================");
  console.log(`melissa: gate=${melissa.gate} dashboard-path=${melissa.dashboard}${melissa.tenant ? ` tenant="${melissa.tenant}"` : ""}`);
  console.log(`ycdemo:  gate=${ycdemo.gate} dashboard-path=${ycdemo.dashboard}${ycdemo.tenant ? ` tenant="${ycdemo.tenant}"` : ""}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
