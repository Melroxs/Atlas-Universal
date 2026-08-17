// Probe the deployed status of the Actions-page tool edge functions.
// Prints only HTTP statuses — no secrets.
import { readFileSync } from "node:fs";

const env = {};
for (const raw of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq === -1) continue;
  env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}
const URL = env.VITE_SUPABASE_URL ?? "https://ibxvzxblyhzwokljkslt.supabase.co";
const ANON = env.VITE_SUPABASE_ANON_KEY;

for (const fn of ["tools-execute-tool", "tools-confirm-tool-action", "tools-cancel-tool-action"]) {
  const r = await fetch(`${URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await r.text().catch(() => "");
  console.log(`${fn} → HTTP ${r.status}${r.status === 404 ? " (not deployed)" : ""} ${body.slice(0, 80)}`);
}
