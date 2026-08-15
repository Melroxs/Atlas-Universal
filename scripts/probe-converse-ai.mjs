// Probe the DEPLOYED conversation-converse function to see whether it runs
// the Gemini-capable build (returns ai metadata) or the older deterministic
// bundle. Creates a throwaway user + tenant; prints no secrets.
//
//   node scripts/probe-converse-ai.mjs
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
const ANON = env.VITE_SUPABASE_ANON_KEY;
const URL = env.VITE_SUPABASE_URL ?? "https://ibxvzxblyhzwokljkslt.supabase.co";
if (!ANON) {
  console.error("VITE_SUPABASE_ANON_KEY missing from .env.local");
  process.exit(1);
}

const email = `probe.ai.${Date.now()}@example.com`;
const H = { apikey: ANON, "Content-Type": "application/json" };

const signup = await fetch(`${URL}/auth/v1/signup`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ email, password: "ProbeAi!42", data: { full_name: "Probe" } }),
});
const sb = await signup.json().catch(() => ({}));
const token = sb.access_token;
if (!token) {
  console.log(`FAIL signup (HTTP ${signup.status})`);
  process.exit(0);
}
const auth = { ...H, Authorization: `Bearer ${token}` };

await fetch(`${URL}/rest/v1/rpc/tenants_create_tenant`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ p_name: "Probe Tenant" }),
}).catch(() => {});

const res = await fetch(`${URL}/functions/v1/conversation-converse`, {
  method: "POST",
  headers: { ...auth, Origin: "https://atlasmvp.freebuff.app" },
  body: JSON.stringify({ transcript: "hello atlas" }),
});
const b = await res.json().catch(() => ({}));
const d = b?.data ?? {};
const acao = res.headers.get("access-control-allow-origin");
console.log(`HTTP ${res.status} ACAO=${acao ?? "(none)"}`);
console.log(`mode=${d.mode ?? "?"} answer="${String(d.answer ?? "").slice(0, 80)}"`);
console.log(
  `ai metadata: ${d.ai ? JSON.stringify({ configured: d.ai.configured, provider: d.ai.provider, model: d.ai.model, status: d.ai.status, code: d.ai.lastErrorCode }) : "ABSENT (old bundle)"}`,
);
console.log(`sessionId=${d.sessionId ? "yes" : "no"} askSessionId=${d.askSessionId ? "yes" : "no"}`);
