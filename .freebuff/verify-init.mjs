const URL = "http://127.0.0.1:54331";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const email = process.argv[2] || "alex.1786502825735@atlas.test";
const rpc = async (token, fn, args = {}) => {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(args) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};
let r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "test-pass-123" }) });
const j = await r.json();
if (!j.access_token) { console.log("SIGNIN FAILED:", j.error_description || j.msg || j); process.exit(1); }
console.log("signed in as", email);
let out = await rpc(j.access_token, "intelligence_seed_packs");
console.log("seedIntelligence:", out.status, JSON.stringify(out.body));
out = await rpc(j.access_token, "onboarding_complete_onboarding");
console.log("completeOnboarding:", out.status, JSON.stringify(out.body));
out = await rpc(j.access_token, "tenants_get_my_workspace");
console.log("workspace:", out.status, JSON.stringify({ name: out.body?.tenant?.name, complete: out.body?.profile?.onboardingComplete }));
