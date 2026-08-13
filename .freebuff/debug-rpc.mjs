const URL = "http://127.0.0.1:54331";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const email = `dbg.${Date.now()}@atlas.test`;
let r = await fetch(`${URL}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "test-pass-123" }) });
const b = await r.json();
const AH = { apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${b.access_token}` };
for (const fn of ["users_current_user", "auth_status", "tenants_get_my_workspace"]) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: AH, body: "{}" });
  const body = await res.text();
  console.log(fn, "=>", res.status, body.slice(0, 200));
}
// Also test raw table access under RLS
const res2 = await fetch(`${URL}/rest/v1/profiles?select=*`, { headers: AH });
console.log("profiles select =>", res2.status, (await res2.text()).slice(0, 150));
