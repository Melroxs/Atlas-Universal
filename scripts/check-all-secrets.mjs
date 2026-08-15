// Presence-only scan for deployment secrets. NEVER prints values.
//   node scripts/check-all-secrets.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

function collectEnvFiles(dir) {
  const out = [];
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".env")) {
        const p = join(dir, name);
        try {
          if (statSync(p).isFile()) out.push(p);
        } catch {}
      }
    }
  } catch {}
  return out;
}

const TARGETS = ["SUPABASE_ACCESS_TOKEN", "GEMINI_API_KEY", "AI_PROVIDER", "GEMINI_MODEL", "SUPABASE_SERVICE_ROLE_KEY"];

// 1. Process environment (what the platform injects into this shell).
console.log("--- process.env ---");
for (const k of TARGETS) {
  console.log(`${k}: ${process.env[k] ? "set" : "missing"}`);
}

// 2. All .env* files at project root and supabase/.
const files = [...collectEnvFiles("."), ...collectEnvFiles("supabase")];
console.log("--- env files found ---");
for (const f of files) console.log(`  ${f}`);
for (const f of files) {
  const env = parseEnvFile(f);
  const hits = TARGETS.filter((k) => typeof env[k] === "string" && env[k].length > 0);
  if (hits.length) console.log(`${f}: ${hits.join(", ")}`);
}

// 3. Supabase CLI access token file (never prints the value).
try {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const tok = readFileSync(join(home, ".supabase", "access-token"), "utf8").trim();
  console.log(`~/.supabase/access-token: ${tok ? "set" : "missing"}`);
} catch {
  console.log("~/.supabase/access-token: missing");
}
