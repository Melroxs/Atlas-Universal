// Prints the EXACT deployed RPC signature from the live OpenAPI schema.
// Usage: node scripts/dump-openapi.mjs <rpcname>
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
const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/dump-openapi.mjs <rpcname>");
  process.exit(1);
}

let spec = null;
for (const key of [SERVICE, ANON].filter(Boolean)) {
  const res = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
  });
  if (res.ok) {
    spec = await res.json();
    break;
  }
}
if (!spec) {
  console.error("OpenAPI schema fetch failed");
  process.exit(1);
}

const entry = spec.paths?.[`/rpc/${target}`]?.post;
if (!entry) {
  console.error(`function ${target} not found in deployed schema`);
  process.exit(1);
}
console.log(JSON.stringify(entry, null, 2).slice(0, 6000));
