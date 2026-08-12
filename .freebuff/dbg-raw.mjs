const URL = "http://127.0.0.1:54331";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
let r = await fetch(`${URL}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: `raw.${Date.now()}@atlas.test`, password: "test-pass-123" }) });
const token = (await r.json()).access_token;
const res = await fetch(`${URL}/rest/v1/tenants`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${token}`, Prefer: "return=representation" }, body: JSON.stringify({ name: "Raw Insert Test", slug: "raw-" + Date.now(), status: "active" }) });
console.log(res.status, (await res.text()).slice(0, 200));
