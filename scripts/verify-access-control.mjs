// -----------------------------------------------------------------------
// Read-only verification of live access control state
// -----------------------------------------------------------------------
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
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = env.VITE_SUPABASE_ANON_KEY;

if (!SERVICE) { console.error("SUPABASE_SERVICE_ROLE_KEY missing"); process.exit(1); }

const hdrs = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };

async function q(table, select = "*", filter = "") {
  const url = `${URL}/rest/v1/${table}?select=${select}${filter ? '&' + filter : ''}`;
  const res = await fetch(url, { headers: hdrs });
  if (!res.ok) return { error: res.status, body: await res.text().catch(() => '') };
  return res.json();
}

async function rpc(fn, params = {}) {
  const url = `${URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, { method: "POST", headers: hdrs, body: JSON.stringify(params) });
  if (!res.ok) return { error: res.status, body: await res.text().catch(() => '') };
  return res.json();
}

console.log("═══════════════════════════════════════════════");
console.log("LIVE ACCESS CONTROL VERIFICATION");
console.log("═══════════════════════════════════════════════");

// ── 1. Profiles with access control columns ──
console.log("\n--- Profiles (with access control columns) ---");
const profiles = await q("profiles", "_id, name, email, account_status, platform_role");
if (profiles.error) {
  console.log("  ERROR:", profiles.body?.slice(0, 200));
} else {
  console.log(`  Total: ${profiles.length}`);
  for (const p of profiles) {
    console.log(`  ${p._id.slice(0,8)}... | ${p.name} | ${p.email} | status=${p.account_status} | platform=${p.platform_role}`);
  }
}

// ── 2. Test authorization functions ──
console.log("\n--- Authorization Functions ---");
const fns = ["is_super_admin", "get_platform_role", "get_account_status", "is_approved_user", "can_access_atlas"];
for (const fn of fns) {
  const result = await rpc(fn);
  if (result.error) {
    console.log(`  ${fn}(): MISSING or ERROR (${result.status}: ${String(result.body).slice(0, 100)})`);
  } else {
    console.log(`  ${fn}() = ${JSON.stringify(result)}`);
  }
}

// ── 3. Check handle_new_user trigger ──
console.log("\n--- handle_new_user Trigger ---");
const triggerCheck = await q("information_schema.triggers", "trigger_name, event_manipulation, action_statement", `trigger_name=eq.on_auth_user_created`);
if (triggerCheck.error) {
  console.log("  Cannot query information_schema (expected via PostgREST)");
  console.log("  Trigger existence must be verified via SQL Editor");
} else {
  console.log(`  ${JSON.stringify(triggerCheck)}`);
}

// ── 4. Remaining tenants and memberships ──
console.log("\n--- Remaining Data ---");
const tenants = await q("tenants", "_id, name");
const memberships = await q("memberships", "userId, tenantId, role, status");
console.log(`  Tenants: ${Array.isArray(tenants) ? tenants.length : 0}`);
console.log(`  Memberships: ${Array.isArray(memberships) ? memberships.length : 0}`);
if (Array.isArray(tenants)) {
  for (const t of tenants) console.log(`    ${t._id.slice(0,8)}... | ${t.name}`);
}

console.log("\n═══════════════════════════════════════════════");
console.log("VERIFICATION COMPLETE");
console.log("═══════════════════════════════════════════════");
