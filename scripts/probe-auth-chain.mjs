// ---------------------------------------------------------------------------
// LIVE probe of the exact production authorization chain:
//   signup -> session JWT -> users_current_user() RPC -> account_status gate
//
// Proves or disproves, against the REAL deployed database:
//   1. users_current_user() returns account_status/platform_role to an
//      authenticated caller (the exact call RequireAuth makes)
//   2. an active profile passes the production gate logic
//   3. a pending profile is blocked by the same logic (negative case)
//   4. a missing profile row yields null (fail-closed default "pending")
//
// Prints no secrets. Cleans up every row/user it creates.
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
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON || !SERVICE) {
  console.error("VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(2);
}

const svc = { apikey: SERVICE, "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` };
const auth = (t) => ({ apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${t}` });

let userIds = [];

async function cleanup() {
  for (const id of userIds) {
    await fetch(`${URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: svc }).catch(() => {});
  }
}

/** The EXACT gate logic shipped in the production bundle (RequireAuth). */
function prodGate(profile) {
  const platformRole = profile?.platform_role ?? "user";
  const accountStatus = profile?.account_status ?? "pending";
  return platformRole === "super_admin" || accountStatus === "active"
    ? "ALLOWED"
    : "ACCESS-DENIED";
}

/** Public signup is disabled (pilot gating) — create probe users via Admin API. */
async function createUserWithSession(email) {
  const cu = await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: svc,
    body: JSON.stringify({ email, password: "GateProbe!42", email_confirm: true }),
  });
  const cb = await cu.json().catch(() => ({}));
  const uid = cb.id ?? null;
  if (!uid) return { error: `admin create failed HTTP ${cu.status}: ${JSON.stringify(cb).slice(0, 120)}` };
  userIds.push(uid);
  // Sign in with the anon client exactly like the Auth page does.
  const si = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "GateProbe!42" }),
  });
  const sb = await si.json().catch(() => ({}));
  if (!sb.access_token) return { error: `sign-in failed HTTP ${si.status}` };
  return { uid, token: sb.access_token };
}

async function probe(label, { setStatus }) {
  const email = `gate.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const made = await createUserWithSession(email);
  if (made.error) {
    console.log(`${label}: SKIP — ${made.error}`);
    return;
  }
  const { uid, token } = made;

  if (setStatus) {
    const r = await fetch(`${URL}/rest/v1/profiles?_id=eq.${uid}`, {
      method: "PATCH",
      headers: svc,
      body: JSON.stringify({ account_status: setStatus }),
    });
    if (!r.ok) console.log(`${label}: WARN profile patch HTTP ${r.status}`);
  }

  // The exact call the frontend makes:
  const r = await fetch(`${URL}/rest/v1/rpc/users_current_user`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({}),
  });
  const body = await r.text();
  let profile = null;
  try { profile = JSON.parse(body); } catch {}

  const keys = profile && typeof profile === "object" ? Object.keys(profile) : [];
  console.log(`\n${label}:`);
  console.log(`  RPC status: ${r.status}`);
  console.log(`  returned:   ${profile ? `object with ${keys.length} keys` : body.slice(0, 120)}`);
  if (profile) {
    console.log(`  _id match:          ${profile._id === uid}`);
    console.log(`  account_status:     ${JSON.stringify(profile.account_status)}`);
    console.log(`  platform_role:      ${JSON.stringify(profile.platform_role)}`);
    console.log(`  has name/email:     ${Boolean(profile.name)}, ${Boolean(profile.email)}`);
  }
  console.log(`  PRODUCTION GATE →   ${prodGate(profile)}`);
}

try {
  console.log("=== LIVE probe: users_current_user + production gate ===");
  await probe("A. ACTIVE profile (expected ALLOWED)", { setStatus: "active" });
  await probe("B. PENDING profile (expected ACCESS-DENIED)", { setStatus: "pending" });
  await probe("C. SUSPENDED profile (expected ACCESS-DENIED)", { setStatus: "suspended" });

  // D. Missing profile row: delete it so users_current_user returns null.
  const madeD = await createUserWithSession(`gate.${Date.now()}.none@example.com`);
  if (!madeD.error) {
    const { uid: uidD, token: tokenD } = madeD;
    await fetch(`${URL}/rest/v1/profiles?_id=eq.${uidD}`, { method: "DELETE", headers: svc }).catch(() => {});
    const r = await fetch(`${URL}/rest/v1/rpc/users_current_user`, {
      method: "POST",
      headers: auth(tokenD),
      body: JSON.stringify({}),
    });
    const body = await r.text();
    let profile = null;
    try { profile = JSON.parse(body); } catch {}
    console.log(`\nD. MISSING profile row:`);
    console.log(`  RPC status: ${r.status}`);
    console.log(`  returned:   ${body.slice(0, 120)}`);
    console.log(`  PRODUCTION GATE →   ${prodGate(profile)}  (null defaults to pending → denied)`);
  }

  // E. Verify the two real accounts' records one more time.
  console.log("\n=== E. Real accounts in live DB ===");
  for (const [name, uid] of [
    ["Melissa", "0e914537-e62b-4982-a49d-3056f0deb2b8"],
    ["YC Demo", "c7e29b03-81d5-49c3-9504-151aa0dcd510"],
  ]) {
    const r = await fetch(`${URL}/rest/v1/profiles?select=_id,name,email,account_status,platform_role&_id=eq.${uid}`, { headers: svc });
    const rows = await r.json().catch(() => []);
    const p = Array.isArray(rows) ? rows[0] : null;
    console.log(`  ${name}: ${p ? JSON.stringify({ account_status: p.account_status, platform_role: p.platform_role }) : "NOT FOUND"} → gate: ${prodGate(p)}`);
  }

  // F. Auth user existence check for both accounts.
  console.log("\n=== F. Real accounts in Supabase Auth ===");
  const au = await fetch(`${URL}/auth/v1/admin/users?per_page=50`, { headers: svc });
  const ab = await au.json().catch(() => ({ users: [] }));
  for (const u of ab.users ?? []) {
    console.log(`  ${u.email} | provider=${u.app_metadata?.provider ?? "?"} | banned=${Boolean(u.banned_until && u.banned_until !== "")} | email_confirmed=${Boolean(u.email_confirmed_at)}`);
  }
} finally {
  await cleanup();
  console.log("\ncleanup: probe users removed");
}
