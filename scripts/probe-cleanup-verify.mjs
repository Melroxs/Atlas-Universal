// ---------------------------------------------------------------------------
// Post-probe hygiene check: scan EVERY exposed table for IDEM-PROBE residue.
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
  } catch {}
  return out;
}

const env = parseEnvFile(".env.local");
const URL = env.VITE_SUPABASE_URL ?? "https://ibxvzxblyhzwokljkslt.supabase.co";
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE) {
  console.error("SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(2);
}
const svc = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };

const specRes = await fetch(`${URL}/rest/v1/`, {
  headers: { ...svc, Accept: "application/openapi+json" },
});
const spec = await specRes.json();
const paths = Object.keys(spec.paths ?? {});
const tables = [
  ...new Set(
    paths
      .filter((p) => p.startsWith("/") && !p.startsWith("/rpc/") && p !== "/")
      .map((p) => p.split("?")[0].replace(/^\//, "")),
  ),
].sort();
console.log(`exposed tables (${tables.length}): ${tables.join(", ")}`);

let residue = 0;
let scanned = 0;
for (const t of tables) {
  try {
    const res = await fetch(`${URL}/rest/v1/${t}?select=*&limit=500`, { headers: svc });
    if (!res.ok) continue;
    const rows = await res.json().catch(() => []);
    if (!Array.isArray(rows)) continue;
    scanned++;
    const hits = rows.filter((r) => JSON.stringify(r).includes("IDEM-PROBE"));
    if (hits.length > 0) {
      residue += hits.length;
      console.log(`RESIDUE in ${t}: ${hits.length} row(s)`);
    }
  } catch {}
}
console.log(`scanned ${scanned} tables`);
console.log(residue === 0 ? "RESULT: no IDEM-PROBE residue found in any exposed table." : `RESULT: ${residue} residual row(s) — manual cleanup required.`);
