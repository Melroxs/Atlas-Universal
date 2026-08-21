// ---------------------------------------------------------------------------
// Atlas — Production Authorization Regression Diagnostic
// ---------------------------------------------------------------------------
// Reads .env.local for Supabase credentials (anon key only — no service role).
// Queries the profiles table to check account_status / platform_role values.
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

if (!ANON) {
  console.error("VITE_SUPABASE_ANON_KEY missing from .env.local");
  process.exit(2);
}

// Use service role if available (bypasses RLS for diagnostic purposes)
const KEY = SERVICE || ANON;
const headers = {
  apikey: KEY,
  "Content-Type": "application/json",
  Authorization: `Bearer ${KEY}`,
};

console.log(`Using Supabase: ${URL}`);
console.log(`Using ${SERVICE ? "SERVICE_ROLE" : "ANON"} key\n`);

async function query(table, select, filters = "") {
  const url = `${URL}/rest/v1/${table}?select=${select}${filters ? "&" + filters : ""}`;
  const r = await fetch(url, { headers });
  if (!r.ok) {
    const body = await r.text();
    console.error(`  HTTP ${r.status}: ${body.slice(0, 200)}`);
    return null;
  }
  return r.json();
}

async function rpc(fn, args = {}) {
  const url = `${URL}/rest/v1/rpc/${fn}`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const body = await r.text();
    console.error(`  RPC ${fn} HTTP ${r.status}: ${body.slice(0, 200)}`);
    return null;
  }
  return r.json();
}

(async () => {
  // 1. Check profiles table — do columns exist?
  console.log("=== 1. Profiles table ===");
  const profiles = await query(
    "profiles",
    "_id,name,email,account_status,platform_role",
  );
  if (profiles === null) {
    console.log("  FAILED to query profiles — columns may not exist yet");
    // Try a simpler query to see if the table works at all
    const basic = await query("profiles", "_id,name,email");
    if (basic) {
      console.log(`  Table exists with ${basic.length} rows, but account_status/platform_role columns MISSING`);
      console.log("  Basic profiles:", JSON.stringify(basic, null, 2));
    } else {
      console.log("  CRITICAL: profiles table may not be accessible");
    }
  } else {
    console.log(`  ${profiles.length} profiles found`);
    for (const p of profiles) {
      console.log(`  - ${p.name} (${p.email}): account_status=${JSON.stringify(p.account_status)}, platform_role=${JSON.stringify(p.platform_role)}`);
    }
  }

  // 2. Check specific users by known UIDs
  console.log("\n=== 2. Known accounts ===");
  const melissaUID = "0e914537-e62b-4982-a49d-3056f0deb2b8";
  const ycdemoUID = "c7e29b03-81d5-49c3-9504-151aa0dcd510";

  const melissa = await query("profiles", "_id,name,email,account_status,platform_role", `filter=_id.eq.${melissaUID}`);
  const ycdemo = await query("profiles", "_id,name,email,account_status,platform_role", `filter=_id.eq.${ycdemoUID}`);

  console.log(`  Melissa: ${melissa?.length ? JSON.stringify(melissa[0]) : "NOT FOUND"}`);
  console.log(`  YC Demo: ${ycdemo?.length ? JSON.stringify(ycdemo[0]) : "NOT FOUND"}`);

  // 3. Check if handle_new_user trigger exists
  console.log("\n=== 3. Access control functions ===");
  const funcs = ["is_super_admin", "get_platform_role", "get_account_status", "can_access_atlas", "handle_new_user"];
  for (const fn of funcs) {
    try {
      const url = `${URL}/rest/v1/rpc/${fn}`;
      const r = await fetch(url, { method: "POST", headers, body: "{}" });
      if (r.status === 404) {
        console.log(`  ${fn}: DOES NOT EXIST (404)`);
      } else if (r.status === 400) {
        // Function exists but wrong params
        const body = await r.text();
        console.log(`  ${fn}: EXISTS but wrong params (${r.status})`);
      } else {
        const body = await r.text();
        console.log(`  ${fn}: EXISTS (${r.status}) → ${body.slice(0, 100)}`);
      }
    } catch (e) {
      console.log(`  ${fn}: ERROR ${e.message}`);
    }
  }

  // 4. Check the triggers on auth.users
  console.log("\n=== 4. Summary ===");
  const issues = [];
  if (profiles) {
    for (const p of profiles) {
      if (!p.account_status) issues.push(`${p.name}: account_status is NULL/missing`);
      if (p.account_status === "pending") issues.push(`${p.name}: account_status is still 'pending'`);
      if (p.name === "Melissa October" && p.platform_role !== "super_admin") issues.push(`Melissa: platform_role is '${p.platform_role}', expected 'super_admin'`);
    }
  }
  if (issues.length === 0) {
    console.log("  No issues found in profile data");
  } else {
    console.log("  ISSUES FOUND:");
    for (const i of issues) console.log(`  ⚠️  ${i}`);
  }
})();
