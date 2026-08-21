// -----------------------------------------------------------------------
// Send password recovery email to Melissa with the correct production URL
// -----------------------------------------------------------------------
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
const ANON = env.VITE_SUPABASE_ANON_KEY;

if (!ANON) { console.error("VITE_SUPABASE_ANON_KEY missing"); process.exit(1); }

const MELISSA_EMAIL = "melissa.o.rox@gmail.com";
const PRODUCTION_ORIGIN = "https://atlas-ai-os.com";
const REDIRECT_TO = `${PRODUCTION_ORIGIN}/reset-password`;

console.log(`Sending password recovery to ${MELISSA_EMAIL}`);
console.log(`Redirect URL: ${REDIRECT_TO}`);

const res = await fetch(`${URL}/auth/v1/recover`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({
    email: MELISSA_EMAIL,
    redirect_to: REDIRECT_TO,
  }),
});

const body = await res.json().catch(() => ({}));
console.log(`Status: ${res.status}`);
console.log(`Response: ${JSON.stringify(body).slice(0, 200)}`);

if (res.ok) {
  console.log("\n✅ Password recovery email sent successfully!");
  console.log("The recovery link will redirect to:");
  console.log(`  ${REDIRECT_TO}`);
  console.log("\nMelissa should:");
  console.log("  1. Check her email inbox");
  console.log("  2. Click the recovery link");
  console.log("  3. The link should open at atlas-ai-os.com/reset-password");
  console.log("  4. Set a new password");
  console.log("  5. Sign in with the new password");
} else {
  console.log("\n❌ Failed to send recovery email");
}
