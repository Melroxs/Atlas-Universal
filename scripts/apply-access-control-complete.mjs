// -----------------------------------------------------------------------
// Apply complete access control architecture
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

if (!SERVICE) { console.error("SUPABASE_SERVICE_ROLE_KEY missing"); process.exit(1); }

const hdrs = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };
const MELISSA_UID = "0e914537-e62b-4982-a49d-3056f0deb2b8";
const YC_DEMO_UID = "c7e29b03-81d5-49c3-9504-151aa0dcd510";

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

async function patch(table, filter, data) {
  const url = `${URL}/rest/v1/${table}?${filter}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { ...hdrs, Prefer: "return=representation" },
    body: JSON.stringify(data),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

// ── Try to create functions via SQL execution ──
// Supabase's PostgREST doesn't support DDL, but we can try the pg endpoint

async function tryExecuteSql(sql) {
  // Method 1: Try the /pg/exec_sql endpoint (some Supabase setups expose this)
  const pgRes = await fetch(`${URL}/pg/exec`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ query: sql }),
  }).catch(() => null);
  
  if (pgRes?.ok) return { ok: true, method: "pg/exec" };
  
  // Method 2: Try via a custom RPC we'll create
  // This won't work if the function doesn't exist yet
  const rpcRes = await fetch(`${URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({ query: sql }),
  }).catch(() => null);
  
  if (rpcRes?.ok) return { ok: true, method: "rpc" };
  
  return { ok: false };
}

console.log("═══════════════════════════════════════════════");
console.log("APPLYING ACCESS CONTROL ARCHITECTURE");
console.log("═══════════════════════════════════════════════");

// ── Step 1: Update profiles via REST (this works!) ──
console.log("\n--- Step 1: Configure user profiles ---");

const melissaResult = await patch("profiles", `_id=eq.${MELISSA_UID}`, {
  account_status: "active",
  platform_role: "super_admin",
});
console.log(`  Melissa: ${melissaResult.ok ? 'SUCCESS' : 'FAILED (' + melissaResult.status + ')'}`);
if (melissaResult.ok && Array.isArray(melissaResult.data)) {
  const m = melissaResult.data[0];
  console.log(`    account_status=${m.account_status} platform_role=${m.platform_role}`);
}

const ycResult = await patch("profiles", `_id=eq.${YC_DEMO_UID}`, {
  account_status: "active",
  platform_role: "user",
});
console.log(`  YC Demo: ${ycResult.ok ? 'SUCCESS' : 'FAILED (' + ycResult.status + ')'}`);
if (ycResult.ok && Array.isArray(ycResult.data)) {
  const y = ycResult.data[0];
  console.log(`    account_status=${y.account_status} platform_role=${y.platform_role}`);
}

// ── Step 2: Try to create functions programmatically ──
console.log("\n--- Step 2: Create authorization functions ---");

const functionsSql = `
-- is_super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE _id = auth.uid() AND platform_role = 'super_admin');
$$;

-- get_platform_role
CREATE OR REPLACE FUNCTION public.get_platform_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT platform_role FROM public.profiles WHERE _id = auth.uid()), 'user');
$$;

-- get_account_status
CREATE OR REPLACE FUNCTION public.get_account_status()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT account_status FROM public.profiles WHERE _id = auth.uid()), 'pending');
$$;

-- is_approved_user
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.memberships m ON m."userId" = p._id
    WHERE p._id = auth.uid() AND p.account_status = 'active' AND m.status = 'active'
  );
$$;

-- can_access_atlas
CREATE OR REPLACE FUNCTION public.can_access_atlas()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.is_super_admin() OR public.is_approved_user();
$$;
`;

const sqlResult = await tryExecuteSql(functionsSql);
if (sqlResult.ok) {
  console.log(`  Functions created via ${sqlResult.method}`);
} else {
  console.log("  Cannot execute SQL via REST API.");
  console.log("  Functions must be created via Supabase Dashboard SQL Editor.");
}

// ── Step 3: Verify what exists ──
console.log("\n--- Step 3: Verify current state ---");

const fns = ["is_super_admin", "get_platform_role", "get_account_status", "is_approved_user", "can_access_atlas"];
for (const fn of fns) {
  const result = await rpc(fn);
  if (result.error) {
    console.log(`  ${fn}(): NOT YET CREATED`);
  } else {
    console.log(`  ${fn}() = ${JSON.stringify(result)}`);
  }
}

// Verify profiles
console.log("\n--- Final Profile State ---");
const profiles = await q("profiles", "_id, name, email, account_status, platform_role");
if (Array.isArray(profiles)) {
  for (const p of profiles) {
    console.log(`  ${p._id.slice(0,8)}... | ${p.name} | ${p.email} | status=${p.account_status} | platform=${p.platform_role}`);
  }
}

console.log("\n═══════════════════════════════════════════════");
console.log("DONE");
console.log("═══════════════════════════════════════════════");
