// ---------------------------------------------------------------------------
// LIVE new-customer journey test against the real Supabase project.
//
//   node scripts/journey-live.mjs
//
// Verifies the exact flow the user asked for, with a brand-new throwaway
// account:
//   signup(email, password, "NPP Roofing & Restoration")
//     → auth session
//     → public.profiles row auto-created by the trigger
//     → tenants_create_tenant idempotent + profile-repair (0011 + 0013)
//     → tenant + owner membership + company profile created with the EXACT
//       company name
//     → membership.userId satisfies its FK (no 23503)
//     → edge function: 200 {skipped} before workspace, 200 {ok:true} after
//     → sign out → sign in → same workspace loads
// Uses only public keys (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) plus the
// caller's own session — no secrets.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";

const env = {};
for (const raw of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq === -1) continue;
  env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
if (!URL || !ANON) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing");

const H = { apikey: ANON, "Content-Type": "application/json" };
const j = async (r) => r.json().catch(() => ({}));
const email = `atlas.customer.${Date.now()}@example.com`;
const password = "AtlasJourney!42";
const COMPANY = "NPP Roofing & Restoration";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const expect = (cond, name, detail) => {
  if (!cond) throw new Error(`${name} failed: ${detail}`);
};

const rpc = async (token, fn, args = {}) => {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...H, Authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
  });
  const body = await j(res);
  return { status: res.status, body };
};

// 1. Sign up.
let r = await fetch(`${URL}/auth/v1/signup`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ email, password, data: { full_name: "Journey Tester" } }),
});
let b = await j(r);
expect(r.status === 200, "signup", JSON.stringify(b).slice(0, 160));
const token = b.access_token;
expect(Boolean(token), "signup session", "no access_token issued");
check("1. signup creates auth user + active session", true, email);

// 2. Profile auto-created by the trigger.
r = await fetch(`${URL}/rest/v1/rpc/users_current_user`, {
  method: "POST",
  headers: { ...H, Authorization: `Bearer ${token}` },
  body: "{}",
});
b = await j(r);
check("2. public.profiles row exists after signup", b?._id && b.email === email, JSON.stringify({ id: b?._id ? "present" : "MISSING", email: b?.email }));

// 3. Edge function BEFORE workspace → 200 {skipped} (not a 400/404/500).
r = await fetch(`${URL}/functions/v1/connections-run-due-syncs`, {
  method: "POST",
  headers: { ...H, Authorization: `Bearer ${token}` },
  body: "{}",
});
b = await j(r);
check(
  "3. edge function without workspace returns 200 skipped",
  r.status === 200 && b.ok === true && b.skipped === "no-active-workspace",
  `status=${r.status} ${JSON.stringify(b)}`,
);

// 4. Create the tenant with the exact company name.
r = await fetch(`${URL}/rest/v1/rpc/tenants_create_tenant`, {
  method: "POST",
  headers: { ...H, Authorization: `Bearer ${token}` },
  body: JSON.stringify({ p_name: COMPANY }),
});
b = await j(r);
check("4. tenants_create_tenant succeeds (no 409/23503)", r.status === 200 && Boolean(b.tenantId), `status=${r.status} ${JSON.stringify(b)}`);
const tenantId = b.tenantId;
expect(Boolean(tenantId), "tenantId", "missing");

// 5. Idempotent retry returns the SAME tenant.
r = await fetch(`${URL}/rest/v1/rpc/tenants_create_tenant`, {
  method: "POST",
  headers: { ...H, Authorization: `Bearer ${token}` },
  body: JSON.stringify({ p_name: COMPANY }),
});
b = await j(r);
check("5. repeated create returns existing workspace", r.status === 200 && b.existing === true && b.tenantId === tenantId, JSON.stringify(b));

// 6. Workspace shape: tenant name, company profile, owner membership.
r = await fetch(`${URL}/rest/v1/rpc/tenants_get_my_workspace`, {
  method: "POST",
  headers: { ...H, Authorization: `Bearer ${token}` },
  body: "{}",
});
b = await j(r);
const ok6 =
  b?.tenant?.name === COMPANY &&
  b?.profile?.companyName === COMPANY &&
  b?.membership?.role === "owner" &&
  b?.membership?.status === "active";
check("6. workspace has tenant + company profile + owner membership", ok6, JSON.stringify({ tenant: b?.tenant?.name, company: b?.profile?.companyName, role: b?.membership?.role }));

// 7. Membership FK holds: the owner membership row exists, its tenantId is
//    the created tenant, and its userId resolves to a real profiles row
//    (RLS lets the caller read their own membership + profile rows).
r = await fetch(`${URL}/rest/v1/memberships?select=tenantId,userId,role`, {
  method: "GET",
  headers: { ...H, Authorization: `Bearer ${token}` },
});
b = await j(r);
const mems = Array.isArray(b) ? b : [];
const mem = mems[0] ?? null;
r = await fetch(`${URL}/rest/v1/profiles?select=_id,email&_id=eq.${mem?.userId ?? "00000000-0000-0000-0000-000000000000"}`, {
  method: "GET",
  headers: { ...H, Authorization: `Bearer ${token}` },
});
const prof = (await j(r))[0] ?? null;
const ok7 =
  mems.length === 1 &&
  mem.tenantId === tenantId &&
  mem.role === "owner" &&
  prof?._id === mem.userId;
check("7. exactly one owner membership whose userId satisfies the FK", ok7, `memberships=${mems.length} userIdInProfiles=${prof?._id === mem?.userId}`);

// 8. Edge function WITH workspace → 200 {ok:true}.
r = await fetch(`${URL}/functions/v1/connections-run-due-syncs`, {
  method: "POST",
  headers: { ...H, Authorization: `Bearer ${token}` },
  body: "{}",
});
b = await j(r);
check("8. edge function with workspace returns 200 ok", r.status === 200 && b.ok === true, `status=${r.status} ${JSON.stringify(b)}`);

// 9. Unauthenticated edge call rejected.
r = await fetch(`${URL}/functions/v1/connections-run-due-syncs`, {
  method: "POST",
  headers: { ...H },
  body: "{}",
});
check("9. unauthenticated edge call rejected", r.status === 401, `status=${r.status}`);

// 10. OPTIONS preflight with allowed origin → 204 + allow-origin.
r = await fetch(`${URL}/functions/v1/connections-run-due-syncs`, {
  method: "OPTIONS",
  headers: {
    ...H,
    Origin: "https://atlasuniversalos.freebuff.app",
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,content-type,apikey",
  },
});
const allowOrigin = r.headers.get("access-control-allow-origin");
check(
  "10. OPTIONS preflight 204 + single allowed origin",
  r.status === 204 && allowOrigin === "https://atlasuniversalos.freebuff.app",
  `status=${r.status} allow-origin=${allowOrigin}`,
);

// 11. Disallowed origin gets NO allow-origin (browser blocks it).
r = await fetch(`${URL}/functions/v1/connections-run-due-syncs`, {
  method: "OPTIONS",
  headers: {
    ...H,
    Origin: "https://evil.example.com",
    "Access-Control-Request-Method": "POST",
  },
});
const blockedOrigin = r.headers.get("access-control-allow-origin");
check("11. non-allowlisted origin gets no allow-origin", blockedOrigin === null, `allow-origin=${blockedOrigin}`);

// 12. Sign out → sign back in → same workspace.
await fetch(`${URL}/auth/v1/logout`, {
  method: "POST",
  headers: { ...H, Authorization: `Bearer ${token}` },
});
r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ email, password }),
});
b = await j(r);
const token2 = b.access_token;
check("12. sign in again issues a session", Boolean(token2), Boolean(token2) ? "" : JSON.stringify(b));
if (token2) {
  r = await fetch(`${URL}/rest/v1/rpc/tenants_get_my_workspace`, {
    method: "POST",
    headers: { ...H, Authorization: `Bearer ${token2}` },
    body: "{}",
  });
  b = await j(r);
  check("13. same workspace loads after re-login", b?.tenant?.name === COMPANY, b?.tenant?.name);
}

const failed = results.filter((r) => !r.ok);
console.log(`\nJOURNEY: ${results.length - failed.length}/${results.length} checks passed  (user=${email}, tenant=${tenantId})`);
if (failed.length > 0) process.exit(1);
