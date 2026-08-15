// Prints ONLY presence flags for the Atlas AI configuration (never values):
//   node scripts/check-ai-config.mjs
// Used to determine whether a Gemini key is available without exposing it.
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
const keys = [
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "SUPABASE_ACCESS_TOKEN",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
];
for (const k of keys) {
  const v = env[k];
  const present = typeof v === "string" && v.length > 0;
  console.log(`${k}: ${present ? "set" : "missing"}`);
}
