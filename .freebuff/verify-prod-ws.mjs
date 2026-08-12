const URL = "http://127.0.0.1:54331";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const email = process.argv[2] || "prod.1786504925427@atlas.test";
let r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "test-pass-123" }) });
const j = await r.json();
if (!j.access_token) { console.log("SIGNIN FAILED:", j.error_description || j.msg || j); process.exit(1); }
const res = await fetch(`${URL}/rest/v1/rpc/tenants_get_my_workspace`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${j.access_token}` }, body: JSON.stringify({}) });
console.log("getMyWorkspace:", res.status);
console.log(JSON.stringify(await res.json(), null, 1).slice(0, 1500));
