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

if (!ANON) { console.error("Missing VITE_SUPABASE_ANON_KEY"); process.exit(2); }

const svcHeaders = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };
const anonHeaders = { apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${ANON}` };

async function q(url, headers, body) {
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, body: t };
}

(async () => {
  // 1. Query profiles with anon key (simulating what the browser does)
  console.log("=== 1. Profiles via ANON key ===");
  const r1 = await fetch(`${URL}/rest/v1/profiles?select=_id,name,email,account_status,platform_role`, { headers: anonHeaders });
  console.log(`Status: ${r1.status}`);
  const profiles = await r1.json();
  if (Array.isArray(profiles)) {
    for (const p of profiles) {
      console.log(`  ${p.name}: account_status=${JSON.stringify(p.account_status)}, platform_role=${JSON.stringify(p.platform_role)}`);
    }
  } else {
    console.log(`  Error: ${JSON.stringify(profiles).slice(0, 300)}`);
  }

  // 2. Simulate what the Clerk auth hook does: call users_current_user as service role
  console.log("\n=== 2. users_current_user (service role) ===");
  const r2 = await q(`${URL}/rest/v1/rpc/users_current_user`, svcHeaders, {});
  console.log(`Status: ${r2.status}`);
  console.log(`  Result: ${r2.body.slice(0, 300)}`);

  // 3. Check if there's a RLS policy that strips columns
  console.log("\n=== 3. Check handle_new_user exists ===");
  const r3 = await q(`${URL}/rest/v1/rpc/handle_new_user`, svcHeaders, {});
  console.log(`Status: ${r3.status}`);
  console.log(`  Result: ${r3.body.slice(0, 200)}`);

  // 4. Check the can_access_atlas function
  console.log("\n=== 4. can_access_atlas (service role - no auth context) ===");
  const r4 = await q(`${URL}/rest/v1/rpc/can_access_atlas`, svcHeaders, {});
  console.log(`Status: ${r4.status}`);
  console.log(`  Result: ${r4.body.slice(0, 200)}`);

  // 5. Check if there's a clerk user for YC Demo
  console.log("\n=== 5. Auth users ===");
  const r5 = await fetch(`${URL}/auth/v1/admin/users`, { headers: svcHeaders });
  const users = await r5.json();
  for (const u of (users.users || [])) {
    console.log(`  UID: ${u.id} | Email: ${u.email} | Provider: ${u.app_metadata?.provider}`);
  }

  // 6. Check the specific Clerk concern: the Clerk auth flow uses users_current_user
  //    which requires auth.uid() to match the profiles._id
  //    If Clerk is used, Clerk provides the JWT which Supabase verifies
  //    The question is: does the Clerk user's UID match profiles._id?
  console.log("\n=== 6. YC Demo profile lookup by UID ===");
  const ycdemoUid = "c7e29b03-81d5-49c3-9504-151aa0dcd510";
  const r6 = await fetch(`${URL}/rest/v1/profiles?select=_id,name,email,account_status,platform_role&id=eq.${ycdemoUid}`, { headers: svcHeaders });
  const ycdemo = await r6.json();
  console.log(`  YC Demo profile by UID: ${JSON.stringify(ycdemo).slice(0, 300)}`);

  // Also check by _id
  const r7 = await fetch(`${URL}/rest/v1/profiles?select=_id,name,email,account_status,platform_role&_id=eq.${ycdemoUid}`, { headers: svcHeaders });
  const ycdemo2 = await r7.json();
  console.log(`  YC Demo profile by _id: ${JSON.stringify(ycdemo2).slice(0, 300)}`);

  // 7. Check the Clerk auth user
  console.log("\n=== 7. Clerk auth check ===");
  // Check if there's a clerk_user_id field or similar
  const r8 = await fetch(`${URL}/rest/v1/profiles?select=*`, { headers: svcHeaders });
  const allProfiles = await r8.json();
  if (Array.isArray(allProfiles) && allProfiles.length > 0) {
    console.log(`  Profile columns: ${Object.keys(allProfiles[0]).join(', ')}`);
    for (const p of allProfiles) {
      console.log(`  ${p.name}: _id=${p._id}`);
    }
  }

})();
