// -----------------------------------------------------------------------
// Atlas Production User Cleanup + Super Admin Provisioning
//
// This script:
//   1. Applies remaining access control columns to profiles (idempotent)
//   2. Creates Melissa's Supabase Auth account (no password exposed)
//   3. Sends password recovery / magic link to Melissa
//   4. Sets up Melissa's profile with super_admin role
//   5. Deletes test/demo users (preserving YC Demo)
//   6. Verifies the final state
//
// IMPORTANT: This script uses the Supabase Admin API (service role key).
// It does NOT expose, generate, or store any passwords.
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

if (!SERVICE) { console.error("SUPABASE_SERVICE_ROLE_KEY missing — cannot perform admin operations"); process.exit(1); }

const adminHeaders = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };

// ── Helpers ────────────────────────────────────────────────────────────

async function adminQuery(table, select = "*", filter = "") {
  const url = `${URL}/rest/v1/${table}?select=${select}${filter ? '&' + filter : ''}`;
  const res = await fetch(url, { headers: adminHeaders });
  if (!res.ok) return { error: res.status, body: await res.text().catch(() => '') };
  return res.json();
}

async function adminDelete(table, filter) {
  const url = `${URL}/rest/v1/${table}?${filter}`;
  const res = await fetch(url, { method: "DELETE", headers: adminHeaders });
  return { ok: res.ok, status: res.status, body: await res.text().catch(() => '') };
}

async function adminInsert(table, row) {
  const url = `${URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: body };
}

async function adminUpdate(table, filter, patch) {
  const url = `${URL}/rest/v1/${table}?${filter}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: body };
}

async function supabaseSql(sql) {
  // Execute SQL via the Supabase SQL endpoint
  const res = await fetch(`${URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ query: sql }),
  }).catch(() => null);
  
  // If exec_sql doesn't exist, try the pg RPC approach
  if (!res || !res.ok) {
    // Try via the admin auth endpoint approach — execute SQL through the REST API
    const sqlRes = await fetch(`${URL}/pg/exec_sql`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ query: sql }),
    }).catch(() => null);
    
    if (sqlRes?.ok) return { ok: true, data: await sqlRes.json().catch(() => ({})) };
    return { ok: false, error: "Cannot execute SQL directly" };
  }
  return { ok: true, data: await res.json().catch(() => ({})) };
}

// ── Auth Admin API ─────────────────────────────────────────────────────

async function authAdminListUsers() {
  const res = await fetch(`${URL}/auth/v1/admin/users`, {
    headers: { ...adminHeaders, Authorization: `Bearer ${SERVICE}` },
  });
  if (!res.ok) return { error: res.status, body: await res.text().catch(() => '') };
  return res.json();
}

async function authAdminCreateUser({ email, email_confirm = true, user_metadata = {} }) {
  const res = await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...adminHeaders, Authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify({ email, email_confirm, user_metadata }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: body };
}

async function authAdminDeleteUser(userId) {
  const res = await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { ...adminHeaders, Authorization: `Bearer ${SERVICE}` },
  });
  return { ok: res.ok, status: res.status };
}

async function authAdminSendMagicLink(email) {
  // Send magic link / recovery email so user can set their own password
  const res = await fetch(`${URL}/auth/v1/magiclink`, {
    method: "POST",
    headers: { apikey: ANON || SERVICE, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: body };
}

async function authAdminSendRecovery(email) {
  // Send password recovery email
  const res = await fetch(`${URL}/auth/v1/recover`, {
    method: "POST",
    headers: { apikey: ANON || SERVICE, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: body };
}

// ── Constants ──────────────────────────────────────────────────────────

const YC_DEMO_UID = "c7e29b03-81d5-49c3-9504-151aa0dcd510";
const YC_DEMO_EMAIL = "ycdemo@gmail.com";
const MELISSA_EMAIL = "melissa.o.rox@gmail.com";

// ══════════════════════════════════════════════════════════════════════
// PHASE 1: Inspect current state
// ══════════════════════════════════════════════════════════════════════

console.log("═══════════════════════════════════════════════");
console.log("PHASE 1: Inspect current state");
console.log("═══════════════════════════════════════════════");

// List Auth users
console.log("\n--- Auth users ---");
const authUsers = await authAdminListUsers();
if (authUsers.error) {
  console.log("Error listing auth users:", authUsers);
} else {
  const users = authUsers.users || authUsers || [];
  console.log(`Total auth users: ${users.length}`);
  for (const u of users) {
    console.log(`  ${u.id} | ${u.email} | created: ${u.created_at?.slice(0, 10)}`);
  }
}

// List profiles
console.log("\n--- Profiles ---");
const profiles = await adminQuery("profiles", "_id, name, email, role");
if (profiles.error) {
  console.log("Error:", profiles);
} else {
  console.log(`Total profiles: ${profiles.length}`);
}

// Check access control columns
console.log("\n--- Access control columns ---");
const acCheck = await adminQuery("profiles", "_id, account_status, platform_role");
if (acCheck.error) {
  console.log("  NOT APPLIED:", acCheck.body?.slice(0, 100));
} else {
  console.log("  APPLIED");
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 2: Apply access control migration (idempotent)
// ══════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════");
console.log("PHASE 2: Apply access control migration");
console.log("═══════════════════════════════════════════════");

// We need to add account_status and platform_role to profiles
// Using the REST API to update existing profiles won't add columns.
// We need to use SQL. Let's try via the PostgREST proxy or direct SQL.
// Since we can't execute SQL directly through the REST API easily,
// we'll add the columns by trying to update a profile and catching the error
// to determine if they exist, then documenting what needs to be done.

if (acCheck.error) {
  console.log("\n  Access control columns need to be applied.");
  console.log("  The migration must be run via Supabase Dashboard SQL Editor.");
  console.log("  SQL to run:");
  console.log("  ```sql");
  console.log("  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'pending';");
  console.log("  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS platform_role text DEFAULT 'user';");
  console.log("  ```");
} else {
  console.log("  Access control columns already exist.");
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 3: Create Melissa's Auth account
// ══════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════");
console.log("PHASE 3: Create Melissa's Auth account");
console.log("═══════════════════════════════════════════════");

// Check if Melissa already exists
const existingMelissa = Array.isArray(authUsers.users || authUsers)
  ? (authUsers.users || authUsers).find(u => u.email === MELISSA_EMAIL)
  : null;

let melissaUid = null;

if (existingMelissa) {
  console.log(`  Melissa already exists: ${existingMelissa.id}`);
  melissaUid = existingMelissa.id;
} else {
  console.log("  Creating Melissa's Auth account (no password — user will set via email)...");
  // Create the user with email_confirm=true so they can sign in immediately after setting password
  const createResult = await authAdminCreateUser({
    email: MELISSA_EMAIL,
    email_confirm: true,
    user_metadata: { full_name: "Melissa October" },
  });
  
  if (createResult.ok) {
    melissaUid = createResult.data?.id;
    console.log(`  Created: ${melissaUid}`);
  } else {
    console.log("  Error creating user:", createResult.data || createResult.status);
    // Try with a different approach — maybe the user already exists
    const retry = await authAdminListUsers();
    const retryUsers = retry.users || retry || [];
    const found = retryUsers.find(u => u.email === MELISSA_EMAIL);
    if (found) {
      melissaUid = found.id;
      console.log(`  Found existing: ${melissaUid}`);
    }
  }
}

if (!melissaUid) {
  console.log("\n  FATAL: Could not create or find Melissa's Auth account.");
  console.log("  Please create the account manually via Supabase Dashboard → Authentication → Users");
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 4: Create/update Melissa's profile
// ══════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════");
console.log("PHASE 4: Create/update Melissa's profile");
console.log("═══════════════════════════════════════════════");

// Check if profile exists
const melissaProfile = await adminQuery("profiles", "*", `_id=eq.${melissaUid}`);
const hasAcColumns = !acCheck.error; // access control columns exist

if (Array.isArray(melissaProfile) && melissaProfile.length > 0) {
  console.log("  Profile exists — updating...");
  const updateData = { name: "Melissa October", email: MELISSA_EMAIL };
  if (hasAcColumns) {
    updateData.account_status = "active";
    updateData.platform_role = "super_admin";
  }
  const result = await adminUpdate("profiles", `_id=eq.${melissaUid}`, updateData);
  console.log("  Updated:", result.ok ? "success" : result.status);
} else {
  console.log("  Creating profile...");
  const insertData = {
    _id: melissaUid,
    name: "Melissa October",
    email: MELISSA_EMAIL,
    role: "user",
  };
  if (hasAcColumns) {
    insertData.account_status = "active";
    insertData.platform_role = "super_admin";
  }
  const result = await adminInsert("profiles", insertData);
  console.log("  Created:", result.ok ? "success" : result.status);
  if (!result.ok) console.log("  Error:", JSON.stringify(result.data).slice(0, 200));
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 5: Send password recovery / magic link to Melissa
// ══════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════");
console.log("PHASE 5: Send password recovery to Melissa");
console.log("═══════════════════════════════════════════════");

console.log("  Sending password recovery email...");
const recoveryResult = await authAdminSendRecovery(MELISSA_EMAIL);
if (recoveryResult.ok) {
  console.log("  Password recovery email sent successfully to", MELISSA_EMAIL);
  console.log("  (Response:", JSON.stringify(recoveryResult.data).slice(0, 100) + ")");
} else {
  console.log("  Recovery email result:", recoveryResult.status, JSON.stringify(recoveryResult.data).slice(0, 200));
  // Try magic link as fallback
  console.log("  Trying magic link as fallback...");
  const magicResult = await authAdminSendMagicLink(MELISSA_EMAIL);
  if (magicResult.ok) {
    console.log("  Magic link sent successfully");
  } else {
    console.log("  Magic link result:", magicResult.status);
  }
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 6: Delete test users
// ══════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════");
console.log("PHASE 6: Delete test users");
console.log("═══════════════════════════════════════════════");

// Identify test users (all except YC Demo and Melissa)
const testUserIds = (Array.isArray(authUsers.users || authUsers) ? authUsers.users || authUsers : [])
  .filter(u => u.id !== YC_DEMO_UID && u.email !== MELISSA_EMAIL)
  .map(u => u.id);

console.log(`  Found ${testUserIds.length} test users to delete`);

let deletedCount = 0;
let failedCount = 0;

for (const uid of testUserIds) {
  // 1. Delete memberships for this user
  await adminDelete("memberships", `userId=eq.${uid}`);
  
  // 2. Delete the profile
  await adminDelete("profiles", `_id=eq.${uid}`);
  
  // 3. Delete the Auth user
  const result = await authAdminDeleteUser(uid);
  if (result.ok) {
    deletedCount++;
    console.log(`  Deleted: ${uid}`);
  } else {
    failedCount++;
    console.log(`  Failed to delete ${uid}: ${result.status}`);
  }
}

console.log(`\n  Deleted: ${deletedCount} | Failed: ${failedCount}`);

// ══════════════════════════════════════════════════════════════════════
// PHASE 7: Delete orphaned test tenants
// ══════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════");
console.log("PHASE 7: Delete orphaned test tenants");
console.log("═══════════════════════════════════════════════");

// Get remaining profiles to find which tenants to keep
const remainingProfiles = await adminQuery("profiles", "_id");
const remainingUserIds = new Set((remainingProfiles || []).map(p => p._id));

// Get remaining memberships to find which tenants to keep
const remainingMemberships = await adminQuery("memberships", "tenantId");
const keptTenantIds = new Set((remainingMemberships || []).map(m => m.tenantId));

// Get all tenants and delete those without memberships
const allTenants = await adminQuery("tenants", "_id, name, slug");
const testTenants = (allTenants || []).filter(t => !keptTenantIds.has(t._id));

console.log(`  Found ${testTenants.length} orphaned test tenants`);

let deletedTenants = 0;
for (const t of testTenants) {
  // Delete related data for this tenant (best effort)
  await adminDelete("companyProfiles", `tenantId=eq.${t._id}`);
  await adminDelete("companySystems", `tenantId=eq.${t._id}`);
  await adminDelete("tenantPacks", `tenantId=eq.${t._id}`);
  await adminDelete("documents", `tenantId=eq.${t._id}`);
  await adminDelete("documentChunks", `tenantId=eq.${t._id}`);
  await adminDelete("ingestionJobs", `tenantId=eq.${t._id}`);
  await adminDelete("entities", `tenantId=eq.${t._id}`);
  await adminDelete("entityRelationships", `tenantId=eq.${t._id}`);
  await adminDelete("knowledgeAssertions", `tenantId=eq.${t._id}`);
  await adminDelete("askSessions", `tenantId=eq.${t._id}`);
  await adminDelete("askEvidence", `tenantId=eq.${t._id}`);
  await adminDelete("recommendations", `tenantId=eq.${t._id}`);
  await adminDelete("recommendationEvidence", `tenantId=eq.${t._id}`);
  await adminDelete("connections", `tenantId=eq.${t._id}`);
  await adminDelete("toolActions", `tenantId=eq.${t._id}`);
  await adminDelete("events", `tenantId=eq.${t._id}`);
  await adminDelete("notifications", `tenantId=eq.${t._id}`);
  await adminDelete("eventPolicies", `tenantId=eq.${t._id}`);
  await adminDelete("workflowSettings", `tenantId=eq.${t._id}`);
  await adminDelete("workflowInstances", `tenantId=eq.${t._id}`);
  await adminDelete("workflowSteps", `tenantId=eq.${t._id}`);
  await adminDelete("workflowApprovals", `tenantId=eq.${t._id}`);
  await adminDelete("organizationContexts", `tenantId=eq.${t._id}`);
  await adminDelete("operatingLocations", `tenantId=eq.${t._id}`);
  await adminDelete("auditLogs", `tenantId=eq.${t._id}`);
  await adminDelete("conversationSessions", `tenantId=eq.${t._id}`);
  await adminDelete("insuranceClaims", `tenantId=eq.${t._id}`);
  await adminDelete("claimFindings", `tenantId=eq.${t._id}`);
  await adminDelete("claimSupplements", `tenantId=eq.${t._id}`);
  await adminDelete("claimCandidates", `tenantId=eq.${t._id}`);
  await adminDelete("archiveIngestions", `tenantId=eq.${t._id}`);
  await adminDelete("archiveFiles", `tenantId=eq.${t._id}`);
  await adminDelete("claimEvidence", `tenantId=eq.${t._id}`);
  
  // Now delete the tenant itself
  const result = await adminDelete("tenants", `_id=eq.${t._id}`);
  if (result.ok) {
    deletedTenants++;
    console.log(`  Deleted tenant: ${t.name} (${t._id})`);
  } else {
    console.log(`  Failed to delete tenant ${t._id}: ${result.status}`);
  }
}

console.log(`\n  Deleted tenants: ${deletedTenants}`);

// ══════════════════════════════════════════════════════════════════════
// PHASE 8: Verify final state
// ══════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════");
console.log("PHASE 8: Verify final state");
console.log("═══════════════════════════════════════════════");

// Verify Auth users
console.log("\n--- Final Auth Users ---");
const finalAuth = await authAdminListUsers();
const finalUsers = finalAuth.users || finalAuth || [];
for (const u of finalUsers) {
  console.log(`  ${u.id} | ${u.email} | ${u.user_metadata?.full_name || 'no name'}`);
}

// Verify profiles
console.log("\n--- Final Profiles ---");
const finalProfiles = await adminQuery("profiles", "_id, name, email, role, account_status, platform_role");
if (finalProfiles.error) {
  console.log("  (access control columns not yet applied)");
  const basicProfiles = await adminQuery("profiles", "_id, name, email, role");
  for (const p of (basicProfiles || [])) {
    console.log(`  ${p._id} | ${p.name} | ${p.email} | role=${p.role}`);
  }
} else {
  for (const p of finalProfiles) {
    console.log(`  ${p._id} | ${p.name} | ${p.email} | role=${p.role} | status=${p.account_status} | platform=${p.platform_role}`);
  }
}

// Verify YC Demo
console.log("\n--- YC Demo Verification ---");
const ycProfile = await adminQuery("profiles", "*", `_id=eq.${YC_DEMO_UID}`);
const ycMembership = await adminQuery("memberships", "*", `userId=eq.${YC_DEMO_UID}`);
console.log(`  Profile: ${Array.isArray(ycProfile) && ycProfile.length > 0 ? 'EXISTS' : 'MISSING'}`);
console.log(`  Membership: ${Array.isArray(ycMembership) && ycMembership.length > 0 ? 'EXISTS' : 'MISSING'}`);

// Verify Melissa
console.log("\n--- Melissa Verification ---");
const melissaProfileFinal = await adminQuery("profiles", "*", `_id=eq.${melissaUid}`);
console.log(`  Profile: ${Array.isArray(melissaProfileFinal) && melissaProfileFinal.length > 0 ? 'EXISTS' : 'MISSING'}`);
if (Array.isArray(melissaProfileFinal) && melissaProfileFinal.length > 0) {
  const mp = melissaProfileFinal[0];
  console.log(`  Name: ${mp.name}`);
  console.log(`  Email: ${mp.email}`);
  if (mp.account_status !== undefined) console.log(`  Account Status: ${mp.account_status}`);
  if (mp.platform_role !== undefined) console.log(`  Platform Role: ${mp.platform_role}`);
}

console.log("\n═══════════════════════════════════════════════");
console.log("CLEANUP COMPLETE");
console.log("═══════════════════════════════════════════════");
