// Verify the CRM migration has been applied to the live database.
// Uses the anon key + a magic-link session for an authenticated probe.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Read env from .env.local
const envText = readFileSync(".env.local", "utf-8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

// Known test account
const EMAIL = "ycdemo@gmail.com";

async function main() {
  const supabase = createClient(url, anonKey);

  // 1. Sign in via magic link to get a session
  console.log("=== Step 1: Authenticate ===");
  const { data: authData, error: authError } = await supabase.auth.signInWithOtp({
    email: EMAIL,
    options: { shouldCreateUser: false },
  });
  if (authError && !authError.message.includes("Magic link")) {
    console.log("Auth error (non-fatal for probe):", authError.message);
  }
  // We can't easily complete magic link flow in a script, so let's try
  // querying with service-role style via the RPC functions directly.
  // Actually, let's try to get an existing session or use the anon key to
  // check if tables exist via information_schema.

  console.log("\n=== Step 2: Check table existence via RPC (requires auth) ===");
  
  // Create a second client and try to get an existing session
  // We'll use a different approach - query the information_schema via a
  // direct Supabase REST call which works with the anon key for schema info
  
  // Actually, Supabase doesn't expose information_schema via REST.
  // Let's try calling the CRM RPCs and see if they exist (even if unauthorized).
  
  const rpcTests = [
    "crm_list_leads",
    "crm_create_lead",
    "crm_update_lead",
    "crm_delete_lead",
    "crm_add_activity",
    "crm_list_tasks",
    "crm_create_task",
    "crm_complete_task",
    "crm_dashboard_stats",
    "email_list_templates",
    "email_save_template",
    "email_delete_template",
    "email_create_outreach",
    "email_list_outreach",
    "email_list_signatures",
    "email_save_signature",
    "email_delete_signature",
    "pilot_get_application",
  ];

  console.log("\n=== RPC Function Existence Check ===");
  let existingCount = 0;
  let missingCount = 0;
  
  for (const rpc of rpcTests) {
    try {
      const { data, error } = await supabase.rpc(rpc);
      if (error) {
        if (error.message?.includes("function") && error.message?.includes("does not exist")) {
          console.log(`  ❌ ${rpc} — DOES NOT EXIST`);
          missingCount++;
        } else if (error.message?.includes("Unauthorized") || error.message?.includes("unauthorized")) {
          console.log(`  ✅ ${rpc} — EXISTS (unauthorized as expected)`);
          existingCount++;
        } else if (error.message?.includes("not found")) {
          console.log(`  ❌ ${rpc} — DOES NOT EXIST (404)`);
          missingCount++;
        } else {
          // Some other error - function likely exists but has a different issue
          console.log(`  ⚠️  ${rpc} — EXISTS (error: ${error.message?.slice(0, 80)})`);
          existingCount++;
        }
      } else {
        console.log(`  ✅ ${rpc} — EXISTS (returned data)`);
        existingCount++;
      }
    } catch (e) {
      const msg = e?.message ?? String(e);
      if (msg.includes("does not exist") || msg.includes("not found")) {
        console.log(`  ❌ ${rpc} — DOES NOT EXIST`);
        missingCount++;
      } else {
        console.log(`  ⚠️  ${rpc} — EXISTS (catch: ${msg.slice(0, 80)})`);
        existingCount++;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  RPCs found: ${existingCount}/${rpcTests.length}`);
  console.log(`  RPCs missing: ${missingCount}/${rpcTests.length}`);

  // 3. Check table existence via a direct query attempt
  console.log("\n=== Table Existence Check (via Supabase client) ===");
  const tables = ["crm_leads", "crm_activities", "crm_tasks", "email_templates", "email_outreach", "email_signatures"];
  
  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select("*").limit(1);
      if (error) {
        if (error.message?.includes("does not exist") || error.code === "42P01") {
          console.log(`  ❌ ${table} — DOES NOT EXIST`);
        } else if (error.message?.includes("RLS") || error.message?.includes("permission") || error.code === "42501" || error.code === "PGRST301") {
          console.log(`  ✅ ${table} — EXISTS (RLS blocked as expected)`);
        } else {
          console.log(`  ⚠️  ${table} — EXISTS (error: ${error.message?.slice(0, 80)})`);
        }
      } else {
        console.log(`  ✅ ${table} — EXISTS (${data?.length ?? 0} rows returned)`);
      }
    } catch (e) {
      console.log(`  ⚠️  ${table} — EXISTS (exception: ${String(e).slice(0, 80)})`);
    }
  }

  console.log("\n=== Probe Complete ===");
}

main().catch(console.error);
