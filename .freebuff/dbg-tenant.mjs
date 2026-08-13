const URL = "http://127.0.0.1:54331";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
let r = await fetch(`${URL}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: `t.${Date.now()}@atlas.test`, password: "test-pass-123" }) });
const token = (await r.json()).access_token;
const res = await fetch(`${URL}/rest/v1/rpc/tenants_create_tenant`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ p_name: "Acme Test" }) });
console.log(res.status, await res.text());
