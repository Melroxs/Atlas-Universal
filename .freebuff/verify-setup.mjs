// Simulates the Setup page's mutation chain with page-shaped args (camelCase keys).
const URL = "http://127.0.0.1:54331";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const rpc = async (token, fn, args) => {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(Object.fromEntries(Object.entries(args).map(([k,v]) => [k.startsWith('p_') ? k : 'p_'+k, v].map((x,i)=>i===0?x.toLowerCase():x)))) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};
// Sign up a fresh user
let r = await fetch(`${URL}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email: `setup.${Date.now()}@atlas.test`, password: "test-pass-123" }) });
const token = (await r.json()).access_token;
// createTenant — page sends { name }
let out = await rpc(token, "tenants_create_tenant", { name: "Acme Restoration Co" });
console.log("createTenant({name}):", out.status, JSON.stringify(out.body));
// onboarding_update_company_profile — page sends profile fields
out = await rpc(token, "onboarding_update_company_profile", { companyName: "Acme Restoration Co", industry: "Insurance restoration", country: "US", companySize: "11–50", businessModel: "B2B services" });
console.log("updateCompanyProfile:", out.status, JSON.stringify(out.body));
// onboarding_save_company_system — page sends { name, category, vendor, status }
out = await rpc(token, "onboarding_save_company_system", { name: "CRM", category: "crm", vendor: "e.g. HubSpot", status: "existing" });
console.log("saveCompanySystem:", out.status, JSON.stringify(out.body));
// onboarding_complete_onboarding — page sends { industry }? (check page)
out = await rpc(token, "onboarding_complete_onboarding", {});
console.log("completeOnboarding:", out.status, JSON.stringify(out.body));
// workspace now returns the tenant
out = await rpc(token, "tenants_get_my_workspace", {});
console.log("getMyWorkspace:", out.status, JSON.stringify({ tenant: out.body?.tenant?.name, role: out.body?.membership?.role, profileIndustry: out.body?.profile?.industry, systems: out.body?.systems?.length }));
