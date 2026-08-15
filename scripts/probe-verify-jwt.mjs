// Determine the live conversation-converse verify_jwt setting from behavior:
// if the unauthenticated 401 body is the FUNCTION's shape
// ({"ok":false,"error":"Unauthorized"}), the function runs without a JWT →
// verify_jwt=false. If it is the platform gateway's shape, verify_jwt=true.
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
const FN = `${URL}/functions/v1/conversation-converse`;

const opt = await fetch(FN, {
  method: "OPTIONS",
  headers: {
    Origin: "https://atlasmvp.freebuff.app",
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,apikey,content-type,x-client-info",
  },
});
console.log(`OPTIONS -> ${opt.status} ACAO=${opt.headers.get("access-control-allow-origin") ?? "(none)"}`);

const unauth = await fetch(FN, {
  method: "POST",
  headers: ANON ? { apikey: ANON, "Content-Type": "application/json" } : { "Content-Type": "application/json" },
  body: "{}",
});
const body = await unauth.text();
console.log(`unauthenticated POST -> ${unauth.status} body=${body.slice(0, 160)}`);
const functionShape = body.includes('"ok"') && body.includes("Unauthorized");
console.log(`verify_jwt inference: ${functionShape ? "false (function answers 401 itself)" : "true (gateway answers 401)"}`);
