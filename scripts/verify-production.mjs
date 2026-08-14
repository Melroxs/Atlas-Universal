// ---------------------------------------------------------------------------
// Atlas production verification — read-only diagnostics.
//
//   node scripts/verify-production.mjs
//
// Reports, without printing any secrets:
//   1. Edge functions deployed to the linked Supabase project
//   2. Whether the events_* RPCs the frontend calls exist in pg_proc
//   3. CORS preflight behavior from each authorized production origin
//
// Credentials come from .env.local (never printed): SUPABASE_ACCESS_TOKEN.
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
  } catch {
    /* missing */
  }
  return out;
}

const env = parseEnvFile(".env.local");
const TOKEN = env.SUPABASE_ACCESS_TOKEN;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const REF = "ibxvzxblyhzwokljkslt";
const URL = env.VITE_SUPABASE_URL ?? `https://${REF}.supabase.co`;
if (!TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN missing from .env.local");

const mgmt = async (path) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`Management API ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
};
const sql = async (query) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res.json();
};

// 1. Deployed edge functions.
const functions = await mgmt("/functions");
console.log("=== Deployed edge functions ===");
for (const f of functions) {
  console.log(`  ${f.slug}  status=${f.status}  verify_jwt=${f.verify_jwt}`);
}

// 2. RPC existence — compare what the frontend calls vs what is deployed.
const rpcQuery = `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'events_list_policies','events_raw_policies','events_stats','events_list',
    'events_list_notifications','insurance_recovery_analytics','insurance_claim_counts',
    'insurance_list_claims','insurance_list_claim_candidates','insurance_get_claim_package',
    'audit_list_logs','documents_list_documents','ask_insert_session'
  ) order by p.proname`;
const rows = await sql(rpcQuery);
const deployed = new Set(rows.map((r) => r.proname));
const expected = [
  "events_list_policies",
  "events_raw_policies",
  "events_stats",
  "events_list",
  "events_list_notifications",
  "insurance_recovery_analytics",
  "insurance_claim_counts",
  "insurance_list_claims",
  "insurance_list_claim_candidates",
  "insurance_get_claim_package",
  "audit_list_logs",
  "documents_list_documents",
  "ask_insert_session",
];
console.log("\n=== RPC existence in pg_proc (frontend contract vs deployed) ===");
for (const name of expected) {
  console.log(`  ${deployed.has(name) ? "OK " : "MISSING"}  ${name}`);
}

// 3. CORS preflight from the production origins for every browser-invoked
//    edge function.
const BROWSER_FUNCTIONS = ["connections-run-due-syncs", "conversation-converse"];
console.log("\n=== CORS preflight (OPTIONS) per origin ===");
for (const fn of BROWSER_FUNCTIONS) {
  for (const origin of [
    "https://atlasmvp.freebuff.app",
    "https://atlasuniversalos.freebuff.app",
    "https://evil.example.com",
  ]) {
    const res = await fetch(`${URL}/functions/v1/${fn}`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,apikey,content-type,x-client-info",
      },
    });
    const acao = res.headers.get("access-control-allow-origin");
    const ok = res.status >= 200 && res.status < 300 && acao === origin;
    console.log(`  ${ok ? "OK " : "FAIL"}  ${fn}  ${origin}  -> HTTP ${res.status}  ACAO=${acao ?? "(none)"}`);
  }
}

// 4. conversation-converse behavior (unauthenticated, anon key only).
if (ANON) {
  console.log("\n=== conversation-converse edge function (unauthenticated probe) ===");
  const res = await fetch(`${URL}/functions/v1/conversation-converse`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await res.text().catch(() => "");
  console.log(`  HTTP ${res.status}  body=${body.slice(0, 160)}`);
}

// 5. Live authenticated conversation-converse round trip: signup → workspace
//    → POST { transcript } with the user's real JWT → the deployed function
//    must answer from the tenant's (empty) evidence without failing at CORS.
if (ANON) {
  const email = `verify.converse.${Date.now()}@example.com`;
  const H = { apikey: ANON, "Content-Type": "application/json" };
  const signup = await fetch(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, password: "VerifyConverse!42", data: { full_name: "Verify" } }),
  });
  const sb = await signup.json().catch(() => ({}));
  const token = sb.access_token;
  if (token) {
    const auth = { ...H, Authorization: `Bearer ${token}` };
    await fetch(`${URL}/rest/v1/rpc/tenants_create_tenant`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ p_name: "Verify Converse" }),
    });
    console.log("\n=== conversation-converse (live, authenticated) ===");
    const res = await fetch(`${URL}/functions/v1/conversation-converse`, {
      method: "POST",
      headers: { ...auth, Origin: "https://atlasmvp.freebuff.app" },
      body: JSON.stringify({ transcript: "What did you find in this company data?" }),
    });
    const acao = res.headers.get("access-control-allow-origin");
    const b = await res.json().catch(() => ({}));
    const ok =
      res.status === 200 &&
      acao === "https://atlasmvp.freebuff.app" &&
      b?.ok === true &&
      typeof b?.data?.answer === "string" &&
      b?.data?.answer.length > 0;
    console.log(`  ${ok ? "OK " : "FAIL"}  HTTP ${res.status}  ACAO=${acao ?? "(none)"}  answer=${(b?.data?.answer ?? b?.error ?? "").slice(0, 110)}`);
  } else {
    console.log("\n=== conversation-converse (live, authenticated) — signup skipped ===");
  }
}

// 6. Live Events contract check with a throwaway user (signup → workspace →
//    the RPCs the Events page actually calls).
if (ANON) {
  const email = `verify.events.${Date.now()}@example.com`;
  const H = { apikey: ANON, "Content-Type": "application/json" };
  const signup = await fetch(`${URL}/auth/v1/signup`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, password: "VerifyEvents!42", data: { full_name: "Verify" } }),
  });
  const sb = await signup.json().catch(() => ({}));
  const token = sb.access_token;
  if (token) {
    const auth = { ...H, Authorization: `Bearer ${token}` };
    await fetch(`${URL}/rest/v1/rpc/tenants_create_tenant`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ p_name: "Verify Events" }),
    });
    console.log("\n=== Events page RPC contract (live, authenticated) ===");
    for (const fn of ["events_raw_policies", "events_stats", "events_list", "events_list_notifications"]) {
      const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: auth,
        body: "{}",
      });
      const b2 = await r.json().catch(() => ({}));
      const ok = r.status === 200;
      const summary = Array.isArray(b2) ? `${b2.length} rows` : Object.keys(b2).length ? "object" : String(b2);
      console.log(`  ${ok ? "OK " : "FAIL"}  ${fn}  -> HTTP ${r.status}  ${ok ? summary : String(b2).slice(0, 120)}`);
    }
  } else {
    console.log("\n=== Events page RPC contract (live) — signup skipped (anon key unavailable) ===");
  }
}
