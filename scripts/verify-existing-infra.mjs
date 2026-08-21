// Quick probe to verify existing Atlas infrastructure:
// 1. Atlas Mail (IMAP/SMTP config)
// 2. AI (conversation-converse edge function)
// 3. Auth state
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(".env.local", "utf-8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;

async function main() {
  const supabase = createClient(url, anonKey);

  // 1. Check existing tables that should already exist
  console.log("=== Existing Infrastructure Check ===\n");

  // Pilot applications table
  try {
    const { data, error } = await supabase.from("pilot_applications").select("id").limit(1);
    if (error) {
      if (error.message?.includes("does not exist")) {
        console.log("❌ pilot_applications — NOT FOUND");
      } else {
        console.log(`✅ pilot_applications — EXISTS (RLS/error: ${error.code})`);
      }
    } else {
      console.log(`✅ pilot_applications — EXISTS (${data?.length ?? 0} rows)`);
    }
  } catch (e) {
    console.log(`⚠️  pilot_applications — EXISTS (exception)`);
  }

  // email_accounts (Atlas Mail)
  try {
    const { data, error } = await supabase.from("email_accounts").select("id").limit(1);
    if (error) {
      if (error.message?.includes("does not exist")) {
        console.log("❌ email_accounts — NOT FOUND (Atlas Mail not deployed)");
      } else {
        console.log(`✅ email_accounts — EXISTS (Atlas Mail deployed, code: ${error.code})`);
      }
    } else {
      console.log(`✅ email_accounts — EXISTS (${data?.length ?? 0} accounts)`);
    }
  } catch (e) {
    console.log(`⚠️  email_accounts — EXISTS (exception)`);
  }

  // email_messages (Atlas Mail)
  try {
    const { data, error } = await supabase.from("email_messages").select("id").limit(1);
    if (error) {
      if (error.message?.includes("does not exist")) {
        console.log("❌ email_messages — NOT FOUND");
      } else {
        console.log(`✅ email_messages — EXISTS (code: ${error.code})`);
      }
    } else {
      console.log(`✅ email_messages — EXISTS (${data?.length ?? 0} messages)`);
    }
  } catch (e) {
    console.log(`⚠️  email_messages — EXISTS (exception)`);
  }

  // 2. Check auth state
  console.log("\n=== Auth State ===");
  const { data: session } = await supabase.auth.getSession();
  console.log(`Session active: ${Boolean(session?.session)}`);

  // 3. Check CRM lead table existence via direct REST
  console.log("\n=== CRM Table Direct Check ===");
  const crmTables = ["crm_leads", "crm_activities", "crm_tasks", "email_templates", "email_outreach"];
  for (const table of crmTables) {
    try {
      // Try a REST API call to the table
      const resp = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
      });
      const status = resp.status;
      if (status === 200) {
        const data = await resp.json();
        console.log(`✅ ${table} — EXISTS (REST 200, ${data.length} rows)`);
      } else if (status === 404) {
        console.log(`❌ ${table} — NOT FOUND (REST 404)`);
      } else if (status === 403) {
        console.log(`✅ ${table} — EXISTS (REST 403 = RLS blocked)`);
      } else {
        const body = await resp.text();
        console.log(`⚠️  ${table} — REST ${status}: ${body.slice(0, 100)}`);
      }
    } catch (e) {
      console.log(`⚠️  ${table} — EXISTS (exception: ${String(e).slice(0, 60)})`);
    }
  }

  // 4. Check conversation-converse edge function
  console.log("\n=== Edge Functions ===");
  try {
    const resp = await fetch(`${url}/functions/v1/conversation-converse`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transcript: "test" }),
    });
    if (resp.status === 404) {
      console.log("❌ conversation-converse — NOT DEPLOYED (404)");
    } else if (resp.status === 401 || resp.status === 403) {
      console.log(`✅ conversation-converse — EXISTS (auth required: ${resp.status})`);
    } else {
      const data = await resp.json();
      if (data?.data?.ai) {
        console.log(`✅ conversation-converse — DEPLOYED (AI: ${data.data.ai.provider}/${data.data.ai.status})`);
      } else {
        console.log(`✅ conversation-converse — DEPLOYED (status: ${resp.status})`);
      }
    }
  } catch (e) {
    console.log(`⚠️  conversation-converse — EXISTS (exception: ${String(e).slice(0, 80)})`);
  }

  console.log("\n=== Probe Complete ===");
}

main().catch(console.error);
