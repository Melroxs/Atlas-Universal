// ---------------------------------------------------------------------------
// LIVE end-to-end verification for the REAL production accounts.
//
// Mints a short-lived READ-ONLY magic-link session for each real account
// (does NOT change or reset any password, does NOT invalidate existing
// sessions), then calls users_current_user() exactly as the browser does and
// evaluates the exact production gate logic against the returned profile.
//
// Prints no secrets (tokens are never echoed).
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
  console.error("SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(2);
}
const svc = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };

/** The EXACT gate shipped in the production bundle (RequireAuth). */
function prodGate(profile) {
  const platformRole = profile?.platform_role ?? "user";
  const accountStatus = profile?.account_status ?? "pending";
  return platformRole === "super_admin" || accountStatus === "active"
    ? "ALLOWED"
    : "ACCESS-DENIED";
}

async function verifyAccount(label, email) {
  console.log(`\n=== ${label} (${email}) ===`);

  // 1. Mint a magic link (read-only; no credential change).
  const gl = await fetch(`${URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: svc,
    body: JSON.stringify({ email, type: "magiclink" }),
  });
  const gb = await gl.json().catch(() => ({}));
  if (!gl.ok || !gb.action_link) {
    console.log(`  generate_link FAILED: HTTP ${gl.status} ${JSON.stringify(gb).slice(0, 160)}`);
    return { rpc: "FAIL", gate: "UNVERIFIED" };
  }

  // 2. Exchange the link for a session WITHOUT following redirects — the
  //    access_token rides in the Location header's #fragment.
  const res = await fetch(gb.action_link, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  const m = location.match(/access_token=([^&]+)/);
  if (!m) {
    console.log(`  session exchange FAILED: HTTP ${res.status}, location=${location.split("#")[0] || "(none)"}`);
    return { rpc: "FAIL", gate: "UNVERIFIED" };
  }
  var token = decodeURIComponent(m[1]);

  // 3. Call users_current_user() exactly as the app does.
  const r = await fetch(`${URL}/rest/v1/rpc/users_current_user`, {
    method: "POST",
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY ?? "", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  const body = await r.text();
  let profile = null;
  try { profile = JSON.parse(body); } catch {}

  console.log(`  users_current_user HTTP ${r.status}`);
  if (profile && typeof profile === "object") {
    console.log(`  profile found:        yes (${Object.keys(profile).length} fields)`);
    console.log(`  name/email:           ${profile.name} / ${profile.email}`);
    console.log(`  account_status:       ${JSON.stringify(profile.account_status)}`);
    console.log(`  platform_role:        ${JSON.stringify(profile.platform_role)}`);
  } else {
    console.log(`  profile found:        NO — body: ${body.slice(0, 120)}`);
  }

  // 4. Cross-check the server-side authorization helpers under the SAME session.
  for (const fn of ["get_account_status", "get_platform_role", "is_super_admin", "can_access_atlas"]) {
    const fr = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: env.VITE_SUPABASE_ANON_KEY ?? "", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    const fb = await fr.text();
    console.log(`  ${fn}(): ${fr.status} → ${fb.slice(0, 60)}`);
  }

  const gate = prodGate(profile);
  console.log(`  PRODUCTION GATE →     ${gate}`);
  return { rpc: r.status === 200 ? "OK" : "FAIL", gate };
}

const results = {};
results.melissa = await verifyAccount("FOUNDER — Melissa", "melissa.o.rox@gmail.com");
results.ycdemo = await verifyAccount("YC DEMO", "ycdemo@gmail.com");

console.log("\n================ VERDICT ================");
for (const [k, v] of Object.entries(results)) {
  console.log(`${k}: RPC=${v.rpc} GATE=${v.gate}`);
}
