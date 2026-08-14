// ---------------------------------------------------------------------------
// Live voice-brain verification: asks the DEPLOYED conversation-converse edge
// function questions that must be answered from REAL tenant evidence.
//
//   node scripts/verify-voice-live.mjs "<email>" "<password>" ["<question>"]
//
// Credentials come from the command line (a throwaway E2E user) and .env.local
// (anon key — never printed). Prints ONLY the result summary.
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
const ANON = env.VITE_SUPABASE_ANON_KEY;
const URL = env.VITE_SUPABASE_URL ?? "https://ibxvzxblyhzwokljkslt.supabase.co";
const email = process.argv[2];
const password = process.argv[3];
const question = process.argv[4] ?? "what claims need my attention?";
if (!ANON || !email || !password) {
  console.error("usage: node scripts/verify-voice-live.mjs <email> <password> [question]");
  process.exit(1);
}

const H = { apikey: ANON, "Content-Type": "application/json" };
const signin = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ email, password }),
});
const sb = await signin.json().catch(() => ({}));
const token = sb.access_token;
if (!token) {
  console.log(`FAIL signin (HTTP ${signin.status})`);
  process.exit(0);
}
const auth = { ...H, Authorization: `Bearer ${token}`, Origin: "https://atlasmvp.freebuff.app" };

const t0 = Date.now();
const res = await fetch(`${URL}/functions/v1/conversation-converse`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ transcript: question }),
});
const ms = Date.now() - t0;
const acao = res.headers.get("access-control-allow-origin");
const b = await res.json().catch(() => ({}));
const answer = typeof b?.data?.answer === "string" ? b.data.answer : "";
const evidence = Array.isArray(b?.data?.evidence) ? b.data.evidence : [];
const ok = res.status === 200 && acao === "https://atlasmvp.freebuff.app" && answer.length > 0;
console.log(
  `${ok ? "OK " : "FAIL"} HTTP ${res.status} ACAO=${acao ?? "(none)"} ${ms}ms\n` +
    `  Q: ${question}\n` +
    `  A: ${answer.slice(0, 400)}\n` +
    `  evidence: ${evidence.length} item(s), mode=${b?.data?.mode ?? "?"}, intent=${b?.data?.intent ?? "?"}`,
);
