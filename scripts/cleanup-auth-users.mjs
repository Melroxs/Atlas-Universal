// -----------------------------------------------------------------------
// Delete test Auth users with detailed error reporting
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

const YC_DEMO_UID = "c7e29b03-81d5-49c3-9504-151aa0dcd510";
const MELISSA_EMAIL = "melissa.o.rox@gmail.com";

const adminHeaders = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };

// ── Step 1: List all auth users ──
console.log("=== Step 1: List Auth users ===");
const authRes = await fetch(`${URL}/auth/v1/admin/users`, { headers: adminHeaders });
const authData = await authRes.json();
const users = authData.users || [];

// Find Melissa's UID
const melissaUser = users.find(u => u.email === MELISSA_EMAIL);
const melissaUid = melissaUser?.id;
console.log(`Melissa UID: ${melissaUid}`);
console.log(`YC Demo UID: ${YC_DEMO_UID}`);
console.log(`Total Auth users: ${users.length}`);

// ── Step 2: Delete test profiles (before Auth) ──
console.log("\n=== Step 2: Delete test profiles ===");
const testUsers = users.filter(u => u.id !== YC_DEMO_UID && u.email !== MELISSA_EMAIL);
console.log(`Test users to delete: ${testUsers.length}`);

// Delete memberships first
for (const u of testUsers) {
  await fetch(`${URL}/rest/v1/memberships?userId=eq.${u.id}`, {
    method: "DELETE", headers: adminHeaders,
  });
}

// Delete profiles
for (const u of testUsers) {
  await fetch(`${URL}/rest/v1/profiles?_id=eq.${u.id}`, {
    method: "DELETE", headers: adminHeaders,
  });
}

console.log("  Profiles and memberships cleaned.");

// ── Step 3: Delete test Auth users ──
console.log("\n=== Step 3: Delete Auth users ===");
let deleted = 0;
let failed = 0;

for (const u of testUsers) {
  const res = await fetch(`${URL}/auth/v1/admin/users/${u.id}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  
  if (res.ok) {
    deleted++;
    console.log(`  ✓ ${u.email}`);
  } else {
    const body = await res.text().catch(() => "");
    failed++;
    console.log(`  ✗ ${u.email} — HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

console.log(`\nDeleted: ${deleted} | Failed: ${failed}`);

// ── Step 4: Verify remaining users ──
console.log("\n=== Step 4: Verify remaining users ===");
const finalRes = await fetch(`${URL}/auth/v1/admin/users`, { headers: adminHeaders });
const finalData = await finalRes.json();
const finalUsers = finalData.users || [];

console.log(`Remaining Auth users: ${finalUsers.length}`);
for (const u of finalUsers) {
  console.log(`  ${u.id} | ${u.email} | ${u.user_metadata?.full_name || 'no name'}`);
}

// ── Step 5: Verify remaining profiles ──
console.log("\n=== Step 5: Verify remaining profiles ===");
const profRes = await fetch(`${URL}/rest/v1/profiles?select=_id,name,email`, { headers: adminHeaders });
const profData = await profRes.json();
console.log(`Remaining profiles: ${profData.length}`);
for (const p of profData) {
  console.log(`  ${p._id} | ${p.name} | ${p.email}`);
}

console.log("\n=== DONE ===");
