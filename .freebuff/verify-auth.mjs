// End-to-end auth verification against the local Supabase stack (same API the app uses).
const URL = "http://127.0.0.1:54331";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const H = { "apikey": ANON, "Content-Type": "application/json" };
const j = (r) => r.json().catch(() => ({}));
const email = `demo.${Date.now()}@atlas.test`;
const password = "test-pass-123";

// 1. Sign up
let r = await fetch(`${URL}/auth/v1/signup`, { method: "POST", headers: H, body: JSON.stringify({ email, password, data: { full_name: "Demo User" } }) });
let b = await j(r);
console.log("SIGNUP:", r.status, b.access_token ? "session issued (no email confirmation needed)" : JSON.stringify(b));
const token = b.access_token;
if (!token) process.exit(1);

// 2. Sign-in with correct password
r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: H, body: JSON.stringify({ email, password }) });
b = await j(r);
console.log("SIGNIN (correct pw):", r.status, b.access_token ? "OK" : JSON.stringify(b));

// 3. Sign-in with WRONG password must fail
r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: H, body: JSON.stringify({ email, password: "wrong-pw" }) });
b = await j(r);
console.log("SIGNIN (wrong pw):", r.status, r.status === 400 ? "rejected (expected)" : JSON.stringify(b));

// 4. Profile row auto-created by the trigger + RPC round-trip
const AH = { ...H, Authorization: `Bearer ${token}` };
r = await fetch(`${URL}/rest/v1/rpc/users_current_user`, { method: "POST", headers: AH, body: "{}" });
b = await j(r);
console.log("RPC users_current_user:", r.status, JSON.stringify({ email: b.email, name: b.name, id: b._id ? "present" : "MISSING" }));

// 5. Workspace query before setup (must be null, not error)
r = await fetch(`${URL}/rest/v1/rpc/tenants_get_my_workspace`, { method: "POST", headers: AH, body: "{}" });
b = await j(r);
console.log("RPC tenants_get_my_workspace:", r.status, b === null ? "null (no workspace yet — expected)" : JSON.stringify(b).slice(0, 80));

// 6. Unauthenticated RPC must be blocked
r = await fetch(`${URL}/rest/v1/rpc/users_current_user`, { method: "POST", headers: H, body: "{}" });
console.log("RPC unauthenticated:", r.status, r.status === 401 ? "blocked (expected)" : "NOT BLOCKED!");

// 7. Anonymous sign-in (guest flow)
r = await fetch(`${URL}/auth/v1/signup`, { method: "POST", headers: H, body: JSON.stringify({}) });
b = await j(r);
console.log("ANON SIGNIN:", r.status, b.access_token ? "guest session issued" : JSON.stringify(b).slice(0, 120));
if (b.access_token) {
  const gH = { ...H, Authorization: `Bearer ${b.access_token}` };
  r = await fetch(`${URL}/rest/v1/rpc/users_current_user`, { method: "POST", headers: gH, body: "{}" });
  const gb = await j(r);
  console.log("RPC users_current_user (guest):", r.status, JSON.stringify({ isAnonymous: gb.isAnonymous, id: gb._id ? "present" : "MISSING" }));
}
