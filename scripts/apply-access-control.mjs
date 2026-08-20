// -----------------------------------------------------------------------
// Apply access control to profiles and configure Melissa as super_admin
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

const adminHeaders = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };

const MELISSA_UID = "0e914537-e62b-4982-a49d-3056f0deb2b8";
const YC_DEMO_UID = "c7e29b03-81d5-49c3-9504-151aa0dcd510";

// ── Try to create a SQL execution RPC ──
console.log("=== Attempting to apply access control columns ===");

// First, check if the columns exist
const checkRes = await fetch(`${URL}/rest/v1/profiles?select=_id,account_status,platform_role&limit=1`, { headers: adminHeaders });
const checkData = await checkRes.json();

if (checkRes.ok && Array.isArray(checkData)) {
  console.log("  Access control columns already exist!");
  console.log("  Sample:", JSON.stringify(checkData[0]));
} else {
  console.log("  Access control columns NOT found. Attempting to add via RPC...");
  
  // Try to create a temporary SQL execution function
  const createExecFn = `
    CREATE OR REPLACE FUNCTION public.exec_sql(sql text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      EXECUTE sql;
    END;
    $$;
  `;
  
  const rpcRes = await fetch(`${URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ sql: createExecFn }),
  });
  
  if (rpcRes.ok) {
    console.log("  Created exec_sql function");
    
    // Now add the columns
    const addColumns = `
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'pending';
      ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS platform_role text DEFAULT 'user';
    `;
    
    const addRes = await fetch(`${URL}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ sql: addColumns }),
    });
    
    if (addRes.ok) {
      console.log("  Added account_status and platform_role columns");
    } else {
      const errBody = await addRes.text().catch(() => '');
      console.log("  Failed to add columns:", addRes.status, errBody.slice(0, 200));
    }
  } else {
    const errBody = await rpcRes.text().catch(() => '');
    console.log("  exec_sql creation failed:", rpcRes.status, errBody.slice(0, 200));
    console.log("\n  MANUAL SQL REQUIRED:");
    console.log("  Run this in Supabase Dashboard → SQL Editor:");
    console.log("  ```sql");
    console.log("  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'pending';");
    console.log("  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS platform_role text DEFAULT 'user';");
    console.log("  ```");
  }
}

// ── Check columns again ──
const verifyRes = await fetch(`${URL}/rest/v1/profiles?select=_id,account_status,platform_role`, { headers: adminHeaders });
const verifyData = await verifyRes.json();
const columnsExist = verifyRes.ok && Array.isArray(verifyData) && verifyData[0]?.account_status !== undefined;

if (columnsExist) {
  console.log("\n=== Access control columns verified ===");
  
  // ── Update profiles ──
  console.log("\n=== Configuring profiles ===");
  
  // Set Melissa as super_admin + active
  const melissaUpdate = await fetch(`${URL}/rest/v1/profiles?_id=eq.${MELISSA_UID}`, {
    method: "PATCH",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ account_status: "active", platform_role: "super_admin" }),
  });
  const melissaData = await melissaUpdate.json().catch(() => ({}));
  console.log(`  Melissa: status=${melissaUpdate.ok ? 'success' : melissaUpdate.status}`, 
    Array.isArray(melissaData) ? `account_status=${melissaData[0]?.account_status} platform_role=${melissaData[0]?.platform_role}` : '');
  
  // Set YC Demo as active
  const ycUpdate = await fetch(`${URL}/rest/v1/profiles?_id=eq.${YC_DEMO_UID}`, {
    method: "PATCH",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify({ account_status: "active", platform_role: "user" }),
  });
  const ycData = await ycUpdate.json().catch(() => ({}));
  console.log(`  YC Demo: status=${ycUpdate.ok ? 'success' : ycUpdate.status}`,
    Array.isArray(ycData) ? `account_status=${ycData[0]?.account_status} platform_role=${ycData[0]?.platform_role}` : '');
  
  // ── Final verification ──
  console.log("\n=== Final Profile State ===");
  const finalProfiles = await fetch(`${URL}/rest/v1/profiles?select=_id,name,email,account_status,platform_role`, { headers: adminHeaders });
  const finalData = await finalProfiles.json();
  if (Array.isArray(finalData)) {
    for (const p of finalData) {
      console.log(`  ${p._id} | ${p.name} | ${p.email} | status=${p.account_status} | platform=${p.platform_role}`);
    }
  }
} else {
  console.log("\n=== Access control columns still missing ===");
  console.log("  Please run the SQL manually in Supabase Dashboard SQL Editor:");
  console.log("  ```sql");
  console.log("  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_status text DEFAULT 'pending';");
  console.log("  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS platform_role text DEFAULT 'user';");
  console.log("  UPDATE public.profiles SET account_status = 'active', platform_role = 'super_admin' WHERE _id = '${MELISSA_UID}';");
  console.log("  UPDATE public.profiles SET account_status = 'active' WHERE _id = '${YC_DEMO_UID}';");
  console.log("  ```");
}

// ── Verify remaining tenants ──
console.log("\n=== Remaining Tenants ===");
const tenantRes = await fetch(`${URL}/rest/v1/tenants?select=_id,name,slug`, { headers: adminHeaders });
const tenantData = await tenantRes.json();
if (Array.isArray(tenantData)) {
  console.log(`  Total tenants: ${tenantData.length}`);
  for (const t of tenantData) {
    console.log(`    ${t._id} | ${t.name} | ${t.slug}`);
  }
}

// ── Verify memberships ──
console.log("\n=== Remaining Memberships ===");
const memRes = await fetch(`${URL}/rest/v1/memberships?select=userId,tenantId,role,status`, { headers: adminHeaders });
const memData = await memRes.json();
if (Array.isArray(memData)) {
  console.log(`  Total memberships: ${memData.length}`);
  for (const m of memData) {
    console.log(`    User: ${m.userId} | Tenant: ${m.tenantId} | Role: ${m.role} | Status: ${m.status}`);
  }
}

console.log("\n=== DONE ===");
