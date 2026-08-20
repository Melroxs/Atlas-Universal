// -----------------------------------------------------------------------
// Read-only diagnostic: inspect the live Supabase Auth + profile state.
// Handles missing columns/tables gracefully.
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
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANON) { console.error("VITE_SUPABASE_ANON_KEY missing"); process.exit(1); }

const hdrs = { apikey: SERVICE || ANON, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE || ANON}` };

async function query(table, select = "*", filter = "") {
  const url = `${URL}/rest/v1/${table}?select=${select}${filter ? '&' + filter : ''}`;
  const res = await fetch(url, { headers: hdrs });
  if (!res.ok) return { error: res.status, body: await res.text().catch(() => '') };
  return res.json();
}

console.log("=== PROFILES (basic columns only) ===");
const profiles = await query("profiles", "_id, name, email, role");
if (profiles.error) {
  console.log("Error:", profiles);
} else {
  console.log(`Total profiles: ${profiles.length}`);
  for (const p of profiles) {
    console.log(`  ${p._id} | ${p.name} | ${p.email} | role=${p.role}`);
  }
}

// Check if access control columns exist
console.log("\n=== CHECKING ACCESS CONTROL COLUMNS ===");
const acCheck = await query("profiles", "_id, account_status, platform_role");
if (acCheck.error) {
  console.log("  access_control columns NOT YET APPLIED:", acCheck.body?.slice(0, 120));
} else {
  console.log("  access_control columns EXIST");
  for (const p of acCheck) {
    console.log(`  ${p._id} | status=${p.account_status} | platform=${p.platform_role}`);
  }
}

console.log("\n=== MEMBERSHIPS ===");
const memberships = await query("memberships", "userId, tenantId, role, status");
if (memberships.error) {
  console.log("Error:", memberships);
} else {
  console.log(`Total memberships: ${memberships.length}`);
  for (const m of memberships) {
    console.log(`  User: ${m.userId} | Tenant: ${m.tenantId} | Role: ${m.role} | Status: ${m.status}`);
  }
}

console.log("\n=== TENANTS ===");
const tenants = await query("tenants", "_id, name, slug, status");
if (tenants.error) {
  console.log("Error:", tenants);
} else {
  console.log(`Total tenants: ${tenants.length}`);
  // Identify YC Demo tenant vs test tenants
  const ycTenant = tenants.find(t => t.name?.includes("NPP") && !t.name?.includes("E2E"));
  const testTenants = tenants.filter(t => 
    t.name?.includes("Probe") || 
    t.name?.includes("E2E") || 
    t.name?.includes("Verify") ||
    t.name?.includes("Evidence Probe") ||
    t.name?.includes("Demo Chain")
  );
  console.log(`  YC Demo tenant: ${ycTenant ? ycTenant._id + ' (' + ycTenant.name + ')' : 'NOT FOUND'}`);
  console.log(`  Test/E2E tenants: ${testTenants.length}`);
  for (const t of testTenants) {
    console.log(`    ${t._id} | ${t.name} | ${t.slug}`);
  }
}

console.log("\n=== PILOT APPLICATIONS TABLE CHECK ===");
const pilotCheck = await query("pilot_applications", "*", "limit=1");
if (pilotCheck.error) {
  console.log("  pilot_applications table:", pilotCheck.body?.slice(0, 120));
} else {
  console.log(`  pilot_applications exists, ${pilotCheck.length} rows`);
}

console.log("\n=== USER PROVISIONS TABLE CHECK ===");
const provCheck = await query("user_provisions", "*", "limit=1");
if (provCheck.error) {
  console.log("  user_provisions table:", provCheck.body?.slice(0, 120));
} else {
  console.log(`  user_provisions exists, ${provCheck.length} rows`);
}

console.log("\n=== AUDIT LOG TABLE CHECK ===");
const auditCheck = await query("atlas_audit_log", "*", "limit=1");
if (auditCheck.error) {
  console.log("  atlas_audit_log table:", auditCheck.body?.slice(0, 120));
} else {
  console.log(`  atlas_audit_log exists, ${auditCheck.length} rows`);
}

console.log("\n=== EMAIL ACCOUNTS ===");
const emailAccts = await query("email_accounts", "id, user_id, tenant_id, email_address, connection_status");
if (emailAccts.error) {
  console.log("  email_accounts:", emailAccts.body?.slice(0, 120));
} else {
  console.log(`  Total email accounts: ${emailAccts.length}`);
  for (const e of emailAccts) {
    console.log(`    ${e.id} | user=${e.user_id} | tenant=${e.tenant_id} | ${e.email_address} | status=${e.connection_status}`);
  }
}

console.log("\n=== DONE ===");
